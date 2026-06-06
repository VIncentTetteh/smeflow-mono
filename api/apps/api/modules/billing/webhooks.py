"""Billing webhook endpoints mounted under /api/v1/webhooks/billing."""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.webhook_security import mark_webhook_seen, require_webhook_ip
from apps.api.modules.billing.service import BillingService

logger = structlog.get_logger()
router = APIRouter()


@router.post("/callback", include_in_schema=False)
async def billing_callback(
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """MoMo subscription payment callback — idempotent via provider_ref dedup."""
    from apps.api.core.config import get_settings

    settings = get_settings()
    # Optional IP allowlist for billing provider callbacks
    if settings.WEBHOOK_ALLOWED_IPS_PAYSTACK:
        require_webhook_ip(request, "billing", settings.WEBHOOK_ALLOWED_IPS_PAYSTACK)

    provider_ref = (
        body.get("provider_ref")
        or body.get("external_ref")
        or body.get("reference")
        or body.get("transaction_id")
    )
    status = str(body.get("status", "")).lower()
    if not provider_ref:
        raise HTTPException(400, "Missing provider reference")

    provider_ref = str(provider_ref)

    # ── Idempotency guard ────────────────────────────────────────────────────
    if await mark_webhook_seen("billing", provider_ref):
        logger.info("billing.webhook.duplicate", provider_ref=provider_ref)
        return {"processed": False, "provider_ref": provider_ref, "duplicate": True}

    processed = False
    if status in ("success", "successful", "completed", "paid"):
        try:
            processed = await BillingService(db).handle_webhook_success(provider_ref)
            await db.commit()
            logger.info("billing.webhook.processed", provider_ref=provider_ref)
        except Exception as exc:
            logger.error("billing.webhook.failed", provider_ref=provider_ref, error=str(exc))
            raise HTTPException(500, "Webhook processing failed") from exc

    return {"processed": processed, "provider_ref": provider_ref}
