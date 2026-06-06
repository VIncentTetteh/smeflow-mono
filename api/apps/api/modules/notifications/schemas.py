"""Notification API schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class NotificationPreferenceUpdate(BaseModel):
    whatsapp_enabled: bool | None = None
    sms_enabled: bool | None = None
    push_enabled: bool | None = None
    event_prefs: dict | None = None


class NotificationPreferenceResponse(BaseModel):
    id: UUID
    whatsapp_enabled: bool
    sms_enabled: bool
    push_enabled: bool
    event_prefs: dict
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class NotificationEventResponse(BaseModel):
    id: UUID
    event_type: str
    channel: str
    phone: str | None
    message: str
    status: str
    provider_response: dict | None
    retryable: bool = False
    error_message: str | None = None
    provider_reference: str | None = None
    fallback_from: str | None = None
    created_at: datetime
    sent_at: datetime | None

    model_config = {"from_attributes": True}


class BulkMessageRequest(BaseModel):
    message: str
    recipient_type: str  # "customers", "staff", "all"
    channel: str = "whatsapp"  # "whatsapp", "sms"


class BulkMessageResponse(BaseModel):
    message_id: UUID
    recipient_count: int
    status: str
    estimated_cost: float | None

    model_config = {"from_attributes": True}


class MerchantAlertResponse(BaseModel):
    id: UUID
    alert_type: str
    severity: str
    title: str
    message: str
    status: str
    resource_type: str | None
    resource_id: str | None
    action_path: str | None
    action_label: str | None
    occurrence_count: int
    read_at: datetime | None
    resolved_at: datetime | None
    dismissed_at: datetime | None
    dismissal_reason: str | None
    latest_at: datetime
    created_at: datetime
    provider_error: None = None

    model_config = {"from_attributes": True}


class MerchantAlertListResponse(BaseModel):
    items: list[MerchantAlertResponse]
    unread_count: int


class MerchantAlertDismissRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class DeliveryAttemptResponse(BaseModel):
    id: UUID
    channel: str
    provider: str
    attempt_number: int
    status: str
    provider_reference: str | None
    failure_category: str | None
    failure_detail: str | None
    fallback_from: str | None
    requested_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class CustomerMessageResponse(BaseModel):
    id: UUID
    message_type: str
    recipient_masked: str
    preferred_channel: str
    consent_status: str
    related_resource_type: str | None
    related_resource_id: str | None
    status: str
    completed_at: datetime | None
    created_at: datetime
    attempts: list[DeliveryAttemptResponse]

    model_config = {"from_attributes": True}


class CustomerMessageListResponse(BaseModel):
    items: list[CustomerMessageResponse]
