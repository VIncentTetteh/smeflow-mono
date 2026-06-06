"""Celery tasks for payment processing and status polling."""

import structlog

from apps.api.workers.celery_app import celery
from apps.api.workers.dispatch import enqueue_task

logger = structlog.get_logger()


async def reconcile_confirmed_payment(db, payment_id: str) -> bool:
    """Mark linked invoice/sale/receivable records as settled for one successful payment."""
    from datetime import datetime, timezone
    from decimal import Decimal
    from uuid import UUID

    from sqlalchemy import select

    from apps.api.modules.invoicing.models import Invoice
    from apps.api.modules.payments.models import Payment
    from apps.api.modules.sales.models import Receivable, Sale

    result = await db.execute(select(Payment).where(Payment.id == UUID(str(payment_id))))
    payment = result.scalar_one_or_none()
    if not payment or payment.status != "success":
        return False

    metadata = dict(payment.metadata_ or {})
    if metadata.get("reconciled_at"):
        return False

    now = datetime.now(timezone.utc)

    invoice = None
    if payment.invoice_id:
        inv_result = await db.execute(select(Invoice).where(Invoice.id == payment.invoice_id))
        invoice = inv_result.scalar_one_or_none()

    if payment.sale_id:
        sale_result = await db.execute(select(Sale).where(Sale.id == payment.sale_id))
        sale = sale_result.scalar_one_or_none()
        if sale and sale.status != "voided":
            sale.amount_paid = min(sale.amount_paid + payment.amount, sale.total)
            sale.balance_due = max(sale.total - sale.amount_paid, Decimal("0"))
            sale.status = "completed" if sale.balance_due == 0 else "partial"

        receivable_result = await db.execute(
            select(Receivable).where(Receivable.sale_id == payment.sale_id)
        )
        receivable = receivable_result.scalar_one_or_none()
        if receivable:
            receivable.amount_paid = min(
                receivable.amount_paid + payment.amount,
                receivable.amount,
            )
            receivable.status = (
                "settled" if receivable.amount_paid >= receivable.amount else "partial"
            )
            receivable.balance_due = max(receivable.amount - receivable.amount_paid, Decimal("0"))

        if invoice and sale:
            invoice.amount_paid = sale.amount_paid
            invoice.balance_due = sale.balance_due
            if sale.balance_due == 0:
                invoice.status = "paid"
                invoice.paid_at = now
        elif invoice:
            invoice.amount_paid = min(invoice.amount_paid + payment.amount, invoice.total)
            invoice.balance_due = max(invoice.total - invoice.amount_paid, Decimal("0"))
            if invoice.balance_due == 0:
                invoice.status = "paid"
                invoice.paid_at = now

    payment.metadata_ = {**metadata, "reconciled_at": now.isoformat()}
    await db.flush()
    return True


@celery.task(bind=True, max_retries=3, default_retry_delay=30)
def initiate_pending_payment(self, payment_id: str) -> None:
    """Dispatch a pending collection request via Paystack."""
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.config import get_settings
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.payments.models import Payment
        from libs.payment_clients.providers import get_payment_provider

        settings = get_settings()
        if not settings.PAYSTACK_SECRET_KEY:
            logger.warning("payment.request.paystack_not_configured", payment_id=payment_id)
            return

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Payment).where(Payment.id == UUID(payment_id)))
            payment = result.scalar_one_or_none()
            if not payment or payment.status != "pending":
                return

            client = get_payment_provider(payment.provider or "mtn")
            response = await client.request_payment(
                payment.amount,
                payment.phone or "",
                payment.internal_ref or str(payment.id),
                "SMEFlow payment",
            )
            payment.external_ref = response.external_ref
            payment.status = response.status
            payment.provider_message = response.provider_message
            await db.commit()
            logger.info("payment.request.dispatched", payment_id=payment_id)

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("payment.request.dispatch_failed", payment_id=payment_id, error=str(exc))
        raise self.retry(exc=exc) from exc


@celery.task
def on_payment_confirmed(payment_id: str) -> None:
    """Handle a confirmed payment: mark invoice paid + notify business owner."""
    import asyncio

    async def _run() -> None:
        from apps.api.core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            reconciled = await reconcile_confirmed_payment(db, payment_id)
            await db.commit()
            logger.info("payment.confirmed.processed", payment_id=payment_id)

            # Queue notification
            if reconciled:
                enqueue_task(notify_payment_confirmed, payment_id)

    asyncio.run(_run())


@celery.task
def notify_payment_confirmed(payment_id: str) -> None:
    """Send payment confirmation notification."""
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.notifications.service import NotificationService
        from apps.api.modules.payments.models import Payment

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Payment).where(Payment.id == UUID(payment_id)))
            payment = result.scalar_one_or_none()
            if not payment:
                return
            await NotificationService(db).dispatch_event(
                payment.business_id,
                "payment.confirmed",
                {
                    "amount": str(payment.amount),
                    "provider": payment.provider,
                    "reference": payment.external_ref or payment.internal_ref or str(payment.id),
                    "phone": payment.phone,
                },
            )
            await db.commit()

    asyncio.run(_run())


