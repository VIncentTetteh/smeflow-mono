"""Notification provider abstraction for WhatsApp and SMS delivery."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import UUID

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.config import get_settings
from apps.api.modules.auth.models import User
from apps.api.modules.business.models import Business
from apps.api.modules.notifications.models import NotificationEvent, NotificationPreference

if TYPE_CHECKING:
    from apps.api.modules.notifications.schemas import BulkMessageRequest

logger = structlog.get_logger()


async def send_email(
    to: str,
    subject: str,
    html: str,
    from_address: str | None = None,
) -> None:
    """Send transactional email via Resend. Silently skips if RESEND_API_KEY is not set."""
    settings = get_settings()
    if not settings.RESEND_API_KEY:
        return
    import resend  # surfaced here so ImportError is visible before the try

    resend.api_key = settings.RESEND_API_KEY
    try:
        await asyncio.to_thread(
            resend.Emails.send,
            {
                "from": from_address or settings.RESEND_FROM_EMAIL,
                "to": [to],
                "subject": subject,
                "html": html,
            },
        )
        logger.info("email.sent", to_domain=to.split("@")[-1] if "@" in to else "unknown")
    except Exception as exc:
        logger.error("email.send_failed", error=str(exc))


@dataclass
class NotificationMessage:
    phone: str
    text: str
    media_url: str | None = None
    device_token: str | None = None


class NotificationDispatcher:
    """Dispatch notifications through configured customer channels."""

    async def send(
        self, message: NotificationMessage, channel: str | None = None
    ) -> dict[str, str]:
        settings = get_settings()
        if channel == "whatsapp" or (
            channel is None and settings.WHATSAPP_ACCESS_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID
        ):
            if not settings.WHATSAPP_ACCESS_TOKEN or not settings.WHATSAPP_PHONE_NUMBER_ID:
                return {"status": "skipped", "channel": "whatsapp"}
            return await self._send_whatsapp(message)
        if channel == "sms" or (
            channel is None and (settings.HUBTEL_CLIENT_ID or settings.AT_API_KEY)
        ):
            if not settings.HUBTEL_CLIENT_ID and not settings.AT_API_KEY:
                return {"status": "skipped", "channel": "sms"}
            return await self._send_sms(message)
        if channel == "push":
            if not settings.FCM_SERVER_KEY or not message.device_token:
                return {"status": "skipped", "channel": "push"}
            return await self._send_push(message)

        logger.info("notification.skipped_no_provider", phone=message.phone[-4:])
        return {"status": "skipped", "channel": "none"}

    async def _send_whatsapp(self, message: NotificationMessage) -> dict[str, str]:
        settings = get_settings()
        if settings.WHATSAPP_ACCESS_TOKEN.startswith(
            "your-"
        ) or settings.WHATSAPP_PHONE_NUMBER_ID.startswith("your-"):
            return {"status": "skipped", "channel": "whatsapp"}
        url = f"https://graph.facebook.com/v18.0/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
        payload: dict = {"messaging_product": "whatsapp", "to": message.phone}
        if self._is_http_pdf_url(message.media_url):
            payload.update(
                {
                    "type": "document",
                    "document": {
                        "link": message.media_url,
                        "filename": "invoice.pdf",
                        "caption": message.text,
                    },
                }
            )
        else:
            payload.update(
                {
                    "type": "text",
                    "text": {"body": message.text, "preview_url": bool(message.media_url)},
                }
            )
        headers = {
            "Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}",
            "Content-Type": "application/json",
        }
        try:
            from apps.api.core.circuit_breaker import CircuitBreaker

            async def _call() -> dict:
                async with httpx.AsyncClient(timeout=10) as client:
                    response = await client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    return response.json() if hasattr(response, "json") else {}

            provider_data = await CircuitBreaker("whatsapp").call(_call)
            messages = provider_data.get("messages") if isinstance(provider_data, dict) else None
            provider_reference = (
                messages[0].get("id")
                if isinstance(messages, list) and messages and isinstance(messages[0], dict)
                else None
            )
            result = {"status": "sent", "channel": "whatsapp"}
            if provider_reference:
                result["provider_reference"] = provider_reference
            return result
        except Exception as exc:
            logger.error(
                "whatsapp.sending_failed",
                phone=message.phone[-4:],
                error=str(exc),
            )
            return {"status": "failed", "channel": "whatsapp", "error": str(exc)}

    def _is_http_pdf_url(self, media_url: str | None) -> bool:
        if not media_url:
            return False
        normalized = media_url.lower().split("?", 1)[0]
        return normalized.startswith(("http://", "https://")) and normalized.endswith(".pdf")

    async def _send_sms(self, message: NotificationMessage) -> dict[str, str]:
        settings = get_settings()
        try:
            from apps.api.core.circuit_breaker import CircuitBreaker

            if settings.HUBTEL_CLIENT_ID:
                from libs.hubtel_sms import HubtelSmsClient

                sms = HubtelSmsClient()

                async def _call() -> dict:
                    return await sms.send(message.phone, message.text)

                provider_data = await CircuitBreaker("hubtel_sms").call(_call)
            else:
                # Fallback: Africa's Talking
                async def _call() -> dict:  # type: ignore[no-redef]
                    async with httpx.AsyncClient(
                        timeout=30,
                        headers={
                            "apiKey": settings.AT_API_KEY,
                            "Content-Type": "application/x-www-form-urlencoded",
                            "Accept": "application/json",
                        },
                    ) as client:
                        response = await client.post(
                            "https://api.africastalking.com/version1/messaging",
                            data={
                                "username": settings.AT_USERNAME,
                                "to": message.phone,
                                "message": message.text,
                                "from": settings.AT_SENDER_ID,
                            },
                        )
                        response.raise_for_status()
                        return response.json() if hasattr(response, "json") else {}

                provider_data = await CircuitBreaker("africastalking").call(_call)

            logger.info("SMS sent successfully", phone=message.phone[-4:])
            provider_reference = None
            if isinstance(provider_data, dict):
                provider_reference = provider_data.get("messageId") or provider_data.get("message_id")
                sms_data = provider_data.get("SMSMessageData")
                recipients = sms_data.get("Recipients") if isinstance(sms_data, dict) else None
                if not provider_reference and isinstance(recipients, list) and recipients:
                    first = recipients[0]
                    if isinstance(first, dict):
                        provider_reference = first.get("messageId")
            result = {"status": "sent", "channel": "sms"}
            if provider_reference:
                result["provider_reference"] = provider_reference
            return result
        except Exception as e:
            logger.error(
                "SMS sending failed",
                phone=message.phone[-4:],
                error=str(e),
                error_type=type(e).__name__,
            )
            return {"status": "failed", "channel": "sms", "error": str(e)}

    async def _send_push(self, message: NotificationMessage) -> dict[str, str]:
        settings = get_settings()
        try:
            from apps.api.core.circuit_breaker import CircuitBreaker

            async def _call() -> None:
                async with httpx.AsyncClient(timeout=10) as client:
                    response = await client.post(
                        "https://fcm.googleapis.com/fcm/send",
                        headers={
                            "Authorization": f"key={settings.FCM_SERVER_KEY}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "to": message.device_token,
                            "notification": {"title": "SMEFlow", "body": message.text},
                            "data": {"message": message.text},
                        },
                    )
                    response.raise_for_status()

            await CircuitBreaker("fcm").call(_call)
            return {"status": "sent", "channel": "push"}
        except Exception as exc:
            logger.error("push.sending_failed", error=str(exc))
            return {"status": "failed", "channel": "push", "error": str(exc)}


DEFAULT_EVENT_PREFS = {
    "sale.recorded": {"whatsapp": True, "sms": False},
    "payment.confirmed": {"whatsapp": True, "sms": True, "push": True},
    "payment.failed": {"whatsapp": False, "sms": False, "push": True},
    "stock.low": {"whatsapp": False, "sms": False, "push": True},
    "stock.low.digest": {"whatsapp": False, "sms": False, "push": True},
    "sales.daily.summary": {"whatsapp": True, "sms": False},
    "receivable.payment_reminder": {"whatsapp": True, "sms": False},
    "invoice.payment_reminder": {"whatsapp": True, "sms": False},
    "sync.failed": {"whatsapp": False, "sms": False, "push": True},
    "tax.deadline": {"whatsapp": True, "sms": True},
    "credit.offer": {"whatsapp": True, "sms": True, "push": True},
    "payroll.run_complete": {"whatsapp": True, "sms": False},
    "invoice.sent": {"whatsapp": True, "sms": False},
    # Billing dunning — always on (SMS fallback), user cannot fully opt out via prefs
    "billing.payment_failed": {"whatsapp": True, "sms": True},
    "billing.payment_failed_final_warning": {"whatsapp": True, "sms": True},
    "billing.subscription_downgraded": {"whatsapp": True, "sms": True},
    "billing.subscription_renewed": {"whatsapp": True, "sms": False},
    "billing.referral_reward": {"whatsapp": True, "sms": False},
    "kyc_reviewed": {"whatsapp": False, "sms": False, "push": False, "email": False},
    "loan_status_changed": {"whatsapp": True, "sms": True, "push": True, "email": True},
    "commission_earned": {"whatsapp": True, "sms": True, "push": True},
    "subscription_changed": {"whatsapp": True, "sms": True, "push": True, "email": True},
}


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_or_create_preferences(self, business_id: UUID) -> NotificationPreference:
        result = await self.db.execute(
            select(NotificationPreference).where(NotificationPreference.business_id == business_id)
        )
        prefs = result.scalar_one_or_none()
        if prefs:
            return prefs
        prefs = NotificationPreference(business_id=business_id, event_prefs=DEFAULT_EVENT_PREFS)
        self.db.add(prefs)
        await self.db.flush([prefs])
        return prefs

    async def update_preferences(
        self,
        business_id: UUID,
        whatsapp_enabled: bool | None = None,
        sms_enabled: bool | None = None,
        push_enabled: bool | None = None,
        event_prefs: dict | None = None,
    ) -> NotificationPreference:
        prefs = await self.get_or_create_preferences(business_id)
        if whatsapp_enabled is not None:
            prefs.whatsapp_enabled = whatsapp_enabled
        if sms_enabled is not None:
            prefs.sms_enabled = sms_enabled
        if push_enabled is not None:
            prefs.push_enabled = push_enabled
        if event_prefs is not None:
            prefs.event_prefs = {**(prefs.event_prefs or {}), **event_prefs}
        await self.db.flush([prefs])
        await self.db.refresh(prefs)
        return prefs

    async def list_events(self, business_id: UUID, limit: int = 50) -> list[NotificationEvent]:
        result = await self.db.execute(
            select(NotificationEvent)
            .where(NotificationEvent.business_id == business_id)
            .order_by(NotificationEvent.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def retry_event(self, business_id: UUID, event_id: UUID) -> NotificationEvent:
        from fastapi import HTTPException

        result = await self.db.execute(
            select(NotificationEvent).where(
                NotificationEvent.id == event_id,
                NotificationEvent.business_id == business_id,
            )
        )
        event = result.scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Notification event not found")
        if not event.retryable:
            raise HTTPException(status_code=400, detail="Notification event is not retryable")

        previous_response = event.provider_response or {}
        retry_attempt = int(previous_response.get("retry_attempt", 0)) + 1
        result_payload = await NotificationDispatcher().send(
            NotificationMessage(
                phone=event.phone,
                text=event.message,
                media_url=previous_response.get("media_url"),
            ),
            channel=event.channel,
        )

        event.status = result_payload["status"]
        event.provider_response = {
            **result_payload,
            "retry_attempt": retry_attempt,
            "previous_status": previous_response.get("status"),
            "previous_error": previous_response.get("error"),
        }
        if result_payload["status"] == "sent":
            event.sent_at = datetime.now(timezone.utc)
        await self.db.flush([event])
        await self.db.refresh(event)
        return event

    async def dispatch_event(
        self, business_id: UUID, event_type: str, data: dict
    ) -> list[NotificationEvent]:
        business_result = await self.db.execute(select(Business).where(Business.id == business_id))
        business = business_result.scalar_one_or_none()
        if not business:
            return []

        owner_result = await self.db.execute(select(User).where(User.id == business.owner_id))
        owner = owner_result.scalar_one_or_none()
        if not owner:
            return []

        await self._route_merchant_alert(business_id, event_type, data)
        prefs = await self.get_or_create_preferences(business_id)
        phone = data.get("phone") or owner.phone
        message = self.render(event_type, data)
        channels = self._enabled_channels(prefs, event_type)
        dispatcher = NotificationDispatcher()
        events: list[NotificationEvent] = []

        for channel in channels:
            device_tokens: list[str | None] = [None]
            if channel == "push":
                from datetime import timedelta

                from apps.api.modules.notifications.models import DeviceToken

                stale_cutoff = datetime.now(timezone.utc) - timedelta(days=90)
                token_rows = (
                    (
                        await self.db.execute(
                            select(DeviceToken).where(
                                DeviceToken.user_id == owner.id,
                                DeviceToken.is_active.is_(True),
                                DeviceToken.last_seen_at >= stale_cutoff,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                device_tokens = [row.token for row in token_rows] or [None]

            event = NotificationEvent(
                business_id=business_id,
                event_type=event_type,
                channel=channel,
                phone=phone,
                message=message,
                status="pending",
            )
            self.db.add(event)
            await self.db.flush([event])

            result = {"status": "skipped", "channel": channel}
            for device_token in device_tokens:
                result = await dispatcher.send(
                    NotificationMessage(
                        phone=phone,
                        text=message,
                        media_url=data.get("pdf_url"),
                        device_token=device_token,
                    ),
                    channel=channel,
                )
                if result["status"] == "sent":
                    break

            # ── WhatsApp → SMS fallback ───────────────────────────────────────
            # When WhatsApp delivery fails and SMS is not already in the channel
            # list (to avoid double-sending), attempt SMS as a fallback —
            # provided the business has SMS globally enabled and has not
            # explicitly opted out of SMS for this event type.
            if (
                channel == "whatsapp"
                and result["status"] == "failed"
                and "sms" not in channels
                and self._sms_allowed_for_event(prefs, event_type)
            ):
                logger.info(
                    "notification.whatsapp_fallback_to_sms",
                    event_type=event_type,
                    phone=phone[-4:],
                )
                sms_result = await dispatcher.send(
                    NotificationMessage(phone=phone, text=message),
                    channel="sms",
                )
                if sms_result["status"] == "sent":
                    # Record a separate event row for the fallback SMS so the
                    # audit log is transparent (original WhatsApp attempt stays
                    # as "failed"; the SMS row is "sent").
                    fallback_event = NotificationEvent(
                        business_id=business_id,
                        event_type=event_type,
                        channel="sms",
                        phone=phone,
                        message=message,
                        status="sent",
                        sent_at=datetime.now(timezone.utc),
                        provider_response={**sms_result, "fallback_from": "whatsapp"},
                    )
                    self.db.add(fallback_event)
                    await self.db.flush([fallback_event])
                    events.append(fallback_event)
                    logger.info(
                        "notification.fallback_sms_sent",
                        event_type=event_type,
                        phone=phone[-4:],
                    )
                else:
                    logger.warning(
                        "notification.fallback_sms_failed",
                        event_type=event_type,
                        phone=phone[-4:],
                        error=sms_result.get("error"),
                    )

            event.status = result["status"]
            event.provider_response = result
            if result["status"] == "sent":
                event.sent_at = datetime.now(timezone.utc)
            events.append(event)

        await self.db.flush()

        # Publish to Redis pub/sub for SSE stream (non-blocking, fire-and-forget)
        try:
            import json

            import redis.asyncio as aioredis

            settings = get_settings()
            r = await aioredis.from_url(settings.REDIS_URL)
            payload = json.dumps(
                {
                    "business_id": str(business_id),
                    "event_type": event_type,
                    "message": message,
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            )
            await r.publish(f"notifications:{business_id}", payload)
            await r.aclose()  # type: ignore[attr-defined]
        except Exception as exc:
            # Never fail dispatch because Redis is unavailable
            logger.warning("sse.publish_failed", error=str(exc))

        # ── Email dispatch ────────────────────────────────────────────────────
        # Send an email notification when the "email" channel is enabled via
        # the business's email address stored in the businesses table.
        if "email" in channels:
            business_email = await self._get_business_email(business_id)
            if business_email:
                await send_email(
                    to=business_email,
                    subject=f"SMEflow: {event_type.replace('_', ' ').title()}",
                    html=f"<p>{message}</p>",
                )

        return events

    async def _route_merchant_alert(self, business_id: UUID, event_type: str, data: dict) -> None:
        """Create or resolve actionable merchant alerts without exposing provider details."""
        from apps.api.modules.notifications.alert_service import MerchantAlertService

        service = MerchantAlertService(self.db)
        reference = str(
            data.get("reference")
            or data.get("payment_id")
            or data.get("item_id")
            or data.get("resource_id")
            or event_type
        )
        if event_type == "payment.confirmed":
            await service.resolve(business_id, f"payment_failure:{reference}")
            return
        configs = {
            "payment.failed": (
                "critical",
                "Payment failed",
                "Retry the payment or collect another way.",
                "payment",
                f"/owner/payments-history?payment_id={reference}",
                "Open payment",
            ),
            "sync.failed": (
                "critical",
                "Sync needs attention",
                "Some offline changes could not be synchronized. Review them before continuing.",
                "sync",
                "/owner/sync",
                "Review sync",
            ),
            "stock.low": (
                "operational",
                "Stock is running low",
                f"{data.get('item_name', 'An item')} needs restocking.",
                "item",
                f"/owner/stock?item_id={reference}",
                "Open stock",
            ),
            "stock.low.digest": (
                "operational",
                "Several items need restocking",
                "Review the low-stock items and plan a restock.",
                "stock",
                "/owner/stock",
                "Review stock",
            ),
            "kyc_reviewed": (
                "operational",
                "KYC review updated",
                str(data.get("message") or "Your KYC review status changed."),
                "kyc",
                "/owner/kyc-status",
                "Open KYC",
            ),
        }
        config = configs.get(event_type)
        if not config:
            return
        severity, title, message, resource_type, action_path, action_label = config
        await service.upsert_alert(
            business_id=business_id,
            alert_type=event_type.replace(".", "_"),
            severity=severity,
            dedupe_key=f"{event_type}:{reference}",
            title=title,
            message=message,
            resource_type=resource_type,
            resource_id=reference,
            action_path=action_path,
            action_label=action_label,
        )

    def render(self, event_type: str, data: dict) -> str:
        from apps.api.workers.tasks.notification_tasks import TEMPLATES

        template = TEMPLATES.get(event_type, "SME Flow notification: {event_type}")
        try:
            return template.format(**data, event_type=event_type)
        except KeyError:
            return f"SME Flow notification: {event_type}"

    def _enabled_channels(self, prefs: NotificationPreference, event_type: str) -> list[str]:
        # Merge platform defaults with business-specific overrides so that
        # unknown events still fall back to sensible defaults rather than being
        # silently suppressed when the business has *any* event_prefs stored.
        default_for_event = DEFAULT_EVENT_PREFS.get(event_type, {"whatsapp": True, "sms": False})
        stored_for_event = (prefs.event_prefs or {}).get(event_type, {})
        event_channel_prefs: dict = {**default_for_event, **stored_for_event}

        channels: list[str] = []
        if prefs.whatsapp_enabled and event_channel_prefs.get("whatsapp", False):
            channels.append("whatsapp")
        if prefs.sms_enabled and event_channel_prefs.get("sms", False):
            channels.append("sms")
        if prefs.push_enabled and event_channel_prefs.get("push", False):
            channels.append("push")
        if event_channel_prefs.get("email", False):
            channels.append("email")
        return channels

    def _sms_allowed_for_event(self, prefs: NotificationPreference, event_type: str) -> bool:
        """Return True if SMS is globally enabled and not explicitly disabled for this event."""
        if not prefs.sms_enabled:
            return False
        default_for_event = DEFAULT_EVENT_PREFS.get(event_type, {"sms": False})
        stored_for_event = (prefs.event_prefs or {}).get(event_type, {})
        merged = {**default_for_event, **stored_for_event}
        # Any explicit False blocks the fallback; default True allows it.
        return merged.get("sms", False) is not False

    async def _get_business_email(self, business_id: UUID) -> str | None:
        """Return the business's stored email address, or None if not set."""
        result = await self.db.execute(select(Business.email).where(Business.id == business_id))
        return result.scalar_one_or_none()

    async def send_bulk_message(
        self, business_id: UUID, user_id: UUID, request: BulkMessageRequest
    ) -> dict:
        """Send bulk messages to specified recipient groups."""
        from uuid import uuid4

        from fastapi import HTTPException
        from sqlalchemy import select

        from apps.api.core.config import get_settings
        from apps.api.core.redis import RedisCache, get_idempotency_redis
        from apps.api.modules.billing.service import BillingService
        from apps.api.modules.business.models import BusinessMember
        from apps.api.modules.payroll.models import Employee
        from apps.api.modules.sales.models import Customer

        # Get recipient phones based on type
        phones_list: list[str] = []
        if request.recipient_type == "customers":
            cust_db = await self.db.execute(
                select(Customer.phone)
                .where(Customer.business_id == business_id, Customer.phone.isnot(None))
                .distinct()
            )
            phones_list = [row[0] for row in cust_db.all() if row[0]]
        elif request.recipient_type == "staff":
            # Get both business members and employees
            member_result = await self.db.execute(
                select(BusinessMember.user_id).where(BusinessMember.business_id == business_id)
            )
            member_user_ids = [row[0] for row in member_result.all()]

            employee_result = await self.db.execute(
                select(Employee.phone)
                .where(Employee.business_id == business_id, Employee.phone.isnot(None))
                .distinct()
            )

            # Get user phones for business members
            from apps.api.modules.auth.models import User

            user_result = await self.db.execute(
                select(User.phone)
                .where(User.id.in_(member_user_ids), User.phone.isnot(None))
                .distinct()
            )

            phones_set: set[str] = set()
            for employee_phone_row in employee_result.all():
                phones_set.add(employee_phone_row[0])
            for user_phone_row in user_result.all():
                phones_set.add(user_phone_row[0])
            phones_list = list(phones_set)
        elif request.recipient_type == "all":
            # Combine customers, staff, and business owner
            customer_result = await self.db.execute(
                select(Customer.phone)
                .where(Customer.business_id == business_id, Customer.phone.isnot(None))
                .distinct()
            )

            member_result = await self.db.execute(
                select(BusinessMember.user_id).where(BusinessMember.business_id == business_id)
            )
            member_user_ids = [row[0] for row in member_result.all()]

            employee_result = await self.db.execute(
                select(Employee.phone)
                .where(Employee.business_id == business_id, Employee.phone.isnot(None))
                .distinct()
            )

            from apps.api.modules.auth.models import User

            user_result = await self.db.execute(
                select(User.phone)
                .where(User.id.in_(member_user_ids), User.phone.isnot(None))
                .distinct()
            )

            # Get business owner phone
            business_result = await self.db.execute(
                select(Business.owner_id).where(Business.id == business_id)
            )
            owner_id = business_result.scalar_one_or_none()
            owner_phone = None
            if owner_id:
                owner_result = await self.db.execute(select(User.phone).where(User.id == owner_id))
                owner_phone = owner_result.scalar_one_or_none()

            all_phones: set[str] = set()
            for customer_phone_row in customer_result.all():
                all_phones.add(customer_phone_row[0])
            for employee_phone_row in employee_result.all():
                all_phones.add(employee_phone_row[0])
            for user_phone_row in user_result.all():
                all_phones.add(user_phone_row[0])
            if owner_phone:
                all_phones.add(owner_phone)
            phones_list = list(all_phones)
        else:
            raise ValueError(f"Invalid recipient_type: {request.recipient_type}")

        recipient_phones = [phone for phone in phones_list if phone]
        recipient_count = len(recipient_phones)

        subscription = await BillingService(self.db).get_subscription(business_id)
        plan_limits = {
            "free": get_settings().BULK_SMS_DAILY_LIMIT,
            "starter": max(get_settings().BULK_SMS_DAILY_LIMIT, 100),
            "pro": 1_000,
        }
        daily_limit = plan_limits.get(subscription.plan, get_settings().BULK_SMS_DAILY_LIMIT)
        if request.channel == "sms":
            cache = RedisCache(get_idempotency_redis(), prefix="bulk_sms_daily")
            today = datetime.now(timezone.utc).strftime("%Y%m%d")
            key = f"{business_id}:{today}"
            already_sent = int(await cache.get(key) or 0)
            if already_sent + recipient_count > daily_limit:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Daily bulk SMS limit exceeded for {subscription.plan} plan "
                        f"({daily_limit}/day)."
                    ),
                )
            await cache.set(key, already_sent + recipient_count, ttl=90_000)

        # Create bulk message record (for tracking)
        message_id = uuid4()

        # Send to each recipient
        sent_count = 0
        for phone in recipient_phones:
            message = NotificationMessage(phone=phone, text=request.message)
            send_result = await NotificationDispatcher().send(message, channel=request.channel)
            if send_result["status"] == "sent":
                sent_count += 1

            # Log the event
            event = NotificationEvent(
                business_id=business_id,
                event_type="bulk.message",
                channel=request.channel,
                phone=phone,
                message=request.message,
                status=send_result["status"],
                provider_response=send_result,
            )
            if send_result["status"] == "sent":
                event.sent_at = datetime.now(timezone.utc)
            self.db.add(event)

        # Flush so events get IDs; commit is handled by the get_db() unit-of-work.
        await self.db.flush()

        # Estimate cost (rough calculation)
        estimated_cost = None
        if request.channel == "sms":
            estimated_cost = recipient_count * 0.05  # Rough SMS cost estimate
        elif request.channel == "whatsapp":
            estimated_cost = recipient_count * 0.01  # Rough WhatsApp cost estimate

        return {
            "message_id": message_id,
            "recipient_count": recipient_count,
            "status": "completed" if sent_count == recipient_count else "partial",
            "estimated_cost": estimated_cost,
        }
