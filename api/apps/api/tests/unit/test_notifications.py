"""Unit tests for notification provider dispatch."""

import pytest


class _FakeResponse:
    def __init__(self, json_data: dict | None = None):
        self._json_data = json_data if json_data is not None else {}

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._json_data


class _FakeAsyncClient:
    calls = []
    json_response: dict | None = None

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return _FakeResponse(self.json_response)

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return _FakeResponse(self.json_response)


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
    monkeypatch.setattr(settings, "TECHIESZON_SMS_ENABLED", False)
    monkeypatch.setattr(settings, "HUBTEL_CLIENT_ID", "")

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
    monkeypatch.setattr(settings, "TECHIESZON_SMS_ENABLED", False)
    monkeypatch.setattr(settings, "HUBTEL_CLIENT_ID", "")
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(service.httpx, "AsyncClient", _FakeAsyncClient)

    result = await NotificationDispatcher().send(
        NotificationMessage(phone="+233244000111", text="Low stock")
    )

    assert result == {"status": "sent", "channel": "sms"}
    assert "africastalking.com" in _FakeAsyncClient.calls[0][0]
    assert _FakeAsyncClient.calls[0][1]["data"]["message"] == "Low stock"


@pytest.mark.asyncio
async def test_notification_dispatcher_prefers_techieszon_when_enabled(monkeypatch):
    from apps.api.core.config import get_settings
    from apps.api.modules.notifications import service
    from apps.api.modules.notifications.service import (
        NotificationDispatcher,
        NotificationMessage,
    )

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "")
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "")
    monkeypatch.setattr(settings, "TECHIESZON_SMS_ENABLED", True)
    monkeypatch.setattr(settings, "TECHIESZON_SMS_API_KEY", "techieszon-key")
    monkeypatch.setattr(settings, "TECHIESZON_SMS_SENDER_ID", "Techieszon")
    monkeypatch.setattr(
        settings, "TECHIESZON_SMS_BASE_URL", "https://smsapp.techieszon.com/sms/api"
    )
    # Both other providers also configured — Techieszon must still win.
    monkeypatch.setattr(settings, "HUBTEL_CLIENT_ID", "hubtel-id")
    monkeypatch.setattr(settings, "AT_API_KEY", "at-key")
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.json_response = {"status": "success", "messageId": "tz-123"}
    monkeypatch.setattr(service.httpx, "AsyncClient", _FakeAsyncClient)

    result = await NotificationDispatcher().send(
        NotificationMessage(phone="+233244000111", text="Your OTP is 1234")
    )

    assert result["status"] == "sent"
    assert result["channel"] == "sms"
    url, kwargs = _FakeAsyncClient.calls[0]
    assert url == "https://smsapp.techieszon.com/sms/api"
    params = kwargs["params"]
    assert params["action"] == "send-sms"
    assert params["api_key"] == "techieszon-key"
    assert params["to"] == "+233244000111"
    assert params["from"] == "Techieszon"
    assert params["sms"] == "Your OTP is 1234"
    _FakeAsyncClient.json_response = None


@pytest.mark.asyncio
async def test_notification_dispatcher_falls_back_to_hubtel_when_techieszon_disabled(
    monkeypatch,
):
    from apps.api.core.config import get_settings
    from apps.api.modules.notifications import service
    from apps.api.modules.notifications.service import (
        NotificationDispatcher,
        NotificationMessage,
    )

    settings = get_settings()
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "")
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "")
    monkeypatch.setattr(settings, "TECHIESZON_SMS_ENABLED", False)
    monkeypatch.setattr(settings, "HUBTEL_CLIENT_ID", "hubtel-id")
    monkeypatch.setattr(settings, "HUBTEL_CLIENT_SECRET", "hubtel-secret")
    monkeypatch.setattr(settings, "HUBTEL_SMS_SENDER_ID", "SMEFlow")
    monkeypatch.setattr(settings, "HUBTEL_SMS_BASE_URL", "https://smsc.hubtel.com")
    monkeypatch.setattr(settings, "AT_API_KEY", "at-key")
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.json_response = {"messageId": "hub-1"}
    monkeypatch.setattr(service.httpx, "AsyncClient", _FakeAsyncClient)

    result = await NotificationDispatcher().send(
        NotificationMessage(phone="+233244000111", text="Low stock")
    )

    assert result["status"] == "sent"
    url, _ = _FakeAsyncClient.calls[0]
    assert "hubtel" in url
    _FakeAsyncClient.json_response = None


class TestSmsProviderConfigured:
    def test_true_when_techieszon_enabled_with_key(self, monkeypatch):
        from apps.api.core.config import get_settings
        from apps.api.modules.notifications.service import sms_provider_configured

        settings = get_settings()
        monkeypatch.setattr(settings, "TECHIESZON_SMS_ENABLED", True)
        monkeypatch.setattr(settings, "TECHIESZON_SMS_API_KEY", "key")
        monkeypatch.setattr(settings, "HUBTEL_CLIENT_ID", "")
        monkeypatch.setattr(settings, "AT_API_KEY", "")
        assert sms_provider_configured(settings) is True

    def test_false_when_techieszon_enabled_without_key(self, monkeypatch):
        from apps.api.core.config import get_settings
        from apps.api.modules.notifications.service import sms_provider_configured

        settings = get_settings()
        monkeypatch.setattr(settings, "TECHIESZON_SMS_ENABLED", True)
        monkeypatch.setattr(settings, "TECHIESZON_SMS_API_KEY", "")
        monkeypatch.setattr(settings, "HUBTEL_CLIENT_ID", "")
        monkeypatch.setattr(settings, "AT_API_KEY", "")
        assert sms_provider_configured(settings) is False

    def test_false_when_nothing_configured(self, monkeypatch):
        from apps.api.core.config import get_settings
        from apps.api.modules.notifications.service import sms_provider_configured

        settings = get_settings()
        monkeypatch.setattr(settings, "TECHIESZON_SMS_ENABLED", False)
        monkeypatch.setattr(settings, "HUBTEL_CLIENT_ID", "")
        monkeypatch.setattr(settings, "AT_API_KEY", "")
        assert sms_provider_configured(settings) is False
