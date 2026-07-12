"""Integration tests for Phase 2 notification preferences and events."""

import asyncio

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_notification_preferences_and_event_log(
    async_client: AsyncClient, auth_headers: dict, seeded_business, db_session
) -> None:
    from apps.api.modules.notifications.service import NotificationService

    prefs = await async_client.get("/api/v1/notifications/preferences", headers=auth_headers)
    assert prefs.status_code == 200
    assert prefs.json()["whatsapp_enabled"] is True

    updated = await async_client.put(
        "/api/v1/notifications/preferences",
        json={
            "sms_enabled": False,
            "event_prefs": {"stock.low": {"whatsapp": True, "sms": False}},
        },
        headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["sms_enabled"] is False

    service = NotificationService(db_session)
    events = await service.dispatch_event(
        seeded_business["business"].id,
        "stock.low",
        {"item_name": "Rice", "current_stock": "2", "item_id": "item-1"},
    )
    assert len(events) == 1
    assert events[0].status == "skipped"
    assert events[0].channel == "whatsapp"

    listed = await async_client.get("/api/v1/notifications/events", headers=auth_headers)
    assert listed.status_code == 200
    assert listed.json()[0]["event_type"] == "stock.low"


@pytest.mark.asyncio
async def test_send_daily_sales_summary_queues_notification(
    seeded_business, seeded_item, db_session, monkeypatch, async_client, auth_headers
) -> None:
    from apps.api.modules.notifications.service import NotificationService
    from apps.api.workers.tasks.notification_tasks import send_daily_sales_summaries

    # Record a sale first
    await async_client.post(
        "/api/v1/sales/record",
        json={
            "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
            "payment_method": "cash",
            "idempotency_key": "test-sale-key",
        },
        headers=auth_headers,
    )

    dispatched: list[tuple] = []

    async def fake_dispatch(self, business_id, event_type, data):
        dispatched.append((business_id, event_type, data))
        return []

    monkeypatch.setattr(NotificationService, "dispatch_event", fake_dispatch)
    monkeypatch.setattr(
        "apps.api.core.database.AsyncSessionLocal",
        lambda: db_session,
    )

    await asyncio.to_thread(send_daily_sales_summaries.run)

    assert len(dispatched) == 1
    business_id, event_type, data = dispatched[0]
    assert business_id == seeded_business["business"].id
    assert event_type == "sales.daily.summary"
    assert "total_sales" in data
    assert data["total_sales"] == 1
    assert "total_revenue" in data
    assert "24.00" in data["total_revenue"]
    assert "top_items" in data


@pytest.mark.asyncio
async def test_notification_events_expose_autopilot_delivery_fields(
    async_client: AsyncClient, auth_headers: dict, seeded_business, db_session
) -> None:
    from apps.api.modules.notifications.models import NotificationEvent

    event = NotificationEvent(
        business_id=seeded_business["business"].id,
        event_type="stock.low.digest",
        channel="whatsapp",
        phone="+233244999001",
        message="Low stock digest",
        status="failed",
        provider_response={
            "status": "failed",
            "channel": "whatsapp",
            "error": "provider down",
            "provider_reference": "wa-ref-1",
        },
    )
    db_session.add(event)
    await db_session.flush([event])

    listed = await async_client.get("/api/v1/notifications/events", headers=auth_headers)

    assert listed.status_code == 200
    payload = listed.json()[0]
    assert payload["retryable"] is True
    assert payload["error_message"] == "provider down"
    assert payload["provider_reference"] == "wa-ref-1"
    assert payload["fallback_from"] is None


@pytest.mark.asyncio
async def test_retry_failed_notification_event_updates_same_event(
    async_client: AsyncClient, auth_headers: dict, seeded_business, db_session, monkeypatch
) -> None:
    from apps.api.modules.notifications.models import NotificationEvent
    from apps.api.modules.notifications.service import NotificationDispatcher

    calls: list[tuple[str, str]] = []

    async def fake_send(self, message, channel):
        calls.append((message.text, channel))
        return {"status": "sent", "channel": channel, "provider_reference": "retry-ref-1"}

    monkeypatch.setattr(NotificationDispatcher, "send", fake_send)

    event = NotificationEvent(
        business_id=seeded_business["business"].id,
        event_type="stock.low.digest",
        channel="whatsapp",
        phone="+233244999001",
        message="Low stock digest",
        status="failed",
        provider_response={"status": "failed", "channel": "whatsapp", "error": "provider down"},
    )
    db_session.add(event)
    await db_session.flush([event])

    response = await async_client.post(
        f"/api/v1/notifications/events/{event.id}/retry",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert calls == [("Low stock digest", "whatsapp")]
    assert response.json()["id"] == str(event.id)
    assert response.json()["status"] == "sent"
    assert response.json()["provider_reference"] == "retry-ref-1"


@pytest.mark.asyncio
async def test_retry_notification_event_rejects_non_retryable_sent_event(
    async_client: AsyncClient, auth_headers: dict, seeded_business, db_session, monkeypatch
) -> None:
    from apps.api.modules.notifications.models import NotificationEvent
    from apps.api.modules.notifications.service import NotificationDispatcher

    async def fake_send(self, message, channel):
        raise AssertionError("sent events must not be retried")

    monkeypatch.setattr(NotificationDispatcher, "send", fake_send)

    event = NotificationEvent(
        business_id=seeded_business["business"].id,
        event_type="sales.daily.summary",
        channel="whatsapp",
        phone="+233244999001",
        message="Daily summary",
        status="sent",
        provider_response={"status": "sent", "channel": "whatsapp"},
    )
    db_session.add(event)
    await db_session.flush([event])

    response = await async_client.post(
        f"/api/v1/notifications/events/{event.id}/retry",
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert "not retryable" in response.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_retry_notification_event_rejects_other_business_event(
    async_client: AsyncClient, auth_headers: dict, db_session
) -> None:
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business
    from apps.api.modules.notifications.models import NotificationEvent

    other_owner = User(phone="+233244999002", name="Other Owner")
    db_session.add(other_owner)
    await db_session.flush([other_owner])
    other = Business(owner_id=other_owner.id, name="Other Shop", type="shop")
    db_session.add(other)
    await db_session.flush([other])
    event = NotificationEvent(
        business_id=other.id,
        event_type="stock.low.digest",
        channel="whatsapp",
        phone="+233244999002",
        message="Low stock digest",
        status="failed",
        provider_response={"status": "failed", "channel": "whatsapp"},
    )
    db_session.add(event)
    await db_session.flush([event])

    response = await async_client.post(
        f"/api/v1/notifications/events/{event.id}/retry",
        headers=auth_headers,
    )

    assert response.status_code == 404
