from uuid import uuid4

import pytest
from fastapi import HTTPException

from apps.api.core.idempotency import IDEMPOTENCY_TTL, IdempotencyStore


class FakeCache:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error
        self.values: dict[str, object] = {}
        self.set_calls: list[tuple[str, object, int | None]] = []

    async def get(self, key: str) -> object | None:
        if self.error:
            raise self.error
        return self.values.get(key)

    async def set(self, key: str, value: object, ttl: int | None = None) -> None:
        if self.error:
            raise self.error
        self.values[key] = value
        self.set_calls.append((key, value, ttl))


def test_idempotency_key_is_scoped_to_business() -> None:
    store = IdempotencyStore()
    business_id = uuid4()

    assert store._key(business_id, "sale-1") == f"{business_id}:sale-1"


@pytest.mark.asyncio
async def test_get_returns_cached_financial_mutation() -> None:
    store = IdempotencyStore()
    business_id = uuid4()
    key = store._key(business_id, "pay-1")
    cache = FakeCache()
    cache.values[key] = {"status": "pending"}
    store._cache = cache  # type: ignore[assignment]

    assert await store.get(business_id, "pay-1") == {"status": "pending"}


@pytest.mark.asyncio
async def test_set_uses_financial_idempotency_ttl() -> None:
    store = IdempotencyStore()
    business_id = uuid4()
    cache = FakeCache()
    store._cache = cache  # type: ignore[assignment]

    await store.set(business_id, "sale-2", {"sale_id": "sale-2"})

    assert cache.set_calls == [
        (store._key(business_id, "sale-2"), {"sale_id": "sale-2"}, IDEMPOTENCY_TTL)
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["get", "set"])
async def test_redis_failure_stops_financial_mutation(operation: str) -> None:
    store = IdempotencyStore()
    store._cache = FakeCache(error=ConnectionError("redis down"))  # type: ignore[assignment]

    with pytest.raises(HTTPException) as exc:
        if operation == "get":
            await store.get(uuid4(), "sale-3")
        else:
            await store.set(uuid4(), "sale-3", {"ok": True})

    assert exc.value.status_code == 503
    assert "Idempotency service unavailable" in str(exc.value.detail)
