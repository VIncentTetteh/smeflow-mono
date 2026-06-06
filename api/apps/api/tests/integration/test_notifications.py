"""Integration tests for notification delivery preferences and fallbacks."""

import pytest


@pytest.mark.asyncio
async def test_sales_daily_summary_dispatches_whatsapp_by_default(
    db_session, seeded_business, monkeypatch
):
    from apps.api.modules.notifications.service import NotificationDispatcher, NotificationService

    sent: list[str] = []

    async def fake_send(self, message, channel):
        sent.append(channel)
        return {"status": "sent", "channel": channel}

    monkeypatch.setattr(NotificationDispatcher, "send", fake_send)

    events = await NotificationService(db_session).dispatch_event(
        seeded_business["business"].id,
        "sales.daily.summary",
        {
            "cash_revenue": "10.00",
            "credit_revenue": "0.00",
            "date": "2026-05-09",
            "momo_revenue": "0.00",
            "top_items": "Tomatoes",
            "total_revenue": "10.00",
            "total_sales": 1,
        },
    )

    assert sent == ["whatsapp"]
    assert len(events) == 1
    assert events[0].event_type == "sales.daily.summary"
    assert events[0].channel == "whatsapp"
    assert events[0].status == "sent"


@pytest.mark.asyncio
async def test_sales_daily_summary_respects_whatsapp_disabled(
    db_session, seeded_business, monkeypatch
):
    from apps.api.modules.notifications.service import NotificationDispatcher, NotificationService

    sent: list[str] = []

    async def fake_send(self, message, channel):
        sent.append(channel)
        return {"status": "sent", "channel": channel}

    monkeypatch.setattr(NotificationDispatcher, "send", fake_send)
    service = NotificationService(db_session)
    await service.update_preferences(seeded_business["business"].id, whatsapp_enabled=False)

    events = await service.dispatch_event(
        seeded_business["business"].id,
        "sales.daily.summary",
        {
            "cash_revenue": "10.00",
            "credit_revenue": "0.00",
            "date": "2026-05-09",
            "momo_revenue": "0.00",
            "top_items": "Tomatoes",
            "total_revenue": "10.00",
            "total_sales": 1,
        },
    )

    assert sent == []
    assert events == []


@pytest.mark.asyncio
async def test_sales_daily_summary_can_fallback_to_sms_when_whatsapp_fails(
    db_session, seeded_business, monkeypatch
):
    from apps.api.modules.notifications.service import NotificationDispatcher, NotificationService

    sent: list[str] = []

    async def fake_send(self, message, channel):
        sent.append(channel)
        if channel == "whatsapp":
            return {"status": "failed", "channel": channel, "error": "provider down"}
        return {"status": "sent", "channel": channel}

    monkeypatch.setattr(NotificationDispatcher, "send", fake_send)
    service = NotificationService(db_session)
    await service.update_preferences(
        seeded_business["business"].id,
        event_prefs={"sales.daily.summary": {"sms": True}},
    )

    events = await service.dispatch_event(
        seeded_business["business"].id,
        "sales.daily.summary",
        {
            "cash_revenue": "10.00",
            "credit_revenue": "0.00",
            "date": "2026-05-09",
            "momo_revenue": "0.00",
            "top_items": "Tomatoes",
            "total_revenue": "10.00",
            "total_sales": 1,
        },
    )

    assert sent == ["whatsapp", "sms"]
    assert [event.channel for event in events] == ["whatsapp", "sms"]
    assert events[0].status == "failed"
    assert events[1].status == "sent"
