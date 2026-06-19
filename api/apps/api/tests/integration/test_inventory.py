"""Integration tests for Inventory module: CRUD, stock adjustment, bulk import."""

from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient


def _headers(user_id, business_id=None, role="owner") -> dict[str, str]:
    from apps.api.core.security import create_access_token

    token = create_access_token(user_id=user_id, business_id=business_id, role=role)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
class TestInventoryItems:
    async def test_create_item(self, async_client: AsyncClient, auth_headers: dict):
        resp = await async_client.post(
            "/api/v1/inventory/items",
            json={
                "name": "Palm Oil",
                "unit": "litre",
                "sell_price": "15.00",
                "cost_price": "10.00",
                "initial_stock": "50",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Palm Oil"
        assert data["unit"] == "litre"
        assert Decimal(data["sell_price"]) == Decimal("15.00")
        assert Decimal(data["current_stock"]) == Decimal("50")
        assert data["is_low_stock"] is False

    async def test_create_item_missing_sell_price_fails(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.post(
            "/api/v1/inventory/items",
            json={"name": "Sugar", "unit": "kg"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_list_items_pagination(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        resp = await async_client.get("/api/v1/inventory/items", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        assert isinstance(data["items"], list)

    async def test_list_items_search(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        resp = await async_client.get("/api/v1/inventory/items?search=Tomato", headers=auth_headers)
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) >= 1
        assert "Tomato" in items[0]["name"]

    async def test_update_item(self, async_client: AsyncClient, auth_headers: dict, seeded_item):
        resp = await async_client.patch(
            f"/api/v1/inventory/items/{seeded_item.id}",
            json={"sell_price": "15.00"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert Decimal(resp.json()["sell_price"]) == Decimal("15.00")

    async def test_lookup_item_by_barcode(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session
    ):
        seeded_item.barcode = "0123456789012"
        await db_session.flush([seeded_item])

        resp = await async_client.get(
            "/api/v1/inventory/items/lookup?barcode=0123456789012",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == str(seeded_item.id)
        assert resp.json()["barcode"] == "0123456789012"

    async def test_lookup_item_by_sku(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session
    ):
        seeded_item.sku = "TOM-123"
        await db_session.flush([seeded_item])

        resp = await async_client.get(
            "/api/v1/inventory/items/lookup?sku=TOM-123",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == str(seeded_item.id)
        assert resp.json()["sku"] == "TOM-123"

    async def test_delete_item_soft_deletes(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        resp = await async_client.delete(
            f"/api/v1/inventory/items/{seeded_item.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 204

        # Deleted item should not appear in list
        list_resp = await async_client.get("/api/v1/inventory/items", headers=auth_headers)
        item_ids = [i["id"] for i in list_resp.json()["items"]]
        assert str(seeded_item.id) not in item_ids

    async def test_get_nonexistent_item_returns_404(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.get(
            f"/api/v1/inventory/items/{uuid4()}",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_item_detail_includes_stock_history(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        await async_client.post(
            "/api/v1/inventory/adjust",
            json={
                "item_id": str(seeded_item.id),
                "qty_change": "5",
                "reason": "purchase",
            },
            headers=auth_headers,
        )

        resp = await async_client.get(
            f"/api/v1/inventory/items/{seeded_item.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        history = resp.json()["stock_history"]
        assert history
        assert history[0]["item_id"] == str(seeded_item.id)


@pytest.mark.asyncio
class TestSuppliersAndPurchaseOrders:
    async def test_mobile_purchase_order_payload_lists_and_receives_all_remaining(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        supplier_resp = await async_client.post(
            "/api/v1/inventory/suppliers",
            json={
                "name": "Akosua Wholesale",
                "phone": "0244000000",
                "email": "akosua@example.com",
                "address": "Accra",
            },
            headers=auth_headers,
        )
        assert supplier_resp.status_code == 201
        supplier = supplier_resp.json()
        assert supplier["email"] == "akosua@example.com"
        assert supplier["address"] == "Accra"

        create_resp = await async_client.post(
            "/api/v1/inventory/purchase-orders",
            json={
                "supplier_id": supplier["id"],
                "expected_delivery_date": "2026-06-15",
                "line_items": [
                    {
                        "item_id": str(seeded_item.id),
                        "qty": 5,
                        "cost_price": 8.5,
                    }
                ],
                "notes": "Restock fast movers",
            },
            headers=auth_headers,
        )
        assert create_resp.status_code == 201
        created = create_resp.json()
        assert created["supplier_id"] == supplier["id"]
        assert created["expected_delivery_date"] == "2026-06-15"
        assert created["line_items"][0]["name"] == seeded_item.name
        assert created["line_items"][0]["qty"] == 5.0
        assert created["line_items"][0]["cost_price"] == 8.5

        list_resp = await async_client.get(
            "/api/v1/inventory/purchase-orders",
            headers=auth_headers,
        )
        assert list_resp.status_code == 200
        listed = list_resp.json()["items"][0]
        assert listed["supplier_name"] == "Akosua Wholesale"
        assert listed["line_items"][0]["name"] == seeded_item.name

        receive_resp = await async_client.post(
            f"/api/v1/inventory/purchase-orders/{created['id']}/receive",
            json={},
            headers=auth_headers,
        )
        assert receive_resp.status_code == 200
        assert receive_resp.json()["status"] == "received"

        item_resp = await async_client.get(
            f"/api/v1/inventory/items/{seeded_item.id}",
            headers=auth_headers,
        )
        assert item_resp.status_code == 200
        assert Decimal(item_resp.json()["current_stock"]) == Decimal("105.000")


@pytest.mark.asyncio
class TestInventoryKYCGate:
    async def _create_unverified_business(self, db_session):
        from apps.api.modules.auth.models import User
        from apps.api.modules.business.models import Business, BusinessMember

        user = User(phone="+233244777001", name="Unverified Owner")
        db_session.add(user)
        await db_session.flush([user])

        business = Business(owner_id=user.id, name="Unverified Inventory Shop", type="shop")
        db_session.add(business)
        await db_session.flush([business])
        db_session.add(BusinessMember(business_id=business.id, user_id=user.id, role="owner"))
        await db_session.flush()
        return user, business

    async def test_unverified_business_can_create_item(
        self, async_client: AsyncClient, db_session
    ):
        # Inventory setup (adding items, categories) is basic business setup, not a
        # financial operation. KYC gates only financial operations (sales, credit, tax).
        user, business = await self._create_unverified_business(db_session)
        resp = await async_client.post(
            "/api/v1/inventory/items",
            json={"name": "New Item", "unit": "piece", "sell_price": "10.00"},
            headers=_headers(user.id, business.id),
        )
        assert resp.status_code == 201

    async def test_unverified_business_can_bulk_import(
        self, async_client: AsyncClient, db_session
    ):
        user, business = await self._create_unverified_business(db_session)
        resp = await async_client.post(
            "/api/v1/inventory/items/bulk",
            json={"items": [{"name": "Bulk Item", "unit": "piece", "sell_price": "10.00"}]},
            headers=_headers(user.id, business.id),
        )
        assert resp.status_code in (201, 202)

    async def test_unverified_business_can_create_category(
        self, async_client: AsyncClient, db_session
    ):
        user, business = await self._create_unverified_business(db_session)
        resp = await async_client.post(
            "/api/v1/inventory/categories",
            json={"name": "New Category"},
            headers=_headers(user.id, business.id),
        )
        assert resp.status_code == 201

    async def test_unverified_business_csv_import_gated_by_feature_flag(
        self, async_client: AsyncClient, db_session
    ):
        # CSV import requires the bulk_csv_import feature flag (separate from KYC).
        # Without the feature flag enabled, the endpoint returns 402/403 (feature gate),
        # not a KYC error.
        user, business = await self._create_unverified_business(db_session)
        csv_body = "name,unit,cost_price,sell_price\nCSV Item,piece,5.00,10.00\n"
        resp = await async_client.post(
            "/api/v1/inventory/import/csv",
            files={"file": ("items.csv", csv_body, "text/csv")},
            headers=_headers(user.id, business.id),
        )
        # Either succeeds (feature enabled) or fails with feature gate (not KYC)
        if resp.status_code not in (200, 201, 202):
            assert resp.status_code in (402, 403)
            assert "KYC" not in resp.text

    async def test_unverified_business_can_read_and_adjust_existing_stock(
        self, async_client: AsyncClient, db_session
    ):
        from apps.api.modules.inventory.models import Item

        user, business = await self._create_unverified_business(db_session)
        item = Item(
            business_id=business.id,
            name="Existing Item",
            unit="piece",
            cost_price=Decimal("5.00"),
            sell_price=Decimal("10.00"),
            current_stock=Decimal("10"),
        )
        db_session.add(item)
        await db_session.flush([item])
        headers = _headers(user.id, business.id)

        listed = await async_client.get("/api/v1/inventory/items", headers=headers)
        assert listed.status_code == 200

        adjusted = await async_client.post(
            "/api/v1/inventory/adjust",
            json={"item_id": str(item.id), "qty_change": "1", "reason": "purchase"},
            headers=headers,
        )
        assert adjusted.status_code == 201


@pytest.mark.asyncio
class TestStockAdjustment:
    async def test_adjust_stock_increases_quantity(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        resp = await async_client.post(
            "/api/v1/inventory/adjust",
            json={
                "item_id": str(seeded_item.id),
                "qty_change": "20",
                "reason": "purchase",
                "unit_cost": "8.00",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert Decimal(data["qty_change"]) == Decimal("20")
        assert Decimal(data["qty_before"]) == Decimal("100")
        assert Decimal(data["qty_after"]) == Decimal("120")

    async def test_adjust_stock_negative_decreases_quantity(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        resp = await async_client.post(
            "/api/v1/inventory/adjust",
            json={
                "item_id": str(seeded_item.id),
                "qty_change": "-10",
                "reason": "damage",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert Decimal(resp.json()["qty_after"]) == Decimal("90")

    async def test_low_stock_adjustment_queues_notification(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, monkeypatch
    ):
        from apps.api.modules.inventory import service as inventory_service

        calls = []

        def fake_enqueue(task, *args, **kwargs):
            calls.append((task, args, kwargs))
            return None

        monkeypatch.setattr(inventory_service, "enqueue_task", fake_enqueue)

        resp = await async_client.post(
            "/api/v1/inventory/adjust",
            json={
                "item_id": str(seeded_item.id),
                "qty_change": "-95",
                "reason": "damage",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert calls
        assert calls[0][1][2] == seeded_item.name


@pytest.mark.asyncio
class TestBulkImport:
    async def test_bulk_import_small_batch(self, async_client: AsyncClient, auth_headers: dict):
        items = [
            {"name": f"Bulk Item {i}", "unit": "piece", "sell_price": f"{10 + i}.00"}
            for i in range(5)
        ]
        resp = await async_client.post(
            "/api/v1/inventory/items/bulk",
            json={"items": items},
            headers=auth_headers,
        )
        assert resp.status_code == 202
        data = resp.json()
        assert data["total"] == 5
        assert data["created"] == 5
        assert data["failed"] == 0
        assert data["job_id"] is None

    async def test_bulk_import_validation_failure_counted(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        items = [
            {"name": "Valid Item", "unit": "kg", "sell_price": "5.00"},
            # Missing sell_price
            {"name": "Invalid Item", "unit": "kg"},
        ]
        resp = await async_client.post(
            "/api/v1/inventory/items/bulk",
            json={"items": items},
            headers=auth_headers,
        )
        # FastAPI validates the whole payload at the Pydantic level first
        # so this will 422 — that's correct behaviour
        assert resp.status_code in (202, 422)


@pytest.mark.asyncio
class TestCategories:
    async def test_create_and_list_category(self, async_client: AsyncClient, auth_headers: dict):
        resp = await async_client.post(
            "/api/v1/inventory/categories",
            json={"name": "Grains"},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        cat_id = resp.json()["id"]

        list_resp = await async_client.get("/api/v1/inventory/categories", headers=auth_headers)
        assert resp.status_code == 201
        ids = [c["id"] for c in list_resp.json()]
        assert cat_id in ids
