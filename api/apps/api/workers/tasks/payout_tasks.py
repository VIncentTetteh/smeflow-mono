"""
Celery tasks for all outbound payout operations:
  - Agent commission payouts (weekly Bulk Transfer)
  - Commission hold-period release (hourly)
  - Payout batch reconciliation (post-batch safety net)
  - Loan disbursement retries (with backoff)
  - Merchant auto-settlement (daily 08:00 WAT)
  - Merchant settlement batch reconciliation (30 min post-batch)
  - Merchant settlement retries (with backoff)
"""

from __future__ import annotations

import asyncio

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()


# ── Commission hold release (hourly) ─────────────────────────────────────────


@celery.task(name="apps.api.workers.tasks.payout_tasks.release_commission_holds")
def release_commission_holds() -> None:
    """
    Hourly Beat task.
    Scans agent_commissions for rows whose available_at <= now and status == 'pending'.
    Moves them to 'available' and credits agent.available_balance.
    """

    async def _run() -> None:
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.agent_network.service import AgentNetworkService

        async with AsyncSessionLocal() as db:
            svc = AgentNetworkService(db)
            released = await svc.release_commissions_from_hold()
            await db.commit()
            logger.info("payout.hold_release.completed", released=released)

    asyncio.run(_run())


# ── Weekly agent payout (Friday 10:00 WAT) ───────────────────────────────────


@celery.task(name="apps.api.workers.tasks.payout_tasks.weekly_agent_payout")
def weekly_agent_payout(initiated_by: str | None = None) -> None:
    """
    Friday 10:00 WAT Beat task (also callable manually from admin).

    1. Prepares a list of eligible agents with their transfer details
    2. Creates an AgentPayoutBatch record (status=processing)
    3. Fires Paystack Bulk Transfer in batches of 100
    4. Enqueues reconcile_payout_batch for 30 minutes later
    """

    async def _run() -> None:
        from decimal import Decimal
        from uuid import UUID

        from apps.api.core.config import get_settings
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.agent_network.models import AgentPayoutBatch
        from apps.api.modules.agent_network.service import AgentNetworkService
        from libs.payment_clients.paystack import PaystackClient

        settings = get_settings()
        if not settings.PAYSTACK_SECRET_KEY:
            logger.warning("payout.weekly.paystack_not_configured")
            return

        async with AsyncSessionLocal() as db:
            svc = AgentNetworkService(db)

            # Step 1 — build transfer list
            transfers = await svc.prepare_payout_batch()
            if not transfers:
                logger.info("payout.weekly.no_eligible_agents")
                return

            total_amount = sum(t["amount_ghs"] for t in transfers)
            initiated_by_uuid = UUID(initiated_by) if initiated_by else None

            # Step 2 — create batch record
            batch = AgentPayoutBatch(
                initiated_by=initiated_by_uuid,
                total_amount=total_amount,
                agent_count=len(transfers),
                transfer_count=len(transfers),
                status="processing",
            )
            db.add(batch)
            await db.flush([batch])
            batch_id = batch.id
            logger.info(
                "payout.weekly.batch_created",
                batch_id=str(batch_id),
                agents=len(transfers),
                total_ghs=str(total_amount),
            )

            # Step 3 — fire Paystack Bulk Transfer in chunks of 100
            client = PaystackClient()
            all_results: list[dict] = []
            chunks = [transfers[i : i + 100] for i in range(0, len(transfers), 100)]

            from libs.payment_clients.paystack import parse_bulk_transfer_outcomes

            for chunk in chunks:
                try:
                    resp = await client.bulk_transfer(chunk)
                    for outcome in parse_bulk_transfer_outcomes(resp, chunk):
                        all_results.append(
                            {
                                "agent_id": outcome["agent_id"],
                                "amount_ghs": outcome["amount_ghs"],
                                "transfer_code": outcome.get("transfer_code"),
                                "status": outcome.get("status", "pending"),
                                "reference": outcome.get("reference") or chunk[0].get("reference"),
                            }
                        )
                except Exception as exc:
                    logger.error(
                        "payout.weekly.bulk_transfer_chunk_failed",
                        chunk_size=len(chunk),
                        error=str(exc),
                    )
                    # Mark all agents in this chunk as failed
                    for item in chunk:
                        all_results.append(
                            {
                                "agent_id": item["agent_id"],
                                "amount_ghs": item["amount_ghs"],
                                "transfer_code": None,
                                "status": "failed",
                                "error": str(exc),
                            }
                        )

            await client._close()

            # Step 4 — record results, update balances
            batch = await svc.record_payout_batch_result(batch, all_results)
            await db.commit()
            logger.info(
                "payout.weekly.completed",
                batch_id=str(batch_id),
                status=batch.status,
            )

        # Step 5 — schedule reconciliation check 30 minutes later
        reconcile_payout_batch.apply_async(args=[str(batch_id)], countdown=1800)

    asyncio.run(_run())


