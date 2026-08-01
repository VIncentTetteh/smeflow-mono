"""Unit tests for the Techieszon SMS client."""

import pytest


class _FakeResponse:
    def __init__(self, json_data: dict):
        self._json_data = json_data

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._json_data


class _FakeAsyncClient:
    calls = []
    json_response: dict = {}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return _FakeResponse(self.json_response)


@pytest.mark.asyncio
async def test_send_builds_correct_query_params(monkeypatch):
    from apps.api.core.config import get_settings
    from libs import techieszon_sms
    from libs.techieszon_sms import TechieszonSmsClient

    settings = get_settings()
    monkeypatch.setattr(settings, "TECHIESZON_SMS_API_KEY", "test-key")
    monkeypatch.setattr(settings, "TECHIESZON_SMS_SENDER_ID", "Techieszon")
    monkeypatch.setattr(settings, "TECHIESZON_SMS_BASE_URL", "https://smsapp.techieszon.com/sms/api")
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.json_response = {"status": "success"}
    monkeypatch.setattr(techieszon_sms.httpx, "AsyncClient", _FakeAsyncClient)

    client = TechieszonSmsClient()
    result = await client.send("+233244000111", "Hello", unicode=True)

    assert result == {"status": "success"}
    url, kwargs = _FakeAsyncClient.calls[0]
    params = kwargs["params"]
    assert url == "https://smsapp.techieszon.com/sms/api"
    assert params == {
        "action": "send-sms",
        "api_key": "test-key",
        "to": "+233244000111",
        "from": "Techieszon",
        "sms": "Hello",
        "unicode": "1",
    }


@pytest.mark.asyncio
async def test_get_balance_builds_correct_query_params(monkeypatch):
    from apps.api.core.config import get_settings
    from libs import techieszon_sms
    from libs.techieszon_sms import TechieszonSmsClient

    settings = get_settings()
    monkeypatch.setattr(settings, "TECHIESZON_SMS_API_KEY", "test-key")
    monkeypatch.setattr(settings, "TECHIESZON_SMS_BASE_URL", "https://smsapp.techieszon.com/sms/api")
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.json_response = {"balance": "42"}
    monkeypatch.setattr(techieszon_sms.httpx, "AsyncClient", _FakeAsyncClient)

    client = TechieszonSmsClient()
    result = await client.get_balance()

    assert result == {"balance": "42"}
    url, kwargs = _FakeAsyncClient.calls[0]
    assert kwargs["params"] == {
        "action": "check-balance",
        "api_key": "test-key",
        "response": "json",
    }
