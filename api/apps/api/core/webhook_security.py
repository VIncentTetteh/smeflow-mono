"""Webhook source-IP and replay-deduplication helpers."""

from __future__ import annotations

import ipaddress

import structlog
from fastapi import HTTPException, Request

from apps.api.core.config import get_settings
from apps.api.core.redis import RedisCache, get_idempotency_redis

logger = structlog.get_logger()
_TEST_WEBHOOK_SEEN: set[str] = set()


def client_ip(request: Request) -> str:
    settings = get_settings()
    direct = request.client.host if request.client else ""
    if settings.TRUSTED_PROXY_COUNT <= 0:
        return direct

    forwarded = request.headers.get("X-Forwarded-For", "")
    if not forwarded:
        return direct
    chain = [part.strip() for part in forwarded.split(",") if part.strip()]
    if len(chain) < settings.TRUSTED_PROXY_COUNT + 1:
        return direct
    return chain[-(settings.TRUSTED_PROXY_COUNT + 1)]


def _matches(ip: str, allowlist: str) -> bool:
    entries = [item.strip() for item in allowlist.split(",") if item.strip()]
    if not entries:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in entries:
        try:
            if addr in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            if ip == entry:
                return True
    return False


def require_webhook_ip(request: Request, provider: str, allowlist: str) -> None:
    ip = client_ip(request)
    if not _matches(ip, allowlist):
        logger.warning("webhook.ip_blocked", provider=provider, client_ip=ip)
        raise HTTPException(status_code=403, detail="Webhook source IP is not allowed")


async def mark_webhook_seen(provider: str, reference: str, ttl: int = 604_800) -> bool:
    """Return True when this provider/reference was already processed."""
    if not reference:
        return False
    settings = get_settings()
    if settings.APP_ENV == "test":
        key = f"{provider}:{reference}"
        if key in _TEST_WEBHOOK_SEEN:
            return True
        _TEST_WEBHOOK_SEEN.add(key)
        return False
    cache = RedisCache(get_idempotency_redis(), prefix="webhook_seen")
    key = f"{provider}:{reference}"
    if await cache.exists(key):
        return True
    await cache.set(key, "1", ttl=ttl)
    return False
