"""
Paystack webhook handler for payout-related events (legacy URL).

Delegates to the shared handler module used by the primary payments webhook.
Configure Paystack with a single URL: /api/v1/payments/webhooks/paystack
"""

from __future__ import annotations

import hashlib
import hmac

import structlog
from fastapi import APIRouter, HTTPException, Request

from apps.api.modules.payments.paystack_handlers import (
    dispatch_paystack_side_effects,
    is_duplicate_paystack_event,
)

logger = structlog.get_logger()
router = APIRouter()


def _verify_paystack_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/paystack", include_in_schema=False)
async def paystack_payout_webhook(request: Request) -> dict:
    """
    Legacy Paystack payout webhook — forwards to shared handlers.

    Prefer configuring Paystack to POST only to /api/v1/payments/webhooks/paystack.
    """
    from apps.api.core.config import get_settings
    from apps.api.core.database import AsyncSessionLocal

    raw_body = await request.body()
    signature = request.headers.get("X-Paystack-Signature", "")
    settings = get_settings()

    if settings.PAYSTACK_SECRET_KEY and not _verify_paystack_signature(
        raw_body, signature, settings.PAYSTACK_SECRET_KEY
    ):
        logger.warning("payouts.webhook.invalid_signature")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        import json
        body = json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event = body.get("event", "")
    data = body.get("data", {})

    if await is_duplicate_paystack_event(event, data, body):
        return {"processed": False, "duplicate": True}

    logger.info("payouts.webhook.received", event=event, legacy_url=True)

    async with AsyncSessionLocal() as db:
        try:
            await dispatch_paystack_side_effects(db, event, data)
            await db.commit()
        except Exception as exc:
            logger.error("payouts.webhook.processing_error", event=event, error=str(exc))
            raise HTTPException(status_code=500, detail="Webhook processing failed") from exc

    return {"processed": True, "event": event}
