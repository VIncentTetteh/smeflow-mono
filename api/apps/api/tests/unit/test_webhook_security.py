from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from apps.api.core import webhook_security


def make_request(
    *,
    client_host: str = "10.0.0.1",
    forwarded_for: str | None = None,
) -> Request:
    headers = []
    if forwarded_for:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/payments/webhooks/momo/mtn",
        "headers": headers,
        "client": (client_host, 443),
    }
    return Request(scope)


def test_empty_webhook_allowlist_allows_any_source_ip() -> None:
    assert webhook_security._matches("203.0.113.10", "")


def test_webhook_allowlist_matches_exact_ip_and_cidr() -> None:
    assert webhook_security._matches("196.201.214.200", "196.201.214.200")
    assert webhook_security._matches("196.201.214.201", "196.201.214.0/24")
    assert not webhook_security._matches("198.51.100.1", "196.201.214.0/24")


def test_webhook_allowlist_rejects_unparseable_client_ip() -> None:
    assert not webhook_security._matches("not-an-ip", "196.201.214.0/24")


def test_client_ip_honors_trusted_proxy_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        webhook_security,
        "get_settings",
        lambda: SimpleNamespace(TRUSTED_PROXY_COUNT=1),
    )

    request = make_request(
        client_host="10.0.0.5",
        forwarded_for="203.0.113.9, 10.0.0.5",
    )

    assert webhook_security.client_ip(request) == "203.0.113.9"


def test_require_webhook_ip_rejects_blocked_provider_source() -> None:
    request = make_request(client_host="198.51.100.10")

    with pytest.raises(HTTPException) as exc:
        webhook_security.require_webhook_ip(request, "paystack", "196.201.214.0/24")

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_mark_webhook_seen_deduplicates_provider_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRedisCache:
        seen: set[str] = set()

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        async def exists(self, key: str) -> bool:
            return key in self.seen

        async def set(self, key: str, value: str, ttl: int) -> None:
            assert value == "1"
            assert ttl == 604_800
            self.seen.add(key)

    monkeypatch.setattr(webhook_security, "RedisCache", FakeRedisCache)
    monkeypatch.setattr(webhook_security, "get_idempotency_redis", lambda: object())

    assert await webhook_security.mark_webhook_seen("mtn", "ref-1") is False
    assert await webhook_security.mark_webhook_seen("mtn", "ref-1") is True
