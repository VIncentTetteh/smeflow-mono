"""Professional merchant-alert and customer-message notification flows."""

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_merchant_alerts_deduplicate_and_track_lifecycle(
    async_client: AsyncClient, auth_headers: dict, seeded_business, db_session
) -> None:
    from apps.api.modules.notifications.alert_service import MerchantAlertService

    service = MerchantAlertService(db_session)
    first = await service.upsert_alert(
        business_id=seeded_business["business"].id,
        alert_type="payment_failure",
        severity="critical",
        dedupe_key="payment_failure:pay-1",
        title="Payment failed",
        message="Collect another way or retry the payment.",
        resource_type="sale",
        resource_id="sale-1",
        action_path="/owner/sales?sale_id=sale-1",
        action_label="Open sale",
    )
    second = await service.upsert_alert(
        business_id=seeded_business["business"].id,
        alert_type="payment_failure",
        severity="critical",
        dedupe_key="payment_failure:pay-1",
        title="Payment failed again",
        message="The retry failed. Collect another way.",
        resource_type="sale",
        resource_id="sale-1",
        action_path="/owner/sales?sale_id=sale-1",
        action_label="Open sale",
    )
    await db_session.commit()

    assert second.id == first.id
    assert second.occurrence_count == 2
    assert second.title == "Payment failed again"

    listed = await async_client.get("/api/v1/notifications/alerts", headers=auth_headers)
    assert listed.status_code == 200
    assert listed.json()["unread_count"] == 1
    assert listed.json()["items"][0]["provider_error"] is None
    assert listed.json()["items"][0]["action_path"].endswith("sale_id=sale-1")

    read = await async_client.post(
        f"/api/v1/notifications/alerts/{first.id}/read", headers=auth_headers
    )
    assert read.status_code == 200
    assert read.json()["read_at"] is not None

    dismissed = await async_client.post(
        f"/api/v1/notifications/alerts/{first.id}/dismiss",
        json={"reason": "Handled outside SMEFlow"},
        headers=auth_headers,
    )
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == "dismissed"

    history = await async_client.get(
        "/api/v1/notifications/alerts?view=history", headers=auth_headers
    )
    assert history.status_code == 200
    assert history.json()["items"][0]["dismissal_reason"] == "Handled outside SMEFlow"


