"""Celery tasks for sales."""

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()


@celery.task
def void_sale_async(sale_id: str) -> None:
    """Handle async side effects of voiding a sale (cancel invoice, notify)."""
    import asyncio

    async def _run() -> None:
        from uuid import UUID

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.invoicing.models import Invoice

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Invoice).where(Invoice.sale_id == UUID(sale_id)))
            invoice = result.scalar_one_or_none()
            if invoice and invoice.status not in ("cancelled",):
                invoice.status = "cancelled"
                await db.commit()
                logger.info("task.void_sale.invoice_cancelled", sale_id=sale_id)

    asyncio.get_event_loop().run_until_complete(_run())
