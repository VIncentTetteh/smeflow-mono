"""Integration tests for Analytics & Reporting endpoints."""

from __future__ import annotations

from decimal import Decimal

import pytest
from httpx import AsyncClient

# ── Helpers ───────────────────────────────────────────────────────────────────


def today_str() -> str:
    from datetime import date

    return date.today().isoformat()


# ── Revenue by day ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_revenue_by_day_empty(async_client: AsyncClient, auth_headers):
    resp = await async_client.get(
        "/api/v1/analytics/revenue/daily",
        params={"from_date": "2020-01-01", "to_date": "2020-01-31"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_revenue_by_day_after_sale(
    async_client: AsyncClient, auth_headers, seeded_item, db_session
):
    import uuid

    from apps.api.modules.sales.models import Sale

    biz_id = seeded_item.business_id
    sale = Sale(
        business_id=biz_id,
        status="completed",
        payment_method="cash",
        subtotal=Decimal("50.00"),
        total=Decimal("50.00"),
        amount_paid=Decimal("50.00"),
        balance_due=Decimal("0"),
        idempotency_key=str(uuid.uuid4()),
    )
    db_session.add(sale)
    await db_session.flush()

    resp = await async_client.get(
        "/api/v1/analytics/revenue/daily",
        params={"from_date": today_str(), "to_date": today_str()},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert float(data[0]["revenue"]) == 50.0
    assert data[0]["total_sales"] == 1


# ── Top items ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_top_items_empty(async_client: AsyncClient, auth_headers):
    resp = await async_client.get(
        "/api/v1/analytics/items/top",
        params={"from_date": "2020-01-01", "to_date": "2020-01-31"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_top_items_after_sale(
    async_client: AsyncClient, auth_headers, seeded_item, db_session
):
    import uuid

    from apps.api.modules.sales.models import Sale, SaleItem

    biz_id = seeded_item.business_id
    sale = Sale(
        business_id=biz_id,
        status="completed",
        payment_method="cash",
        subtotal=Decimal("120.00"),
        total=Decimal("120.00"),
        amount_paid=Decimal("120.00"),
        balance_due=Decimal("0"),
        idempotency_key=str(uuid.uuid4()),
    )
    db_session.add(sale)
    await db_session.flush([sale])

    si = SaleItem(
        sale_id=sale.id,
        item_id=seeded_item.id,
        description="Test Tomatoes",
        qty=Decimal("10"),
        unit_price=Decimal("12.00"),
        line_total=Decimal("120.00"),
    )
    db_session.add(si)
    await db_session.flush()

    resp = await async_client.get(
        "/api/v1/analytics/items/top",
        params={"from_date": today_str(), "to_date": today_str()},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert data[0]["description"] == "Test Tomatoes"
    assert float(data[0]["total_revenue"]) == 120.0


# ── P&L summary ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pnl_empty(async_client: AsyncClient, auth_headers):
    resp = await async_client.get(
        "/api/v1/analytics/pnl",
        params={"from_date": "2020-01-01", "to_date": "2020-01-31"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert float(data["revenue"]) == 0
    assert float(data["gross_profit"]) == 0


@pytest.mark.asyncio
async def test_pnl_with_sales(async_client: AsyncClient, auth_headers, seeded_item, db_session):
    import uuid

    from apps.api.modules.sales.models import Sale, SaleItem

    biz_id = seeded_item.business_id
    sale = Sale(
        business_id=biz_id,
        status="completed",
        payment_method="cash",
        subtotal=Decimal("120.00"),
        total=Decimal("120.00"),
        amount_paid=Decimal("120.00"),
        balance_due=Decimal("0"),
        idempotency_key=str(uuid.uuid4()),
    )
    db_session.add(sale)
    await db_session.flush([sale])

    si = SaleItem(
        sale_id=sale.id,
        item_id=seeded_item.id,
        description="Test Tomatoes",
        qty=Decimal("10"),
        unit_price=Decimal("12.00"),
        line_total=Decimal("120.00"),
    )
    db_session.add(si)
    await db_session.flush()

    resp = await async_client.get(
        "/api/v1/analytics/pnl",
        params={"from_date": today_str(), "to_date": today_str()},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    # revenue = 120, cogs = 10 * cost_price(8) = 80, gross_profit = 40
    assert float(data["revenue"]) == 120.0
    assert float(data["cogs"]) == 80.0
    assert float(data["gross_profit"]) == 40.0


# ── Cash flow ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cash_flow_empty(async_client: AsyncClient, auth_headers):
    resp = await async_client.get(
        "/api/v1/analytics/cash-flow",
        params={"from_date": "2020-01-01", "to_date": "2020-01-31"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert float(data["total_inflow"]) == 0
    assert data["total_sales"] == 0


# ── Inventory turnover ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_inventory_turnover_empty(async_client: AsyncClient, auth_headers):
    resp = await async_client.get(
        "/api/v1/analytics/inventory/turnover",
        params={"from_date": "2020-01-01", "to_date": "2020-01-31"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


# ── Top customers ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_top_customers_empty(async_client: AsyncClient, auth_headers):
    resp = await async_client.get(
        "/api/v1/analytics/customers/top",
        params={"from_date": "2020-01-01", "to_date": "2020-01-31"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == []


# ── Low stock ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_low_stock_includes_seeded_item(
    async_client: AsyncClient, auth_headers, seeded_item, db_session
):
    # Drain stock below threshold
    seeded_item.current_stock = Decimal("5")  # threshold is 10
    await db_session.flush([seeded_item])

    resp = await async_client.get(
        "/api/v1/analytics/inventory/low-stock",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    names = [i["name"] for i in data]
    assert "Test Tomatoes" in names


@pytest.mark.asyncio
async def test_low_stock_excludes_healthy_items(
    async_client: AsyncClient, auth_headers, seeded_item
):
    # seeded_item starts with stock=100, threshold=10 → not low
    resp = await async_client.get(
        "/api/v1/analytics/inventory/low-stock",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert all(i["name"] != "Test Tomatoes" for i in data)


# ── Plan gating ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_starter_plan_can_use_basic_premium_analytics(
    async_client: AsyncClient, auth_headers
):
    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "starter"},
        headers=auth_headers,
    )

    resp = await async_client.get(
        "/api/v1/analytics/top-items",
        params={"period": "30d"},
        headers=auth_headers,
    )

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_starter_plan_can_use_profit_loss(async_client: AsyncClient, auth_headers):
    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "starter"},
        headers=auth_headers,
    )

    resp = await async_client.get(
        "/api/v1/analytics/profit-loss",
        params={"period": "monthly", "year": 2026, "month": 5},
        headers=auth_headers,
    )

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_pro_profit_loss_includes_comparison_fields(async_client: AsyncClient, auth_headers):
    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "pro"},
        headers=auth_headers,
    )

    resp = await async_client.get(
        "/api/v1/analytics/profit-loss",
        params={"period": "monthly", "year": 2026, "month": 5},
        headers=auth_headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["period"] == "2026-05"
    assert "previous_period" in data
    assert "gross_margin_delta_percent" in data


@pytest.mark.asyncio
async def test_benchmarking_is_unavailable_until_real_aggregate_data_exists(
    async_client: AsyncClient, auth_headers
):
    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "pro"},
        headers=auth_headers,
    )

    resp = await async_client.get(
        "/api/v1/analytics/benchmarking/retail",
        headers=auth_headers,
    )

    assert resp.status_code == 503
    assert "not available" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_staff_performance_groups_sales_by_recorded_by(
    async_client: AsyncClient, auth_headers, seeded_business, db_session
):
    from uuid import uuid4

    from apps.api.modules.auth.models import User
    from apps.api.modules.sales.models import Sale

    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "pro"},
        headers=auth_headers,
    )

    business = seeded_business["business"]
    owner = seeded_business["user"]
    cashier = User(phone="+233244999003", name="Cashier Ama")
    db_session.add(cashier)
    await db_session.flush([cashier])

    db_session.add_all(
        [
            Sale(
                business_id=business.id,
                recorded_by=owner.id,
                status="completed",
                payment_method="cash",
                subtotal=Decimal("100.00"),
                total=Decimal("100.00"),
                amount_paid=Decimal("100.00"),
                idempotency_key=str(uuid4()),
            ),
            Sale(
                business_id=business.id,
                recorded_by=cashier.id,
                status="completed",
                payment_method="cash",
                subtotal=Decimal("30.00"),
                total=Decimal("30.00"),
                amount_paid=Decimal("30.00"),
                idempotency_key=str(uuid4()),
            ),
            Sale(
                business_id=business.id,
                recorded_by=cashier.id,
                status="voided",
                payment_method="cash",
                subtotal=Decimal("500.00"),
                total=Decimal("500.00"),
                amount_paid=Decimal("0.00"),
                idempotency_key=str(uuid4()),
            ),
        ]
    )
    await db_session.flush()

    resp = await async_client.get(
        "/api/v1/analytics/staff-performance",
        params={"from_date": today_str(), "to_date": today_str()},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    rows = {r["user_id"]: r for r in resp.json()}
    assert float(rows[str(owner.id)]["revenue"]) == 100.0
    assert rows[str(owner.id)]["sale_count"] == 1
    assert float(rows[str(cashier.id)]["revenue"]) == 30.0
    assert rows[str(cashier.id)]["sale_count"] == 1
    assert rows[str(cashier.id)]["name"] == "Cashier Ama"
