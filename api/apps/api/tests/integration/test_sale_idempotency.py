"""
Integration test: Sale idempotency — submitting the same sale twice must not
create duplicate records or deduct stock twice.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestSaleIdempotency:
    async def test_duplicate_sale_returns_same_result(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        idempotency_key = str(uuid4())
        payload = {
            "items": [{"item_id": str(seeded_item.id), "qty": "5", "unit_price": "12.00"}],
            "payment_method": "cash",
            "idempotency_key": idempotency_key,
        }

        # First request
        r1 = await async_client.post("/api/v1/sales/record", json=payload, headers=auth_headers)
        assert r1.status_code == 201
        sale_id_1 = r1.json()["sale_id"]

        # Second request (same idempotency key) — should return same sale_id
        r2 = await async_client.post("/api/v1/sales/record", json=payload, headers=auth_headers)
        assert r2.status_code in (200, 201)
        sale_id_2 = r2.json()["sale_id"]

        assert sale_id_1 == sale_id_2

    async def test_sale_requires_idempotency_key(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        payload = {
            "items": [{"item_id": str(seeded_item.id), "qty": "1", "unit_price": "12.00"}],
            "payment_method": "cash",
            # no idempotency_key
        }
        resp = await async_client.post("/api/v1/sales/record", json=payload, headers=auth_headers)
        assert resp.status_code == 422

    async def test_credit_sale_creates_receivable(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        payload = {
            "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
            "payment_method": "credit",
            "customer_name": "Kwame Mensah",
            "customer_phone": "+233244777888",
            "idempotency_key": str(uuid4()),
        }
        resp = await async_client.post("/api/v1/sales/record", json=payload, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["balance_due"] == "24.00"
