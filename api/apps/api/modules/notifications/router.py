"""Notification preference, event endpoints, and AfricasTalking delivery webhooks."""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Form, Header, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import (
    RequireRole,
    get_current_business_id,
    get_current_role,
    get_current_user_id,
)
from apps.api.modules.notifications.models import NotificationEvent
from apps.api.modules.notifications.schemas import (
    BulkMessageRequest,
    BulkMessageResponse,
    CustomerMessageListResponse,
    CustomerMessageResponse,
    MerchantAlertDismissRequest,
    MerchantAlertListResponse,
    MerchantAlertResponse,
    NotificationEventResponse,
    NotificationPreferenceResponse,
    NotificationPreferenceUpdate,
)
from apps.api.modules.notifications.service import NotificationService

logger = structlog.get_logger()
router = APIRouter()


@router.get("/alerts", response_model=MerchantAlertListResponse)
async def list_merchant_alerts(
    view: str = Query("attention", pattern="^(attention|history)$"),
    limit: int = Query(50, ge=1, le=100),
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    role: str = Depends(get_current_role),
    db: AsyncSession = Depends(get_db),
) -> MerchantAlertListResponse:
    from apps.api.modules.notifications.alert_service import MerchantAlertService

    alerts, unread = await MerchantAlertService(db).list_alerts(
        business_id, user_id, role, view=view, limit=limit
    )
    return MerchantAlertListResponse(
        items=[MerchantAlertResponse.model_validate(alert) for alert in alerts],
        unread_count=unread,
    )


@router.post("/alerts/{alert_id}/read", response_model=MerchantAlertResponse)
async def mark_merchant_alert_read(
    alert_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    role: str = Depends(get_current_role),
    db: AsyncSession = Depends(get_db),
) -> MerchantAlertResponse:
    from apps.api.modules.notifications.alert_service import MerchantAlertService

    return MerchantAlertResponse.model_validate(
        await MerchantAlertService(db).mark_read(business_id, alert_id, user_id, role)
    )


@router.post("/alerts/{alert_id}/dismiss", response_model=MerchantAlertResponse)
async def dismiss_merchant_alert(
    alert_id: UUID,
    body: MerchantAlertDismissRequest,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    role: str = Depends(get_current_role),
    db: AsyncSession = Depends(get_db),
) -> MerchantAlertResponse:
    from apps.api.modules.notifications.alert_service import MerchantAlertService

    return MerchantAlertResponse.model_validate(
        await MerchantAlertService(db).dismiss(business_id, alert_id, user_id, role, body.reason)
    )