# ── Post-batch reconciliation (30 min after batch) ───────────────────────────


@celery.task(name="apps.api.workers.tasks.payout_tasks.reconcile_payout_batch")
def reconcile_payout_batch(batch_id: str) -> None:
    """
    Safety-net task run 30 minutes after a bulk transfer batch.
    Calls Paystack GET /transfer for each pending transfer in the batch.
    Catches success/failure events that webhooks may have missed.
    """

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.agent_network.models import AgentCommission, AgentPayoutBatch
        from apps.api.modules.agent_network.service import AgentNetworkService
        from libs.payment_clients.paystack import PaystackClient

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AgentPayoutBatch).where(
                    AgentPayoutBatch.id == UUID(batch_id),
                )
            )
            batch = result.scalar_one_or_none()
            if not batch or batch.status == "completed":
                return

            client = PaystackClient()
            updated_results = dict(batch.results or {})
            changes = 0

            for agent_id_str, outcome in updated_results.items():
                transfer_code = outcome.get("transfer_code")
                if not transfer_code or outcome.get("status") not in ("pending", "processing"):
                    continue

                try:
                    transfer = await client.get_transfer(transfer_code)
                    ps_status = transfer.get("status", "pending")
                    if ps_status in ("success", "failed", "reversed"):
                        outcome["status"] = ps_status
                        changes += 1

                        if ps_status == "success" and outcome.get("status") != "success":
                            from decimal import Decimal

                            agent_id = UUID(agent_id_str)
                            svc = AgentNetworkService(db)
                            amount = Decimal(str(outcome.get("amount", "0")))
                            await svc.finalize_agent_payout_success(
                                agent_id=agent_id,
                                amount=amount,
                                batch_id=batch.id,
                                transfer_code=transfer_code,
                                paid_via="momo",
                            )

                except Exception as exc:
                    logger.warning(
                        "payout.reconcile.transfer_check_failed",
                        transfer_code=transfer_code,
                        error=str(exc),
                    )

            await client._close()

            if changes:
                batch.results = updated_results
                # Recompute batch status
                statuses = [v.get("status") for v in updated_results.values()]
                if all(s == "success" for s in statuses):
                    batch.status = "completed"
                elif all(s == "failed" for s in statuses):
                    batch.status = "failed"
                else:
                    batch.status = "partial_failed"

                await db.commit()
                logger.info(
                    "payout.reconcile.batch_updated",
                    batch_id=batch_id,
                    changes=changes,
                    status=batch.status,
                )

    asyncio.run(_run())


# ── Loan disbursement retry (backoff: 15m → 1h → 4h) ─────────────────────────