@celery.task
def poll_pending_payments() -> None:
    """Check status of pending MoMo payments (runs every 15 min via Beat)."""
    import asyncio

    async def _run() -> None:
        from datetime import datetime, timedelta, timezone

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.payments.models import Payment

        cutoff = datetime.now(timezone.utc) - timedelta(hours=2)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Payment).where(
                    Payment.status == "pending",
                    Payment.provider == "mtn",
                    Payment.initiated_at >= cutoff,
                )
            )
            pending = list(result.scalars().all())

        for payment in pending:
            if payment.external_ref:
                enqueue_task(check_payment_status, str(payment.id), payment.external_ref)

    asyncio.run(_run())


@celery.task(name="apps.api.workers.tasks.payment_tasks.daily_payment_reconciliation")
def daily_payment_reconciliation() -> None:
    """Daily reconciliation for stale pending payments and high-level totals."""
    import asyncio

    async def _run() -> None:
        from datetime import datetime, timedelta, timezone

        from sqlalchemy import func, select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.payments.models import Payment
        from libs.payment_clients.providers import get_payment_provider

        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Payment).where(Payment.status == "pending", Payment.created_at <= cutoff)
            )
            stale = list(result.scalars().all())
            for payment in stale:
                if not payment.external_ref:
                    continue
                try:
                    provider = get_payment_provider(payment.provider)
                    status = await provider.check_status(payment.external_ref)
                    if status in {"success", "failed", "reversed"}:
                        payment.status = status
                        if status == "success":
                            payment.confirmed_at = datetime.now(timezone.utc)
                            await reconcile_confirmed_payment(db, str(payment.id))
                            if payment.type == "collection":
                                from apps.api.modules.settlements.service import (
                                    MerchantSettlementService,
                                )

                                await MerchantSettlementService(db).credit_collection(
                                    payment.id
                                )
                except Exception as exc:
                    logger.warning(
                        "payment.reconciliation_status_failed",
                        payment_id=str(payment.id),
                        error=str(exc),
                    )

            totals = (
                await db.execute(
                    select(Payment.type, func.sum(Payment.amount))
                    .where(Payment.status == "success")
                    .group_by(Payment.type)
                )
            ).all()
            await db.commit()
            logger.info(
                "payment.daily_reconciliation.completed",
                stale_checked=len(stale),
                totals={row[0]: str(row[1]) for row in totals},
            )

    asyncio.run(_run())


@celery.task(name="apps.api.workers.tasks.payment_tasks.backfill_settlement_ledger_credits")
def backfill_settlement_ledger_credits() -> None:
    """
    Replay credit_collection for successful collection payments missing ledger credits.
    """
    import asyncio

    async def _run() -> None:
        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.payments.models import Payment
        from apps.api.modules.settlements.models import MerchantLedgerEntry
        from apps.api.modules.settlements.service import MerchantSettlementService

        async with AsyncSessionLocal() as db:
            payments = (
                await db.execute(
                    select(Payment).where(
                        Payment.type == "collection",
                        Payment.status == "success",
                    )
                )
            ).scalars().all()

            credited = 0
            for payment in payments:
                existing = await db.execute(
                    select(MerchantLedgerEntry.id).where(
                        MerchantLedgerEntry.payment_id == payment.id,
                        MerchantLedgerEntry.type == "credit",
                    )
                )
                if existing.scalar_one_or_none():
                    continue
                result = await MerchantSettlementService(db).credit_collection(payment.id)
                if result:
                    credited += 1

            await db.commit()
            logger.info(
                "settlement.ledger_backfill.completed",
                scanned=len(payments),
                credited=credited,
            )

    asyncio.run(_run())


@celery.task(max_retries=5)
def check_payment_status(payment_id: str, external_ref: str) -> None:
    """Poll the appropriate provider for status of a specific pending payment."""
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.payments.models import Payment
        from libs.payment_clients.providers import get_payment_provider

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Payment).where(Payment.id == UUID(payment_id)))
            payment = result.scalar_one_or_none()
            if not payment or payment.status not in ("pending",):
                return

            try:
                provider = get_payment_provider(payment.provider)
                status = await provider.check_status(external_ref)
            except Exception as exc:
                logger.warning("payment.status_check_failed", payment_id=payment_id, error=str(exc))
                return

            if status in ("success", "failed", "reversed"):
                payment.status = status
                if status == "success":
                    from datetime import datetime, timezone

                    payment.confirmed_at = datetime.now(timezone.utc)
                    await db.commit()
                    enqueue_task(on_payment_confirmed, payment_id)
                else:
                    await db.commit()
            else:
                logger.debug(
                    "payment.still_pending", payment_id=payment_id, external_ref=external_ref
                )

    asyncio.run(_run())


