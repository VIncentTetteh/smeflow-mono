"""Celery tasks for credit scoring and loan repayment collection."""

import structlog

from apps.api.workers.celery_app import celery
from apps.api.workers.dispatch import enqueue_task

logger = structlog.get_logger()

# ── Repayment collection ──────────────────────────────────────────────────────

_MAX_COLLECTION_ATTEMPTS = 3  # retry failed collections up to this many times
_DEFAULT_GRACE_DAYS = 3  # days overdue before marking defaulted


@celery.task(bind=True, max_retries=2, name="credit_tasks.collect_due_repayments")
def collect_due_repayments(self) -> None:
    """
    Daily Celery beat task: collect all instalments that are due today or overdue.

    Algorithm per instalment:
      1. Status == 'pending' and due_date <= now  → attempt MoMo collection
      2. Status == 'failed' and collection_attempts < MAX  → retry collection
      3. Status in ('pending','failed') and overdue > GRACE_DAYS  → mark 'defaulted'
      4. After processing all instalments, check if the parent loan should be
         marked 'repaid' (all paid) or 'defaulted' (all defaulted).
    """
    import asyncio

    async def _run() -> None:
        from datetime import datetime, timedelta, timezone
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.credit.models import LoanRequest, RepaymentInstalment
        from apps.api.modules.credit.service import CreditService

        now = datetime.now(timezone.utc)
        default_cutoff = now - timedelta(days=_DEFAULT_GRACE_DAYS)

        async with AsyncSessionLocal() as db:
            # Load all instalments that need attention
            result = await db.execute(
                select(RepaymentInstalment)
                .where(
                    RepaymentInstalment.due_date <= now,
                    RepaymentInstalment.status.in_(["pending", "failed"]),
                )
                .order_by(RepaymentInstalment.due_date)
            )
            instalments = list(result.scalars().all())
            logger.info("task.repayment.check_start", count=len(instalments))

            processed_loans: set[str] = set()

            for inst in instalments:
                try:
                    # Hard default if past grace period
                    if (
                        inst.due_date <= default_cutoff
                        and inst.collection_attempts >= _MAX_COLLECTION_ATTEMPTS
                    ):
                        inst.status = "defaulted"
                        await db.flush([inst])
                        logger.warning(
                            "repayment.defaulted",
                            instalment_id=str(inst.id),
                            loan_id=str(inst.loan_request_id),
                        )
                        processed_loans.add(str(inst.loan_request_id))
                        continue

                    # Attempt MoMo collection
                    loan_result = await db.execute(
                        select(LoanRequest).where(LoanRequest.id == inst.loan_request_id)
                    )
                    loan = loan_result.scalar_one_or_none()
                    if not loan or not loan.disbursement_phone:
                        continue

                    inst.status = "collecting"
                    inst.collection_attempts += 1
                    inst.last_attempt_at = now
                    await db.flush([inst])

                    payment_ref = await _attempt_collection(loan, inst)

                    if payment_ref:
                        inst.status = "paid"
                        inst.paid_at = now
                        inst.payment_ref = payment_ref
                        logger.info(
                            "repayment.collected",
                            instalment_id=str(inst.id),
                            payment_ref=payment_ref,
                        )
                    else:
                        inst.status = "failed"
                        logger.warning(
                            "repayment.collection_failed",
                            instalment_id=str(inst.id),
                            attempts=inst.collection_attempts,
                        )

                    await db.flush([inst])
                    processed_loans.add(str(inst.loan_request_id))

                except Exception as exc:
                    logger.error(
                        "repayment.task_error",
                        instalment_id=str(inst.id),
                        error=str(exc),
                    )
                    inst.status = "failed"
                    await db.flush([inst])

            # Check parent loans for completion / default
            for loan_id_str in processed_loans:
                try:
                    loan_result = await db.execute(
                        select(LoanRequest).where(
                            LoanRequest.id == UUID(loan_id_str),
                            LoanRequest.status == "active",
                        )
                    )
                    loan = loan_result.scalar_one_or_none()
                    if loan:
                        svc = CreditService(db)
                        await svc.check_and_mark_defaulted(loan)
                except Exception as exc:
                    logger.error(
                        "repayment.loan_status_check_error",
                        loan_id=loan_id_str,
                        error=str(exc),
                    )

            await db.commit()
            logger.info("task.repayment.done", processed=len(instalments))

    try:
        asyncio.get_event_loop().run_until_complete(_run())
    except Exception as exc:
        logger.error("task.repayment.fatal", error=str(exc))
        raise self.retry(exc=exc) from exc


