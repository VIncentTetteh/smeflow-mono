"""
Redis connection pool — shared across OTP, sessions, idempotency, and caching.
Each logical namespace uses a separate DB index.
"""

import json
from typing import Any

import redis.asyncio as aioredis

from apps.api.core.config import get_settings

settings = get_settings()

# ── Connection Pools ──────────────────────────────────────────────────────────
_pools: dict[int, aioredis.Redis] = {}


def _get_pool(db: int = 0) -> aioredis.Redis:
    if db not in _pools:
        base_url = settings.REDIS_URL.rsplit("/", 1)[0]
        _pools[db] = aioredis.from_url(
            f"{base_url}/{db}",
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    return _pools[db]


def get_redis(db: int = 0) -> aioredis.Redis:
    return _get_pool(db)


def get_otp_redis() -> aioredis.Redis:
    return _get_pool(settings.OTP_REDIS_DB)


def get_session_redis() -> aioredis.Redis:
    return _get_pool(settings.SESSION_REDIS_DB)


def get_idempotency_redis() -> aioredis.Redis:
    return _get_pool(settings.IDEMPOTENCY_REDIS_DB)


async def close_all_pools() -> None:
    for pool in _pools.values():
        await pool.aclose()  # type: ignore[attr-defined]
    _pools.clear()


# ── Health check ──────────────────────────────────────────────────────────────
async def check_redis_connection() -> bool:
    try:
        r = get_redis()
        await r.ping()
        return True
    except Exception:
        return False


# ── Helpers ───────────────────────────────────────────────────────────────────
class RedisCache:
    """Thin wrapper for common cache patterns."""

    def __init__(self, redis: aioredis.Redis, prefix: str = ""):
        self._r = redis
        self._prefix = prefix

    def _key(self, key: str) -> str:
        return f"{self._prefix}:{key}" if self._prefix else key

    async def get(self, key: str) -> Any | None:
        val = await self._r.get(self._key(key))
        if val is None:
            return None
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return val

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        serialized = json.dumps(value) if not isinstance(value, str) else value
        if ttl:
            await self._r.setex(self._key(key), ttl, serialized)
        else:
            await self._r.set(self._key(key), serialized)

    async def delete(self, key: str) -> None:
        await self._r.delete(self._key(key))

    async def exists(self, key: str) -> bool:
        return bool(await self._r.exists(self._key(key)))

    async def increment(self, key: str, ttl: int | None = None) -> int:
        count = await self._r.incr(self._key(key))
        if ttl and count == 1:
            await self._r.expire(self._key(key), ttl)
        return count