@celery.task(
    bind=True,
    max_retries=3,
    name="apps.api.workers.tasks.payout_tasks.retry_failed_disbursement",
)
def retry_failed_disbursement(self, loan_id: str) -> None:
    """
    Retry a failed loan MoMo disbursement with exponential backoff.
    Schedule: 15 min → 1 hour → 4 hours.
    After 3 failures, escalates to admin via notification and leaves loan in 'confirmed'.
    """
    _BACKOFF = [900, 3600, 14400]  # seconds

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.config import get_settings
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.credit.models import LoanRequest
        from apps.api.modules.credit.service import CreditService

        settings = get_settings()
        if not settings.PAYSTACK_SECRET_KEY:
            return

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(LoanRequest).where(LoanRequest.id == UUID(loan_id))
            )
            loan = result.scalar_one_or_none()
            if not loan or loan.status not in ("confirmed", "disbursing"):
                return

            svc = CreditService(db)
            try:
                await svc.initiate_disbursement(loan.id)
                await db.commit()
                logger.info("payout.disbursement_retry.success", loan_id=loan_id)
            except Exception as exc:
                logger.warning(
                    "payout.disbursement_retry.failed",
                    loan_id=loan_id,
                    attempt=self.request.retries + 1,
                    error=str(exc),
                )
                raise

    backoff = _BACKOFF[min(self.request.retries, len(_BACKOFF) - 1)]
    try:
        asyncio.run(_run())
    except Exception as exc:
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=backoff) from exc

        # Max retries exhausted — escalate to admin
        asyncio.run(_escalate_disbursement_failure(loan_id))


async def _escalate_disbursement_failure(loan_id: str) -> None:
    """Notify admin when a loan disbursement has permanently failed after all retries."""
    from uuid import UUID

    from sqlalchemy import select

    from apps.api.core.database import AsyncSessionLocal
    from apps.api.modules.credit.models import LoanRequest
    from apps.api.modules.notifications.service import NotificationService

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(LoanRequest).where(LoanRequest.id == UUID(loan_id)))
        loan = result.scalar_one_or_none()
        if not loan:
            return

        logger.error(
            "payout.disbursement.max_retries_exhausted",
            loan_id=loan_id,
            business_id=str(loan.business_id),
            amount=str(loan.amount_approved),
        )
        # Revert to confirmed so admin can manually retry
        if loan.status == "disbursing":
            loan.status = "confirmed"

        # Notify merchant
        try:
            await NotificationService(db).dispatch_event(
                business_id=loan.business_id,
                event_type="loan_status_changed",
                data={
                    "message": (
                        "We could not disburse your loan automatically. "
                        "Please contact support — your application is still approved."
                    )
                },
            )
        except Exception:
            pass

        await db.commit()


# ── Merchant settlement retry (backoff: 30m → 2h → 6h) ───────────────────────


@celery.task(
    bind=True,
    max_retries=3,
    name="apps.api.workers.tasks.payout_tasks.retry_failed_merchant_settlement",
)
def retry_failed_merchant_settlement(self, settlement_id: str) -> None:
    """
    Retry a failed merchant settlement transfer.
    Backoff: 30 min → 2 hours → 6 hours.
    After 3 failures, logs escalation and leaves settlement in 'failed'.
    """
    _BACKOFF = [1800, 7200, 21600]

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.config import get_settings
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.settlements.models import MerchantSettlement
        from apps.api.modules.settlements.service import MerchantSettlementService

        settings = get_settings()
        if not settings.PAYSTACK_SECRET_KEY:
            return

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MerchantSettlement).where(MerchantSettlement.id == UUID(settlement_id))
            )
            settlement = result.scalar_one_or_none()
            if not settlement or settlement.status not in ("failed",):
                return

            svc = MerchantSettlementService(db)
            try:
                from apps.api.modules.business.models import Business

                biz_result = await db.execute(
                    select(Business).where(Business.id == settlement.business_id)
                )
                business = biz_result.scalar_one_or_none()
                recipient_code, _, _ = await svc.ensure_merchant_recipient_code(
                    settlement.business_id
                )
                # Reset to pending so _disburse_settlement can transition it
                settlement.status = "pending"
                await db.flush([settlement])
                await svc._disburse_settlement(
                    settlement=settlement,
                    business=business,
                    recipient_code=recipient_code,
                    approved_by=None,
                )
                await db.commit()
                logger.info("settlement.retry.success", settlement_id=settlement_id)
            except Exception as exc:
                await db.rollback()
                logger.warning(
                    "settlement.retry.failed",
                    settlement_id=settlement_id,
                    attempt=self.request.retries + 1,
                    error=str(exc),
                )
                raise

    backoff = _BACKOFF[min(self.request.retries, len(_BACKOFF) - 1)]
    try:
        asyncio.run(_run())
    except Exception as exc:
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=backoff) from exc
        logger.error(
            "settlement.max_retries_exhausted",
            settlement_id=settlement_id,
        )


