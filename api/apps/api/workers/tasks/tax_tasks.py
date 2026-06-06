"""Celery tasks for tax processing."""

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()


@celery.task
def generate_monthly_tax_drafts() -> None:
    """Generate draft tax returns for all businesses on the 1st of each month."""
    import asyncio
    from datetime import datetime, timezone

    async def _run() -> None:
        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.business.models import Business

        now = datetime.now(timezone.utc)
        # Generate return for previous month
        if now.month == 1:
            year, month = now.year - 1, 12
        else:
            year, month = now.year, now.month - 1

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Business.id).where(Business.is_active.is_(True)))
            business_ids = [str(row[0]) for row in result.all()]

        for bid in business_ids:
            from apps.api.workers.dispatch import enqueue_task

            enqueue_task(generate_tax_return, bid, year, month)

        logger.info("task.tax_drafts.queued", count=len(business_ids), year=year, month=month)

    asyncio.get_event_loop().run_until_complete(_run())


@celery.task(bind=True, max_retries=2)
def generate_tax_return(self, business_id: str, year: int, month: int) -> None:
    """Generate a monthly tax return draft for a business."""
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.tax.service import TaxService

        async with AsyncSessionLocal() as db:
            svc = TaxService(db)
            await svc.generate_monthly_return(UUID(business_id), year, month)
            await db.commit()
            logger.info(
                "task.tax_return.generated", business_id=business_id, period=f"{year}-{month:02d}"
            )

    try:
        asyncio.get_event_loop().run_until_complete(_run())
    except Exception as exc:
        raise self.retry(exc=exc) from exc


@celery.task(bind=True, max_retries=4, default_retry_delay=300)
def retry_failed_gra_filing(self, return_id: str) -> None:
    """
    Retry submitting a tax return to GRA after a transient failure.

    Retries up to 4 times with a 5-minute delay between attempts
    (300 s × exponential back-off via Celery's ``retry()``).
    Only re-attempts returns in ``draft`` or ``rejected`` status.
    """
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.tax.models import TaxReturn
        from apps.api.modules.tax.service import TaxService

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(TaxReturn).where(TaxReturn.id == UUID(return_id)))
            tax_return = result.scalar_one_or_none()
            if not tax_return:
                logger.warning("task.gra_retry.not_found", return_id=return_id)
                return

            if tax_return.status in ("submitted", "accepted", "exported"):
                logger.info(
                    "task.gra_retry.already_filed",
                    return_id=return_id,
                    status=tax_return.status,
                )
                return

            svc = TaxService(db)
            await svc.file_return(tax_return.business_id, UUID(return_id))
            await db.commit()
            logger.info("task.gra_retry.filed", return_id=return_id, status=tax_return.status)

    try:
        asyncio.get_event_loop().run_until_complete(_run())
    except Exception as exc:
        logger.error("task.gra_retry.failed", return_id=return_id, error=str(exc))
        raise self.retry(exc=exc) from exc