async def _attempt_collection(loan, instalment) -> str | None:
    """
    Try to collect an instalment via MoMo.
    Returns payment_ref on success, None on failure.
    """
    try:
        from libs.payment_clients.providers import get_payment_provider

        phone = loan.disbursement_phone or ""
        digits = phone.replace("+", "").replace(" ", "")
        if any(digits.startswith(p) for p in ("23324", "23354", "23323", "23353")):
            provider = "mtn"
        elif any(digits.startswith(p) for p in ("23320", "23350")):
            provider = "vodafone"
        elif any(digits.startswith(p) for p in ("23327", "23357", "23326", "23356")):
            provider = "airteltigo"
        else:
            provider = "mtn"

        client = get_payment_provider(provider)
        ref = f"repay-{str(instalment.id)[:12]}"
        result = await client.request_payment(
            phone=loan.disbursement_phone,
            amount=instalment.amount,
            reference=ref,
            description=(
                f"Loan repayment instalment {instalment.instalment_number} "
                f"for loan {str(loan.id)[:8]}"
            ),
        )
        status = getattr(result, "status", None)
        external_ref = getattr(result, "external_ref", ref)
        if isinstance(result, dict):
            status = result.get("status")
            external_ref = result.get("payment_ref") or result.get("external_ref") or ref
        if status in ("success", "pending"):
            return external_ref
        return None
    except Exception as exc:
        logger.warning(
            "repayment.collection_exception",
            instalment_id=str(instalment.id),
            error=str(exc),
        )
        return None


@celery.task
def compute_all_credit_scores() -> None:
    """Nightly batch: recompute credit scores for all active businesses."""
    import asyncio

    async def _run() -> None:
        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.business.models import Business

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Business.id).where(Business.is_active.is_(True)))
            business_ids = [str(row[0]) for row in result.all()]

        for bid in business_ids:
            compute_credit_score.delay(bid)

        logger.info("task.credit_scores.batch_queued", count=len(business_ids))

    asyncio.get_event_loop().run_until_complete(_run())


@celery.task(bind=True, max_retries=2)
def compute_credit_score(self, business_id: str) -> None:
    """Compute and store credit score for a single business."""
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.credit.models import CreditScore
        from apps.api.modules.credit.scoring import (
            CreditScoringEngine,
            compute_factors,
        )

        async with AsyncSessionLocal() as db:
            factors = await compute_factors(db, UUID(business_id))
            engine = CreditScoringEngine()
            score = engine.compute(factors)

            cs = CreditScore(
                business_id=UUID(business_id),
                score=score.score,
                band=score.band,
                max_loan_amount=score.max_loan_amount,
                factors=score.factors,
            )
            db.add(cs)
            await db.commit()
            logger.info(
                "task.credit_score.computed",
                business_id=business_id,
                score=score.score,
                band=score.band,
            )
            if score.max_loan_amount > 0:
                from apps.api.workers.tasks.notification_tasks import send_notification

                enqueue_task(
                    send_notification,
                    business_id,
                    "credit.offer",
                    {"amount": str(score.max_loan_amount)},
                )

    try:
        asyncio.get_event_loop().run_until_complete(_run())
    except Exception as exc:
        logger.error("task.credit_score.failed", business_id=business_id, error=str(exc))
        raise self.retry(exc=exc) from exc