# ── Daily merchant auto-settlement (08:00 WAT) ────────────────────────────────


@celery.task(name="apps.api.workers.tasks.payout_tasks.daily_merchant_auto_settlement")
def daily_merchant_auto_settlement(initiated_by: str | None = None) -> None:
    """
    Daily 08:00 WAT Beat task (also triggerable manually from admin).

    1. Selects all eligible merchants via prepare_auto_settlement_batch()
    2. Creates MerchantSettlement records (mode=auto, status=processing)
       and fires Paystack Bulk Transfer in batches of 100
    3. Schedules reconcile_merchant_settlement_batch 30 minutes later
    """

    async def _run() -> None:
        from apps.api.core.config import get_settings
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.settlements.models import MerchantSettlement
        from apps.api.modules.settlements.service import MerchantSettlementService
        from libs.payment_clients.paystack import PaystackClient

        settings = get_settings()
        if not settings.PAYSTACK_SECRET_KEY:
            logger.warning("settlement.daily_auto.paystack_not_configured")
            return

        async with AsyncSessionLocal() as db:
            svc = MerchantSettlementService(db)
            batch = await svc.prepare_auto_settlement_batch()

            if not batch:
                logger.info("settlement.daily_auto.no_eligible_merchants")
                return

            logger.info(
                "settlement.daily_auto.starting",
                merchants=len(batch),
                total_ghs=str(sum(t["amount"] for t in batch)),
            )

            # Convert batch to Paystack bulk transfer format and create settlement records
            settlement_ids: list[str] = []
            ps_transfers: list[dict] = []

            for item in batch:
                from uuid import UUID
                from sqlalchemy import select
                from apps.api.modules.business.models import Business

                biz_result = await db.execute(
                    select(Business).where(Business.id == UUID(item["business_id"]))
                )
                business = biz_result.scalar_one_or_none()
                if not business:
                    continue

                settlement = MerchantSettlement(
                    business_id=UUID(item["business_id"]),
                    requested_by=None,
                    amount=item["amount"],
                    fee_amount=item["fee"],
                    net_amount=item["net_amount"],
                    destination_phone=item["phone"],
                    destination_provider=item["provider"],
                    paystack_reference=None,
                    mode="auto",
                    status="processing",
                )
                db.add(settlement)
                await db.flush([settlement])
                settlement.paystack_reference = (
                    f"settle-{str(business.id)[:12]}-{str(settlement.id).replace('-', '')[:8]}"
                )
                await db.flush([settlement])

                initiator = UUID(initiated_by) if initiated_by else None
                await svc.audit_auto_settlement_initiated(
                    settlement, initiated_by=initiator
                )

                # Hold amount in business balance
                business.unsettled_balance = max(
                    0, (business.unsettled_balance or 0) - item["amount"]
                )
                await db.flush([business])

                settlement_ids.append(str(settlement.id))
                ps_transfers.append(
                    {
                        "amount_ghs": item["net_amount"],
                        "recipient_code": item["recipient_code"],
                        "reference": settlement.paystack_reference,
                        "reason": f"SMEflow daily settlement — {item['business_id'][:8]}",
                        "settlement_id": str(settlement.id),
                    }
                )

            await db.commit()

            # Fire Paystack Bulk Transfer in chunks of 100
            from libs.payment_clients.paystack import parse_bulk_transfer_outcomes

            client = PaystackClient()
            chunks = [ps_transfers[i : i + 100] for i in range(0, len(ps_transfers), 100)]
            all_outcomes: list[dict] = []

            for chunk in chunks:
                try:
                    resp = await client.bulk_transfer(chunk)
                    all_outcomes.extend(parse_bulk_transfer_outcomes(resp, chunk))
                    logger.info(
                        "settlement.daily_auto.chunk_sent", count=len(chunk)
                    )
                except Exception as exc:
                    logger.error(
                        "settlement.daily_auto.chunk_failed",
                        count=len(chunk),
                        error=str(exc),
                    )
                    for transfer in chunk:
                        all_outcomes.append(
                            {
                                "settlement_id": transfer.get("settlement_id"),
                                "status": "failed",
                                "transfer_code": None,
                                "error": str(exc),
                            }
                        )

            await client._close()

            async with AsyncSessionLocal() as db2:
                svc2 = MerchantSettlementService(db2)
                await svc2.apply_bulk_transfer_outcomes(all_outcomes)
                for outcome in all_outcomes:
                    if outcome.get("status") == "success" and outcome.get("transfer_code"):
                        await svc2.confirm_settlement(
                            transfer_code=outcome["transfer_code"],
                            reference=outcome.get("reference"),
                        )
                    elif outcome.get("status") in ("failed", "reversed"):
                        await svc2.fail_settlement(
                            transfer_code=outcome.get("transfer_code"),
                            reference=outcome.get("reference"),
                            reason=outcome.get("error") or "bulk_transfer_failed",
                        )
                await db2.commit()

            logger.info(
                "settlement.daily_auto.completed",
                settlements=len(settlement_ids),
            )

        # Schedule reconciliation 30 minutes later
        reconcile_merchant_settlement_batch.apply_async(
            args=[settlement_ids], countdown=1800
        )

    asyncio.run(_run())


