"""Unit tests for notification provider dispatch."""

import pytest


class _FakeResponse:
    def raise_for_status(self) -> None:
        return None


class _FakeAsyncClient:
    calls = []

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return _FakeResponse()


@pytest.mark.asyncio
async def test_notification_dispatcher_skips_without_provider(monkeypatch):
    from apps.api.core.config import get_settings
    from apps.api.modules.notifications.service import (
        NotificationDispatcher,
        NotificationMessage,
    )

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "")
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "")
    monkeypatch.setattr(settings, "AT_API_KEY", "")

    result = await NotificationDispatcher().send(
        NotificationMessage(phone="+233244000111", text="Hello")
    )

    assert result == {"status": "skipped", "channel": "none"}


@pytest.mark.asyncio
async def test_notification_dispatcher_sends_whatsapp_text_without_media(monkeypatch):
    from apps.api.core.config import get_settings
    from apps.api.modules.notifications import service
    from apps.api.modules.notifications.service import (
        NotificationDispatcher,
        NotificationMessage,
    )

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "token")
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "phone-id")
    monkeypatch.setattr(settings, "AT_API_KEY", "")
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(service.httpx, "AsyncClient", _FakeAsyncClient)

    result = await NotificationDispatcher().send(
        NotificationMessage(
            phone="+233244000111", text="Invoice ready", media_url="local://invoice.pdf"
        )
    )

    assert result == {"status": "sent", "channel": "whatsapp"}
    assert _FakeAsyncClient.calls[0][0].endswith("/phone-id/messages")
    payload = _FakeAsyncClient.calls[0][1]["json"]
    assert payload["type"] == "text"
    assert payload["text"]["body"] == "Invoice ready"


@pytest.mark.asyncio
async def test_notification_dispatcher_sends_whatsapp_pdf_as_document(monkeypatch):
    from apps.api.core.config import get_settings
    from apps.api.modules.notifications import service
    from apps.api.modules.notifications.service import (
        NotificationDispatcher,
        NotificationMessage,
    )

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "token")
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "phone-id")
    monkeypatch.setattr(settings, "AT_API_KEY", "")
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(service.httpx, "AsyncClient", _FakeAsyncClient)

    result = await NotificationDispatcher().send(
        NotificationMessage(
            phone="+233244000111",
            text="Invoice ready",
            media_url="https://example.com/invoices/test.pdf",
        )
    )

    assert result == {"status": "sent", "channel": "whatsapp"}
    payload = _FakeAsyncClient.calls[0][1]["json"]
    assert payload["type"] == "document"
    assert payload["document"]["link"] == "https://example.com/invoices/test.pdf"
    assert payload["document"]["filename"] == "invoice.pdf"
    assert payload["document"]["caption"] == "Invoice ready"


@pytest.mark.asyncio
async def test_notification_dispatcher_sends_sms(monkeypatch):
    from apps.api.core.config import get_settings
    from apps.api.modules.notifications import service
    from apps.api.modules.notifications.service import (
        NotificationDispatcher,
        NotificationMessage,
    )

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "")
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "")
    monkeypatch.setattr(settings, "AT_API_KEY", "at-key")
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(service.httpx, "AsyncClient", _FakeAsyncClient)

    result = await NotificationDispatcher().send(
        NotificationMessage(phone="+233244000111", text="Low stock")
    )

    assert result == {"status": "sent", "channel": "sms"}
    assert "africastalking.com" in _FakeAsyncClient.calls[0][0]
    assert _FakeAsyncClient.calls[0][1]["data"]["message"] == "Low stock"
