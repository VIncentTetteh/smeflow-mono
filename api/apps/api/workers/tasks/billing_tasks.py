"""Celery tasks for subscription billing automation."""

import asyncio

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()


@celery.task(name="apps.api.workers.tasks.billing_tasks.process_due_subscriptions")
def process_due_subscriptions() -> None:
    async def _run() -> None:
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.billing.service import BillingService

        async with AsyncSessionLocal() as db:
            count = await BillingService(db).process_due_subscriptions()
            await db.commit()
            logger.info("billing.due_subscriptions_processed", count=count)

    asyncio.get_event_loop().run_until_complete(_run())