# ── Merchant settlement batch reconciliation ──────────────────────────────────


@celery.task(
    name="apps.api.workers.tasks.payout_tasks.reconcile_merchant_settlement_batch"
)
def reconcile_merchant_settlement_batch(settlement_ids: list[str]) -> None:
    """
    Safety-net task run 30 minutes after a daily auto-settlement batch.
    Calls Paystack GET /transfer for each settlement still in 'processing'.
    Catches success/failure events missed by webhooks.
    """

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.settlements.models import MerchantSettlement
        from apps.api.modules.settlements.service import MerchantSettlementService
        from libs.payment_clients.paystack import PaystackClient

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(MerchantSettlement).where(
                    MerchantSettlement.id.in_([UUID(sid) for sid in settlement_ids]),
                    MerchantSettlement.status == "processing",
                )
            )
            pending = list(result.scalars().all())

            if not pending:
                logger.info("settlement.reconcile.nothing_pending")
                return

            client = PaystackClient()
            svc = MerchantSettlementService(db)
            confirmed = 0
            failed = 0

            for settlement in pending:
                lookup_code = settlement.paystack_transfer_code
                if not lookup_code:
                    continue
                try:
                    transfer = await client.get_transfer(lookup_code)
                    ps_status = transfer.get("status", "pending")

                    if ps_status == "success":
                        await svc.confirm_settlement(
                            transfer_code=lookup_code,
                            reference=settlement.paystack_reference,
                        )
                        confirmed += 1
                    elif ps_status in ("failed", "reversed"):
                        reason = transfer.get("gateway_response", ps_status)
                        await svc.fail_settlement(
                            transfer_code=lookup_code,
                            reference=settlement.paystack_reference,
                            reason=reason,
                        )
                        # Schedule retry
                        retry_failed_merchant_settlement.apply_async(
                            args=[str(settlement.id)], countdown=1800
                        )
                        failed += 1
                except Exception as exc:
                    logger.warning(
                        "settlement.reconcile.check_failed",
                        settlement_id=str(settlement.id),
                        error=str(exc),
                    )

            await client._close()
            await db.commit()
            logger.info(
                "settlement.reconcile.completed",
                checked=len(pending),
                confirmed=confirmed,
                failed=failed,
            )

    asyncio.run(_run())
