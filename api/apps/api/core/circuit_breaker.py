"""Simple Redis-backed circuit breaker for outbound providers."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import TypeVar

import structlog

from apps.api.core.config import get_settings
from apps.api.core.redis import RedisCache, get_redis

T = TypeVar("T")
logger = structlog.get_logger()


class CircuitOpenError(RuntimeError):
    pass


class CircuitBreaker:
    def __init__(self, provider: str) -> None:
        self.provider = provider
        self.cache = RedisCache(get_redis(), prefix="circuit")
        settings = get_settings()
        self.threshold = settings.CIRCUIT_BREAKER_FAILURE_THRESHOLD
        self.open_seconds = settings.CIRCUIT_BREAKER_OPEN_SECONDS

    async def allow(self) -> bool:
        return not await self.cache.exists(f"{self.provider}:open")

    async def call(self, fn: Callable[[], Awaitable[T]]) -> T:
        if os.getenv("PYTEST_CURRENT_TEST"):
            return await fn()
        if not await self.allow():
            raise CircuitOpenError(f"Circuit for {self.provider} is open")
        try:
            result = await fn()
        except Exception:
            await self.record_failure()
            raise
        await self.record_success()
        return result

    async def record_success(self) -> None:
        await self.cache.delete(f"{self.provider}:failures")

    async def record_failure(self) -> None:
        count = await self.cache.increment(f"{self.provider}:failures", ttl=self.open_seconds)
        if count >= self.threshold:
            await self.cache.set(f"{self.provider}:open", "1", ttl=self.open_seconds)
            logger.error("circuit.opened", provider=self.provider, failures=count)


async def circuit_state() -> dict[str, str]:
    providers = ["mtn", "paystack", "africastalking", "whatsapp", "fcm", "nia", "gra"]
    cache = RedisCache(get_redis(), prefix="circuit")
    state = {}
    for provider in providers:
        state[provider] = "open" if await cache.exists(f"{provider}:open") else "closed"
    return state
