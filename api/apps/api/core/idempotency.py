"""
Idempotency layer for all financial mutations.

Usage: pass idempotency_key in request body (required for sales, payments).
Server caches the response in Redis for 24 hours keyed by (business_id, key).

IMPORTANT — no in-memory fallback
───────────────────────────────────
A previous version silently fell back to an in-memory dict when Redis was
unavailable.  That is dangerous because:
  1. The dict does not survive process restarts → duplicate transactions.
  2. Multiple worker processes do not share memory → race conditions under load.
  3. The fallback gave a false sense of safety during a Redis outage.

The correct behaviour on Redis failure is to surface a 503 so operators are
alerted immediately.  Callers must not accept a degraded idempotency guarantee.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import HTTPException

from apps.api.core.redis import RedisCache, get_idempotency_redis

logger = structlog.get_logger()
IDEMPOTENCY_TTL = 86_400  # 24 hours


class IdempotencyStore:
    def __init__(self) -> None:
        self._cache = self._new_cache()

    def _new_cache(self) -> RedisCache:
        return RedisCache(get_idempotency_redis(), prefix="idem")

    def _refresh_cache(self) -> None:
        self._cache = self._new_cache()

    def _key(self, business_id: UUID, idempotency_key: str) -> str:
        return f"{business_id}:{idempotency_key}"

    async def get(self, business_id: UUID, idempotency_key: str) -> Any | None:
        """Return cached result if key already processed, else None.

        Raises HTTP 503 if Redis is unreachable — callers must not proceed
        with a financial mutation without a functioning idempotency store.
        """
        key = self._key(business_id, idempotency_key)
        try:
            return await self._cache.get(key)
        except RuntimeError as exc:
            if "Event loop is closed" not in str(exc):
                raise
            self._refresh_cache()
            return await self._cache.get(key)
        except Exception as exc:
            logger.error("idempotency.redis_error", operation="get", error=str(exc))
            raise HTTPException(
                status_code=503,
                detail="Idempotency service unavailable. Please retry shortly.",
            ) from exc

    async def set(self, business_id: UUID, idempotency_key: str, result: Any) -> None:
        """Cache the result of a successful mutation.

        Raises HTTP 503 if Redis is unreachable.  The caller's transaction
        should be rolled back if this fails to avoid phantom mutations that
        cannot be deduplicated on retry.
        """
        key = self._key(business_id, idempotency_key)
        try:
            await self._cache.set(key, result, ttl=IDEMPOTENCY_TTL)
        except RuntimeError as exc:
            if "Event loop is closed" not in str(exc):
                raise
            self._refresh_cache()
            await self._cache.set(key, result, ttl=IDEMPOTENCY_TTL)
        except Exception as exc:
            logger.error("idempotency.redis_error", operation="set", error=str(exc))
            raise HTTPException(
                status_code=503,
                detail="Idempotency service unavailable. Please retry shortly.",
            ) from exc

    async def check_and_lock(self, business_id: UUID, idempotency_key: str) -> Any | None:
        """Atomic check-and-lock.

        Returns existing result if found (caller should return it immediately).
        Returns None if this is a new request (caller should proceed).
        Raises HTTP 503 on Redis failure.
        """
        return await self.get(business_id, idempotency_key)


idempotency_store = IdempotencyStore()