@router.get("/deliveries", response_model=CustomerMessageListResponse)
async def list_customer_deliveries(
    limit: int = Query(50, ge=1, le=100),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> CustomerMessageListResponse:
    from apps.api.modules.notifications.delivery_service import CustomerDeliveryService

    messages = await CustomerDeliveryService(db).list_messages(business_id, limit)
    return CustomerMessageListResponse(
        items=[CustomerMessageResponse.model_validate(message) for message in messages]
    )


@router.post("/deliveries/{message_id}/retry", response_model=CustomerMessageResponse)
async def retry_customer_delivery(
    message_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> CustomerMessageResponse:
    from apps.api.modules.notifications.delivery_service import CustomerDeliveryService

    service = CustomerDeliveryService(db)
    message = await service.get_message(business_id, message_id)
    message = await service.deliver_message(message)
    return CustomerMessageResponse.model_validate(message)


@router.get("/preferences", response_model=NotificationPreferenceResponse)
async def get_preferences(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> NotificationPreferenceResponse:
    prefs = await NotificationService(db).get_or_create_preferences(business_id)
    return NotificationPreferenceResponse.model_validate(prefs)


@router.put("/preferences", response_model=NotificationPreferenceResponse)
async def update_preferences(
    body: NotificationPreferenceUpdate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> NotificationPreferenceResponse:
    prefs = await NotificationService(db).update_preferences(
        business_id,
        whatsapp_enabled=body.whatsapp_enabled,
        sms_enabled=body.sms_enabled,
        push_enabled=body.push_enabled,
        event_prefs=body.event_prefs,
    )
    return NotificationPreferenceResponse.model_validate(prefs)


@router.get("/events", response_model=list[NotificationEventResponse])
async def list_events(
    limit: int = Query(50, ge=1, le=100),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[NotificationEventResponse]:
    events = await NotificationService(db).list_events(business_id, limit)
    return [NotificationEventResponse.model_validate(event) for event in events]


@router.post("/events/{event_id}/retry", response_model=NotificationEventResponse)
async def retry_event(
    event_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> NotificationEventResponse:
    event = await NotificationService(db).retry_event(business_id, event_id)
    return NotificationEventResponse.model_validate(event)


@router.post("/bulk", response_model=BulkMessageResponse, status_code=201)
async def send_bulk_message(
    body: BulkMessageRequest,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> BulkMessageResponse:
    """Send bulk messages to customers, staff, or all contacts."""
    svc = NotificationService(db)
    result = await svc.send_bulk_message(business_id, user_id, body)
    return BulkMessageResponse.model_validate(result)


# ── AfricasTalking delivery report webhook ────────────────────────────────────


@router.post("/webhooks/sms/delivery", include_in_schema=False, status_code=200)
async def at_delivery_report(
    request: Request,
    # AfricasTalking posts these fields as form data
    message_id: str = Form(..., alias="id"),
    status: str = Form(..., alias="status"),
    phone_number: str = Form(..., alias="phoneNumber"),
    network_code: str = Form("", alias="networkCode"),
    failure_reason: str = Form("", alias="failureReason"),
    # AT includes the account username in the header for basic auth verification
    x_africastalking_username: str = Header("", alias="X-Africastalking-Username"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    AfricasTalking delivery report callback.

    AT posts a form-encoded payload to this URL whenever an SMS delivery status
    changes.  We verify the request came from AT by checking the
    X-Africastalking-Username header matches our configured AT username, then
    update the matching NotificationEvent status.

    AT delivery status values:
      Success   → delivered
      Failed    → failed
      Buffered  → pending (queued at the network)
      Rejected  → failed
      Sent      → sent (accepted by AT, not yet delivered)
    """
    from apps.api.core.config import get_settings

    settings = get_settings()
    from apps.api.core.webhook_security import mark_webhook_seen, require_webhook_ip

    require_webhook_ip(request, "africastalking", settings.WEBHOOK_ALLOWED_IPS_AT)
    if await mark_webhook_seen("africastalking", message_id):
        return {"status": "duplicate"}

    # ── Username verification ─────────────────────────────────────────────────
    # When AT_WEBHOOK_USERNAME is configured, reject callbacks from other sources.
    if settings.AT_WEBHOOK_USERNAME:
        if x_africastalking_username.lower() != settings.AT_WEBHOOK_USERNAME.lower():
            logger.warning(
                "at.delivery.invalid_username",
                received=x_africastalking_username,
            )
            # Return 200 to prevent AT retry storms; silently discard
            return {"status": "ignored"}

    # ── Map AT status to our internal status ──────────────────────────────────
    at_status_map = {
        "Success": "delivered",
        "Sent": "queued",
        "Buffered": "queued",
        "Failed": "failed",
        "Rejected": "failed",
    }
    new_status = at_status_map.get(status, "queued")

    logger.info(
        "at.delivery.received",
        message_id=message_id,
        phone=phone_number[-4:],
        at_status=status,
        new_status=new_status,
    )

    # ── Find the matching NotificationEvent by AT message ID in provider_response
    # The message ID is stored inside provider_response when the SMS was sent.
    # We do a JSONB path query: provider_response->>'message_id' = message_id
    # or provider_response->'SMSMessageData'->'Recipients'->0->>'messageId' = ...
    try:
        # Try direct messageId match stored at top level of provider_response
        result = await db.execute(
            select(NotificationEvent)
            .where(
                NotificationEvent.channel == "sms",
                NotificationEvent.phone == phone_number,
                # Match via JSONB: look for the AT messageId in Recipients array
                NotificationEvent.provider_response["SMSMessageData"]["Recipients"][0][
                    "messageId"
                ].as_string()
                == message_id,
            )
            .order_by(NotificationEvent.created_at.desc())
            .limit(1)
        )
        event = result.scalar_one_or_none()

        if not event:
            # Fallback: match by phone + channel + pending status (most recent)
            result = await db.execute(
                select(NotificationEvent)
                .where(
                    NotificationEvent.channel == "sms",
                    NotificationEvent.phone == phone_number,
                    NotificationEvent.status.in_(["pending", "sent"]),
                )
                .order_by(NotificationEvent.created_at.desc())
                .limit(1)
            )
            event = result.scalar_one_or_none()

        if event:
            event.status = new_status
            # Merge delivery details into provider_response
            existing = event.provider_response or {}
            event.provider_response = {
                **existing,
                "delivery": {
                    "at_message_id": message_id,
                    "at_status": status,
                    "network_code": network_code,
                    "failure_reason": failure_reason or None,
                },
            }
            if new_status == "sent":
                from datetime import datetime, timezone

                event.sent_at = event.sent_at or datetime.now(timezone.utc)
            await db.flush([event])
            logger.info(
                "at.delivery.updated",
                event_id=str(event.id),
                status=new_status,
            )
        else:
            logger.warning(
                "at.delivery.event_not_found",
                message_id=message_id,
                phone=phone_number[-4:],
            )

        from datetime import datetime, timezone

        from apps.api.modules.notifications.models import CustomerMessage, DeliveryAttempt

        attempt = await db.scalar(
            select(DeliveryAttempt).where(DeliveryAttempt.provider_reference == message_id)
        )
        if attempt:
            attempt.status = new_status
            attempt.completed_at = (
                datetime.now(timezone.utc) if new_status in {"delivered", "failed"} else None
            )
            if new_status == "failed":
                attempt.failure_category = "temporary_provider_failure"
                attempt.failure_detail = "The message could not be delivered."
            customer_message = await db.get(CustomerMessage, attempt.customer_message_id)
            if customer_message:
                customer_message.status = new_status
                customer_message.completed_at = attempt.completed_at
            await db.flush()

    except Exception as exc:
        # Never let webhook processing failures break the 200 response;
        # AT would retry if we return non-200, causing duplicate processing.
        logger.error("at.delivery.processing_error", error=str(exc))

    return {"status": "ok"}


# ── SSE notification stream ───────────────────────────────────────────────────


@router.get("/stream")
async def notification_stream(
    query_business_id: UUID | None = Query(None, alias="business_id"),
    current_business_id: UUID = Depends(get_current_business_id),
) -> StreamingResponse:
    """SSE stream for real-time notification events for a business.

    Clients connect with EventSource and receive JSON events.
    A keepalive comment is sent every 30 seconds when there is no message activity.

    The optional ``business_id`` query parameter lets admins and lenders subscribe
    to *any* business stream.  When omitted the JWT-authenticated business is used.
    """
    # Admins/lenders may pass ?business_id=<uuid> to monitor another business.
    target_business_id = query_business_id if query_business_id is not None else current_business_id

    import asyncio
    import json

    import redis.asyncio as aioredis

    from apps.api.core.config import get_settings

    settings = get_settings()

    async def event_generator():
        redis_client = None
        pubsub = None
        try:
            redis_client = await aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            pubsub = redis_client.pubsub()
            await pubsub.subscribe(f"notifications:{target_business_id}")
            while True:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=29.0)
                if msg and msg["type"] == "message":
                    data = msg["data"]
                    if isinstance(data, bytes):
                        data = data.decode()
                    yield f"data: {data}\n\n"
                else:
                    yield ": keepalive\n\n"
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            # Client disconnected — clean exit, no error payload.
            pass
        except Exception as exc:
            logger.error("sse.stream_error", business_id=str(target_business_id), error=str(exc))
            yield f"data: {json.dumps({'error': 'stream_error'})}\n\n"
        finally:
            if pubsub:
                await pubsub.unsubscribe()
            if redis_client:
                await redis_client.aclose()  # type: ignore[attr-defined]

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
