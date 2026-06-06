"""Notification preference and event ORM models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("business_id", name="uq_notification_pref_business"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    whatsapp_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sms_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    push_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    event_prefs: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class NotificationEvent(Base):
    __tablename__ = "notification_events"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    provider_response: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def retryable(self) -> bool:
        return self.status == "failed"

    @property
    def error_message(self) -> str | None:
        response = self.provider_response or {}
        if isinstance(response.get("error"), str):
            return response["error"]
        delivery = response.get("delivery")
        if isinstance(delivery, dict) and isinstance(delivery.get("failure_reason"), str):
            return delivery["failure_reason"]
        return None

    @property
    def provider_reference(self) -> str | None:
        response = self.provider_response or {}
        for key in ("provider_reference", "reference", "message_id", "payment_id"):
            value = response.get(key)
            if isinstance(value, str):
                return value
        sms_data = response.get("SMSMessageData")
        if isinstance(sms_data, dict):
            recipients = sms_data.get("Recipients")
            if isinstance(recipients, list) and recipients:
                first = recipients[0]
                message_id = first.get("messageId") if isinstance(first, dict) else None
                if isinstance(message_id, str):
                    return message_id
        return None

    @property
    def fallback_from(self) -> str | None:
        response = self.provider_response or {}
        value = response.get("fallback_from")
        return value if value in {"whatsapp", "sms"} else None


class DeviceToken(Base):
    __tablename__ = "device_tokens"
    __table_args__ = (UniqueConstraint("token", name="uq_device_tokens_token"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False, index=True)
    token: Mapped[str] = mapped_column(Text, nullable=False)
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MerchantAlert(Base):
    """One evolving, actionable problem shown in the merchant inbox."""

    __tablename__ = "merchant_alerts"
    __table_args__ = (
        UniqueConstraint("business_id", "dedupe_key", name="uq_merchant_alert_dedupe"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    recipient_user_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    recipient_role: Mapped[str | None] = mapped_column(String(20))
    alert_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="operational")
    dedupe_key: Mapped[str] = mapped_column(String(180), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(40))
    resource_id: Mapped[str | None] = mapped_column(String(100))
    action_path: Mapped[str | None] = mapped_column(String(500))
    action_label: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="needs_attention")
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissal_reason: Mapped[str | None] = mapped_column(String(500))
    latest_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def provider_error(self) -> None:
        """Merchant-safe responses never expose provider errors."""
        return None


class CustomerMessage(Base):
    """A consent-aware customer communication, separate from merchant alerts."""

    __tablename__ = "customer_messages"
    __table_args__ = (
        UniqueConstraint("business_id", "idempotency_key", name="uq_customer_message_idempotency"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    customer_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("customers.id"))
    message_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    recipient_phone: Mapped[str | None] = mapped_column(String(20))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    preferred_channel: Mapped[str] = mapped_column(String(20), nullable=False, default="whatsapp")
    consent_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_required")
    consent_source: Mapped[str | None] = mapped_column(String(80))
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    idempotency_key: Mapped[str] = mapped_column(String(180), nullable=False)
    related_resource_type: Mapped[str | None] = mapped_column(String(40))
    related_resource_id: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="requested", index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retention_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    attempts: Mapped[list["DeliveryAttempt"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", order_by="DeliveryAttempt.attempt_number"
    )

    @property
    def recipient_masked(self) -> str:
        if not self.recipient_phone:
            return "No contact"
        return f"••••{self.recipient_phone[-4:]}"


class DeliveryAttempt(Base):
    """One provider/channel attempt for a customer message."""

    __tablename__ = "delivery_attempts"
    __table_args__ = (
        UniqueConstraint("customer_message_id", "attempt_number", name="uq_delivery_attempt_number"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    customer_message_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customer_messages.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="queued")
    provider_reference: Mapped[str | None] = mapped_column(String(180), index=True)
    failure_category: Mapped[str | None] = mapped_column(String(60))
    failure_detail: Mapped[str | None] = mapped_column(String(255))
    fallback_from: Mapped[str | None] = mapped_column(String(20))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    message: Mapped["CustomerMessage"] = relationship(back_populates="attempts")
