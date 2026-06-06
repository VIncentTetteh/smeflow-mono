"""Celery tasks for inventory."""

import asyncio
from uuid import UUID

import structlog

from apps.api.workers.celery_app import celery
from apps.api.workers.dispatch import enqueue_task

logger = structlog.get_logger()


@celery.task
def notify_low_stock(business_id: str, item_id: str, item_name: str, current_stock: float) -> None:
    """Send low-stock alert to business owner via WhatsApp/SMS."""
    logger.info("task.low_stock", business_id=business_id, item=item_name, stock=current_stock)
    from apps.api.workers.tasks.notification_tasks import send_notification

    enqueue_task(
        send_notification,
        business_id=business_id,
        event_type="stock.low",
        data={"item_name": item_name, "current_stock": current_stock, "item_id": item_id},
    )


@celery.task(bind=True, max_retries=3)
def bulk_import_items_task(
    self,
    business_id: str,
    user_id: str,
    items_payload: list[dict],
) -> dict:
    """
    Process a large bulk item import asynchronously.
    Commits each item individually so partial progress is preserved on failure.
    """

    async def _run() -> dict:
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.inventory.schemas import ItemCreate
        from apps.api.modules.inventory.service import InventoryService

        bid = UUID(business_id)
        uid = UUID(user_id)
        created = 0
        failed = 0
        errors: list[dict] = []

        async with AsyncSessionLocal() as db:
            svc = InventoryService(db)
            for idx, raw in enumerate(items_payload):
                try:
                    item_data = ItemCreate.model_validate(raw)
                    await svc.create_item(bid, uid, item_data)
                    await db.commit()
                    created += 1
                except Exception as exc:
                    await db.rollback()
                    failed += 1
                    errors.append({"row": idx + 1, "name": raw.get("name", "?"), "error": str(exc)})

        return {"total": len(items_payload), "created": created, "failed": failed, "errors": errors}

    try:
        result = asyncio.run(_run())
        logger.info("task.bulk_import.complete", business_id=business_id, **result)
        return result
    except Exception as exc:
        logger.error("task.bulk_import.failed", business_id=business_id, error=str(exc))
        raise self.retry(exc=exc, countdown=30) from exc
