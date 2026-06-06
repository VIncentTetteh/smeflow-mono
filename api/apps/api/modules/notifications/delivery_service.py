"""Consent-aware customer message and delivery history service."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.api.modules.notifications.models import CustomerMessage, DeliveryAttempt

SAFE_FAILURE_DETAILS = {
    "temporary_provider_failure": "The provider is temporarily unavailable.",
    "rate_limited": "The provider temporarily limited delivery attempts.",
    "network_failure": "The message provider could not be reached.",
    "invalid_recipient": "The customer phone number is invalid or unreachable.",
    "recipient_opted_out": "The customer opted out of messages.",
    "provider_authentication_failure": "Provider authentication failed.",
    "provider_configuration_failure": "The message provider is not configured correctly.",
    "content_rejected": "The provider rejected the message content.",
    "unknown_failure": "The message could not be delivered.",
}


class CustomerDeliveryService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_message(
        self,
        *,
        business_id: UUID,
        message_type: str,
        recipient_phone: str | None,
        body: str,
        preferred_channel: str,
        idempotency_key: str,
        consent_status: str,
        related_resource_type: str | None = None,
        related_resource_id: str | None = None,
        customer_id: UUID | None = None,
        consent_source: str | None = None,
        consent_at: datetime | None = None,
    ) -> CustomerMessage:
        existing = await self.db.scalar(
            select(CustomerMessage).where(
                CustomerMessage.business_id == business_id,
                CustomerMessage.idempotency_key == idempotency_key,
            )
        )
        if existing:
            return existing
        now = datetime.now(timezone.utc)
        skipped = not recipient_phone or (
            message_type == "credit_reminder" and consent_status != "granted"
        )
        message = CustomerMessage(
            business_id=business_id,
            customer_id=customer_id,
            message_type=message_type,
            recipient_phone=recipient_phone,
            body=body,
            preferred_channel=preferred_channel,
            consent_status=consent_status,
            consent_source=consent_source,
            consent_at=consent_at,
            idempotency_key=idempotency_key,
            related_resource_type=related_resource_type,
            related_resource_id=related_resource_id,
            status="skipped" if skipped else "requested",
            completed_at=now if skipped else None,
            retention_until=now + timedelta(days=365),
        )
        self.db.add(message)
        await self.db.flush([message])
        return message

    async def record_attempt(
        self,
        message: CustomerMessage,
        *,
        channel: str,
        provider: str,
        status: str,
        failure_category: str | None = None,
        failure_detail: str | None = None,
        provider_reference: str | None = None,
        fallback_from: str | None = None,
    ) -> DeliveryAttempt:
        attempt_number = (
            await self.db.scalar(
                select(func.count(DeliveryAttempt.id)).where(
                    DeliveryAttempt.customer_message_id == message.id
                )
            )
        ) or 0
        safe_detail = SAFE_FAILURE_DETAILS.get(failure_category or "", None)
        attempt = DeliveryAttempt(
            customer_message_id=message.id,
            channel=channel,
            provider=provider,
            attempt_number=int(attempt_number) + 1,
            status=status,
            provider_reference=provider_reference,
            failure_category=failure_category,
            failure_detail=safe_detail,
            fallback_from=fallback_from,
            completed_at=datetime.now(timezone.utc) if status in {"delivered", "failed"} else None,
        )
        self.db.add(attempt)
        message.status = status
        if status in {"delivered", "failed", "skipped", "opted_out", "cancelled"}:
            message.completed_at = datetime.now(timezone.utc)
        await self.db.flush([attempt, message])
        return attempt

    async def list_messages(self, business_id: UUID, limit: int = 50) -> list[CustomerMessage]:
        rows = (
            (
                await self.db.execute(
                    select(CustomerMessage)
                    .where(CustomerMessage.business_id == business_id)
                    .options(selectinload(CustomerMessage.attempts))
                    .order_by(CustomerMessage.created_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        return list(rows)

    async def get_message(self, business_id: UUID, message_id: UUID) -> CustomerMessage:
        message = await self.db.scalar(
            select(CustomerMessage)
            .where(CustomerMessage.id == message_id, CustomerMessage.business_id == business_id)
            .options(selectinload(CustomerMessage.attempts))
        )
        if not message:
            raise HTTPException(status_code=404, detail="Customer message not found")
        return message

    async def get_message_by_id(self, message_id: UUID) -> CustomerMessage:
        message = await self.db.scalar(
            select(CustomerMessage)
            .where(CustomerMessage.id == message_id)
            .options(selectinload(CustomerMessage.attempts))
        )
        if not message:
            raise HTTPException(status_code=404, detail="Customer message not found")
        return message

    async def deliver_message(
        self, message: CustomerMessage, *, whatsapp_max_attempts: int = 3
    ) -> CustomerMessage:
        """Attempt WhatsApp first, then SMS fallback, and alert only on final failure."""
        from apps.api.modules.notifications.alert_service import MerchantAlertService
        from apps.api.modules.notifications.service import (
            NotificationDispatcher,
            NotificationMessage,
        )

        if message.status in {"skipped", "opted_out", "cancelled", "delivered"}:
            return message
        if not message.recipient_phone:
            message.status = "skipped"
            message.completed_at = datetime.now(timezone.utc)
            await self.db.flush([message])
            return message

        dispatcher = NotificationDispatcher()
        whatsapp_failures = 0
        for _ in range(max(1, whatsapp_max_attempts)):
            result = await dispatcher.send(
                NotificationMessage(phone=message.recipient_phone, text=message.body),
                channel="whatsapp",
            )
            if result["status"] in {"sent", "delivered"}:
                await self.record_attempt(
                    message,
                    channel="whatsapp",
                    provider="meta",
                    status="delivered" if result["status"] == "delivered" else "queued",
                    provider_reference=result.get("provider_reference"),
                )
                await self.db.refresh(message, attribute_names=["attempts"])
                return message
            whatsapp_failures += 1
            await self.record_attempt(
                message,
                channel="whatsapp",
                provider="meta",
                status="failed",
                failure_category=self._classify_failure(result.get("error")),
                failure_detail=result.get("error"),
            )

        sms_result = await dispatcher.send(
            NotificationMessage(phone=message.recipient_phone, text=message.body),
            channel="sms",
        )
        if sms_result["status"] in {"sent", "delivered"}:
            await self.record_attempt(
                message,
                channel="sms",
                provider="sms",
                status="delivered" if sms_result["status"] == "delivered" else "queued",
                provider_reference=sms_result.get("provider_reference"),
                fallback_from="whatsapp",
            )
            await self.db.refresh(message, attribute_names=["attempts"])
            return message

        await self.record_attempt(
            message,
            channel="sms",
            provider="sms",
            status="failed",
            failure_category=self._classify_failure(sms_result.get("error")),
            failure_detail=sms_result.get("error"),
            fallback_from="whatsapp",
        )
        await MerchantAlertService(self.db).upsert_alert(
            business_id=message.business_id,
            alert_type="customer_delivery_final_failure",
            severity="critical",
            dedupe_key=f"customer_delivery_final_failure:{message.id}",
            title="Customer message could not be delivered",
            message="WhatsApp and SMS delivery failed. Retry the message or share it manually.",
            resource_type="customer_message",
            resource_id=str(message.id),
            action_path=f"/owner/message-deliveries?message_id={message.id}",
            action_label="Open delivery",
        )
        await self.db.refresh(message, attribute_names=["attempts"])
        return message

    def _classify_failure(self, error: object) -> str:
        text = str(error or "").lower()
        if "401" in text or "unauthorized" in text or "authentication" in text:
            return "provider_authentication_failure"
        if "invalid" in text or "recipient" in text or "phone" in text:
            return "invalid_recipient"
        if "rate" in text or "429" in text:
            return "rate_limited"
        if "timeout" in text or "network" in text or "connect" in text:
            return "network_failure"
        if "config" in text or "not configured" in text:
            return "provider_configuration_failure"
        return "temporary_provider_failure"
