"""Celery tasks for lender partner operations."""

import asyncio
from datetime import datetime, timedelta, timezone

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()


@celery.task(name="apps.api.workers.tasks.lender_tasks.alert_expiring_lender_keys")
def alert_expiring_lender_keys() -> None:
    async def _run() -> None:
        from sqlalchemy import select

        from apps.api.core.config import get_settings
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.lender.models import LenderPartner

        settings = get_settings()
        cutoff = datetime.now(timezone.utc) + timedelta(
            days=settings.LENDER_API_KEY_EXPIRY_ALERT_DAYS
        )
        async with AsyncSessionLocal() as db:
            partners = (
                (
                    await db.execute(
                        select(LenderPartner).where(
                            LenderPartner.is_active.is_(True),
                            LenderPartner.expires_at.isnot(None),
                            LenderPartner.expires_at <= cutoff,
                            LenderPartner.rotation_alerted_at.is_(None),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for partner in partners:
                logger.warning(
                    "lender.key_expiring",
                    lender_id=partner.lender_id,
                    contact_email=partner.contact_email,
                    expires_at=partner.expires_at.isoformat() if partner.expires_at else None,
                )
                partner.rotation_alerted_at = datetime.now(timezone.utc)
            await db.commit()

    asyncio.get_event_loop().run_until_complete(_run())