@celery.task(bind=True, max_retries=5)
def retry_payment_with_backoff(self, payment_id: str) -> None:
    """Retry a failed MoMo collection with 2^n exponential back-off (up to 5 attempts).

    Retry schedule: 2s, 4s, 8s, 16s, 32s.
    After 5 failures the payment is marked failed and the business owner is notified.
    """
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.payments.models import Payment
        from libs.payment_clients.providers import get_payment_provider

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Payment).where(Payment.id == UUID(payment_id)))
            payment = result.scalar_one_or_none()
            if not payment or payment.status not in ("pending", "failed"):
                return

            try:
                provider = get_payment_provider(payment.provider)
                response = await provider.request_payment(
                    payment.amount,
                    payment.phone or "",
                    payment.internal_ref or str(payment.id),
                    "SMEFlow payment (retry)",
                )
                payment.external_ref = response.external_ref
                payment.status = response.status
                payment.provider_message = response.provider_message

                retry_count = (payment.metadata_ or {}).get("retry_count", 0) + 1
                payment.metadata_ = {**(payment.metadata_ or {}), "retry_count": retry_count}
                await db.commit()

                if response.status == "pending":
                    # Schedule a status check after 30s
                    enqueue_task(check_payment_status, payment_id, response.external_ref)

            except Exception as exc:
                logger.warning(
                    "payment.retry.attempt_failed",
                    payment_id=payment_id,
                    attempt=self.request.retries + 1,
                    error=str(exc),
                )
                raise

    backoff = 2**self.request.retries  # 1s, 2s, 4s, 8s, 16s
    try:
        asyncio.run(_run())
    except Exception as exc:
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=backoff) from exc
        # Max retries exhausted — mark payment as definitively failed
        asyncio.run(_mark_payment_failed(payment_id, str(exc)))


async def _mark_payment_failed(payment_id: str, reason: str) -> None:
    from uuid import UUID

    from sqlalchemy import select

    from apps.api.core.database import AsyncSessionLocal
    from apps.api.modules.payments.models import Payment

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Payment).where(Payment.id == UUID(payment_id)))
        payment = result.scalar_one_or_none()
        if payment:
            payment.status = "failed"
            payment.provider_message = f"Max retries exceeded: {reason}"
            payment.metadata_ = {
                **(payment.metadata_ or {}),
                "max_retries_exhausted": True,
            }
            await db.commit()
            enqueue_task(notify_payment_failed, payment_id)
        logger.error("payment.max_retries_exhausted", payment_id=payment_id, reason=reason)


@celery.task
def notify_payment_failed(payment_id: str) -> None:
    """Notify business owner that a payment has permanently failed."""
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.notifications.service import NotificationService
        from apps.api.modules.payments.models import Payment

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Payment).where(Payment.id == UUID(payment_id)))
            payment = result.scalar_one_or_none()
            if not payment:
                return
            await NotificationService(db).dispatch_event(
                payment.business_id,
                "payment.failed",
                {
                    "amount": str(payment.amount),
                    "provider": payment.provider,
                    "reference": payment.internal_ref or str(payment.id),
                    "phone": payment.phone,
                    "message": payment.provider_message or "Payment failed",
                },
            )
            await db.commit()

    asyncio.run(_run())


@celery.task
def sweep_stuck_payments() -> None:
    """Sweep payments stuck in 'pending' for >10 minutes and schedule status checks.

    This runs on a 10-minute Beat schedule as a safety net for missed webhooks.
    Covers all MoMo providers (mtn, vodafone, airteltigo).
    """
    import asyncio

    async def _run() -> None:
        from datetime import datetime, timedelta, timezone

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.payments.models import Payment

        cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
        momo_providers = {"mtn", "vodafone", "airteltigo"}

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Payment).where(
                    Payment.status == "pending",
                    Payment.provider.in_(momo_providers),
                    Payment.initiated_at <= cutoff,
                    Payment.external_ref.is_not(None),
                )
            )
            stuck = list(result.scalars().all())

        logger.info("payment.sweep.found_stuck", count=len(stuck))
        for payment in stuck:
            enqueue_task(check_payment_status, str(payment.id), payment.external_ref)

    asyncio.run(_run())


@celery.task
def release_expired_stock_reservations() -> None:
    """Release stock holds for MoMo sale intents whose prompts expired."""
    import asyncio

    async def _run() -> None:
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.sales.service import SalesService

        async with AsyncSessionLocal() as db:
            released = await SalesService(db).release_expired_stock_reservations()
            await db.commit()
            logger.info("stock_reservations.expired_released", count=released)

    asyncio.run(_run())