@pytest.mark.asyncio
async def test_customer_message_is_idempotent_and_delivery_history_is_sanitized(
    async_client: AsyncClient, auth_headers: dict, seeded_business, db_session
) -> None:
    from apps.api.modules.notifications.delivery_service import CustomerDeliveryService

    service = CustomerDeliveryService(db_session)
    first = await service.create_message(
        business_id=seeded_business["business"].id,
        message_type="invoice",
        recipient_phone="+233244555666",
        body="Invoice SME-1 is ready.",
        preferred_channel="whatsapp",
        idempotency_key="invoice:SME-1:send-1",
        consent_status="not_required",
        related_resource_type="invoice",
        related_resource_id="invoice-1",
    )
    second = await service.create_message(
        business_id=seeded_business["business"].id,
        message_type="invoice",
        recipient_phone="+233244555666",
        body="This duplicate body must not create a second message.",
        preferred_channel="whatsapp",
        idempotency_key="invoice:SME-1:send-1",
        consent_status="not_required",
        related_resource_type="invoice",
        related_resource_id="invoice-1",
    )
    attempt = await service.record_attempt(
        first,
        channel="whatsapp",
        provider="meta",
        status="failed",
        failure_category="provider_authentication_failure",
        failure_detail="401 from https://provider.example/private?token=secret",
    )
    await db_session.commit()

    assert second.id == first.id
    assert attempt.failure_detail == "Provider authentication failed."

    response = await async_client.get("/api/v1/notifications/deliveries", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()["items"][0]
    assert payload["recipient_masked"].endswith("5666")
    assert payload["attempts"][0]["failure_category"] == "provider_authentication_failure"
    assert payload["attempts"][0]["failure_detail"] == "Provider authentication failed."
    assert "provider.example" not in str(payload)


@pytest.mark.asyncio
async def test_credit_reminder_requires_customer_consent(
    seeded_business, db_session
) -> None:
    from apps.api.modules.notifications.delivery_service import CustomerDeliveryService

    service = CustomerDeliveryService(db_session)
    message = await service.create_message(
        business_id=seeded_business["business"].id,
        message_type="credit_reminder",
        recipient_phone="+233244555666",
        body="Your credit repayment is due.",
        preferred_channel="whatsapp",
        idempotency_key="credit:1:due",
        consent_status="missing",
        related_resource_type="receivable",
        related_resource_id="receivable-1",
    )

    assert message.status == "skipped"
    assert message.completed_at is not None
    assert message.completed_at <= datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_customer_delivery_retries_whatsapp_then_falls_back_to_sms(
    seeded_business, db_session, monkeypatch
) -> None:
    from sqlalchemy import select

    from apps.api.modules.notifications.delivery_service import CustomerDeliveryService
    from apps.api.modules.notifications.models import MerchantAlert
    from apps.api.modules.notifications.service import NotificationDispatcher

    calls: list[str] = []

    async def fake_send(self, message, channel):
        calls.append(channel)
        if channel == "whatsapp":
            return {"status": "failed", "channel": channel, "error": "timeout"}
        return {"status": "sent", "channel": channel, "provider_reference": "sms-1"}

    monkeypatch.setattr(NotificationDispatcher, "send", fake_send)
    service = CustomerDeliveryService(db_session)
    message = await service.create_message(
        business_id=seeded_business["business"].id,
        message_type="credit_reminder",
        recipient_phone="+233244555666",
        body="Your credit repayment is due.",
        preferred_channel="whatsapp",
        idempotency_key="credit:2:due",
        consent_status="granted",
        related_resource_type="receivable",
        related_resource_id="receivable-2",
    )

    delivered = await service.deliver_message(message, whatsapp_max_attempts=3)
    await db_session.commit()

    assert calls == ["whatsapp", "whatsapp", "whatsapp", "sms"]
    assert delivered.status == "queued"
    assert [attempt.channel for attempt in delivered.attempts] == [
        "whatsapp",
        "whatsapp",
        "whatsapp",
        "sms",
    ]
    assert delivered.attempts[-1].fallback_from == "whatsapp"
    assert await db_session.scalar(select(MerchantAlert)) is None


@pytest.mark.asyncio
async def test_final_customer_delivery_failure_creates_one_merchant_alert(
    seeded_business, db_session, monkeypatch
) -> None:
    from sqlalchemy import select

    from apps.api.modules.notifications.delivery_service import CustomerDeliveryService
    from apps.api.modules.notifications.models import MerchantAlert
    from apps.api.modules.notifications.service import NotificationDispatcher

    async def fake_send(self, message, channel):
        return {"status": "failed", "channel": channel, "error": "provider unavailable"}

    monkeypatch.setattr(NotificationDispatcher, "send", fake_send)
    service = CustomerDeliveryService(db_session)
    message = await service.create_message(
        business_id=seeded_business["business"].id,
        message_type="invoice",
        recipient_phone="+233244555666",
        body="Invoice SME-2 is ready.",
        preferred_channel="whatsapp",
        idempotency_key="invoice:SME-2:send-1",
        consent_status="not_required",
        related_resource_type="invoice",
        related_resource_id="invoice-2",
    )

    await service.deliver_message(message, whatsapp_max_attempts=1)
    await service.deliver_message(message, whatsapp_max_attempts=1)
    await db_session.commit()

    alerts = (await db_session.execute(select(MerchantAlert))).scalars().all()
    assert len(alerts) == 1
    assert alerts[0].occurrence_count == 2
    assert alerts[0].action_label == "Open delivery"
    assert "provider unavailable" not in alerts[0].message
