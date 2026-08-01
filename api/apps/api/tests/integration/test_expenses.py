"""Integration tests for Expenses and the net-profit P&L they feed."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from httpx import AsyncClient

# ── Helpers ───────────────────────────────────────────────────────────────────


def today_str() -> str:
    return date.today().isoformat()


async def record_expense(async_client: AsyncClient, auth_headers, **overrides) -> dict:
    payload = {
        "category": "rent",
        "amount": "150.00",
        "expense_date": today_str(),
        "payment_method": "cash",
    }
    payload.update(overrides)
    resp = await async_client.post("/api/v1/expenses", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def seed_sale(db_session, business_id, item):
    """Revenue 120, COGS 10 * 8.00 = 80, gross profit 40 — mirrors test_analytics."""
    from apps.api.modules.sales.models import Sale, SaleItem

    sale = Sale(
        business_id=business_id,
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
    db_session.add(
        SaleItem(
            sale_id=sale.id,
            item_id=item.id,
            description=item.name,
            qty=Decimal("10"),
            unit_price=Decimal("12.00"),
            line_total=Decimal("120.00"),
        )
    )
    await db_session.flush()
    return sale


async def get_pnl(async_client: AsyncClient, auth_headers) -> dict:
    resp = await async_client.get(
        "/api/v1/analytics/pnl",
        params={"from_date": today_str(), "to_date": today_str()},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── Categories ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_categories(async_client: AsyncClient, auth_headers):
    resp = await async_client.get("/api/v1/expenses/categories", headers=auth_headers)
    assert resp.status_code == 200
    categories = resp.json()
    by_key = {c["key"]: c for c in categories}

    assert by_key["rent"]["kind"] == "operating"
    assert by_key["stock_purchase"]["kind"] == "cogs"
    assert by_key["owner_drawings"]["kind"] == "non_operating"
    assert all(c["label"] for c in categories)


# ── CRUD ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_record_and_list_expense(async_client: AsyncClient, auth_headers):
    created = await record_expense(
        async_client,
        auth_headers,
        category="transport_fuel",
        amount="42.50",
        vendor_name="Shell Osu",
        reference="RCT-001",
    )
    assert created["category"] == "transport_fuel"
    assert created["category_label"] == "Transport & fuel"
    assert created["kind"] == "operating"
    assert float(created["amount"]) == 42.50
    assert created["source"] == "manual"
    assert created["is_editable"] is True

    resp = await async_client.get("/api/v1/expenses", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == created["id"]


@pytest.mark.asyncio
async def test_record_expense_rejects_unknown_category(async_client: AsyncClient, auth_headers):
    resp = await async_client.post(
        "/api/v1/expenses",
        json={
            "category": "bribes",
            "amount": "10.00",
            "expense_date": today_str(),
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_record_expense_rejects_unknown_payment_method(
    async_client: AsyncClient, auth_headers
):
    resp = await async_client.post(
        "/api/v1/expenses",
        json={
            "category": "rent",
            "amount": "10.00",
            "expense_date": today_str(),
            "payment_method": "barter",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_expense(async_client: AsyncClient, auth_headers):
    created = await record_expense(async_client, auth_headers)

    resp = await async_client.patch(
        f"/api/v1/expenses/{created['id']}",
        json={"amount": "175.00", "notes": "Corrected"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert float(resp.json()["amount"]) == 175.00
    assert resp.json()["notes"] == "Corrected"


@pytest.mark.asyncio
async def test_soft_delete_expense(async_client: AsyncClient, auth_headers):
    created = await record_expense(async_client, auth_headers)

    resp = await async_client.delete(f"/api/v1/expenses/{created['id']}", headers=auth_headers)
    assert resp.status_code == 204

    detail = await async_client.get(f"/api/v1/expenses/{created['id']}", headers=auth_headers)
    assert detail.status_code == 404

    listing = await async_client.get("/api/v1/expenses", headers=auth_headers)
    assert listing.json()["total"] == 0


@pytest.mark.asyncio
async def test_get_missing_expense_returns_404(async_client: AsyncClient, auth_headers):
    resp = await async_client.get(f"/api/v1/expenses/{uuid.uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


# ── Tenant isolation ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_expense_is_scoped_to_its_business(
    async_client: AsyncClient, auth_headers, seeded_business, db_session
):
    from apps.api.core.security import create_access_token
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business, BusinessMember

    created = await record_expense(async_client, auth_headers)

    other_user = User(phone="+233244999002", name="Other Owner")
    db_session.add(other_user)
    await db_session.flush([other_user])
    other_biz = Business(owner_id=other_user.id, name="Other Shop", type="shop")
    db_session.add(other_biz)
    await db_session.flush([other_biz])
    db_session.add(BusinessMember(business_id=other_biz.id, user_id=other_user.id, role="owner"))
    await db_session.flush()

    other_headers = {
        "Authorization": "Bearer "
        + create_access_token(user_id=other_user.id, business_id=other_biz.id, role="owner")
    }

    assert (
        await async_client.get(f"/api/v1/expenses/{created['id']}", headers=other_headers)
    ).status_code == 404
    assert (
        await async_client.patch(
            f"/api/v1/expenses/{created['id']}", json={"amount": "1.00"}, headers=other_headers
        )
    ).status_code == 404
    assert (await async_client.get("/api/v1/expenses", headers=other_headers)).json()["total"] == 0


# ── Summary ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_summary_splits_operating_from_excluded(async_client: AsyncClient, auth_headers):
    await record_expense(async_client, auth_headers, category="rent", amount="100.00")
    await record_expense(
        async_client, auth_headers, category="transport_fuel", amount="25.00", payment_method="momo"
    )
    await record_expense(async_client, auth_headers, category="stock_purchase", amount="500.00")
    await record_expense(async_client, auth_headers, category="owner_drawings", amount="200.00")

    resp = await async_client.get(
        "/api/v1/expenses/summary",
        params={"from_date": today_str(), "to_date": today_str()},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["total"] == 825.0
    assert body["operating_total"] == 125.0
    assert body["excluded_total"] == 700.0
    assert body["count"] == 4

    by_method = {r["payment_method"]: r["total"] for r in body["by_payment_method"]}
    assert by_method["cash"] == 800.0
    assert by_method["momo"] == 25.0


@pytest.mark.asyncio
async def test_summary_empty(async_client: AsyncClient, auth_headers):
    resp = await async_client.get(
        "/api/v1/expenses/summary",
        params={"from_date": today_str(), "to_date": today_str()},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["operating_total"] == 0
    assert body["by_category"] == []


# ── Net profit ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pnl_reports_net_profit(
    async_client: AsyncClient, auth_headers, seeded_business, seeded_item, db_session
):
    await seed_sale(db_session, seeded_business["business"].id, seeded_item)
    await record_expense(async_client, auth_headers, category="rent", amount="15.00")

    data = await get_pnl(async_client, auth_headers)

    # revenue 120, cogs 80 → gross 40; rent 15 → net 25
    assert float(data["revenue"]) == 120.0
    assert float(data["cogs"]) == 80.0
    assert float(data["gross_profit"]) == 40.0
    assert float(data["operating_expenses"]) == 15.0
    assert float(data["net_profit"]) == 25.0
    assert data["net_margin_pct"] == pytest.approx(20.83, abs=0.01)


@pytest.mark.asyncio
async def test_pnl_excludes_cogs_and_non_operating_categories(
    async_client: AsyncClient, auth_headers, seeded_business, seeded_item, db_session
):
    """The double-count guard: stock purchases are already in COGS."""
    await seed_sale(db_session, seeded_business["business"].id, seeded_item)

    before = await get_pnl(async_client, auth_headers)
    assert float(before["operating_expenses"]) == 0.0
    assert float(before["net_profit"]) == 40.0

    await record_expense(async_client, auth_headers, category="stock_purchase", amount="500.00")
    await record_expense(async_client, auth_headers, category="owner_drawings", amount="300.00")
    await record_expense(async_client, auth_headers, category="loan_repayment", amount="80.00")

    after = await get_pnl(async_client, auth_headers)
    assert float(after["operating_expenses"]) == 0.0
    assert float(after["net_profit"]) == 40.0


@pytest.mark.asyncio
async def test_pnl_with_no_revenue_reports_zero_margin(async_client: AsyncClient, auth_headers):
    await record_expense(async_client, auth_headers, category="rent", amount="90.00")

    data = await get_pnl(async_client, auth_headers)
    assert float(data["operating_expenses"]) == 90.0
    assert float(data["net_profit"]) == -90.0
    assert data["net_margin_pct"] == 0


@pytest.mark.asyncio
async def test_pnl_expenses_by_category_is_operating_only(async_client: AsyncClient, auth_headers):
    await record_expense(async_client, auth_headers, category="rent", amount="100.00")
    await record_expense(async_client, auth_headers, category="stock_purchase", amount="400.00")

    data = await get_pnl(async_client, auth_headers)
    categories = {row["category"] for row in data["expenses_by_category"]}
    assert categories == {"rent"}


@pytest.mark.asyncio
async def test_pnl_ignores_expenses_outside_the_window(async_client: AsyncClient, auth_headers):
    await record_expense(
        async_client, auth_headers, category="rent", amount="100.00", expense_date="2020-01-15"
    )

    data = await get_pnl(async_client, auth_headers)
    assert float(data["operating_expenses"]) == 0.0


@pytest.mark.asyncio
async def test_deleted_expense_leaves_the_pnl(async_client: AsyncClient, auth_headers):
    created = await record_expense(async_client, auth_headers, category="rent", amount="60.00")
    assert float((await get_pnl(async_client, auth_headers))["operating_expenses"]) == 60.0

    await async_client.delete(f"/api/v1/expenses/{created['id']}", headers=auth_headers)
    assert float((await get_pnl(async_client, auth_headers))["operating_expenses"]) == 0.0


# ── Cash flow ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cash_flow_reports_outflow(
    async_client: AsyncClient, auth_headers, seeded_business, seeded_item, db_session
):
    await seed_sale(db_session, seeded_business["business"].id, seeded_item)
    await record_expense(
        async_client, auth_headers, category="rent", amount="30.00", payment_method="cash"
    )
    await record_expense(
        async_client, auth_headers, category="airtime_data", amount="20.00", payment_method="momo"
    )
    # Credit-terms spend has not left the business yet.
    await record_expense(
        async_client, auth_headers, category="packaging", amount="70.00", payment_method="credit"
    )

    resp = await async_client.get(
        "/api/v1/analytics/cash-flow",
        params={"from_date": today_str(), "to_date": today_str()},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    assert float(data["total_inflow"]) == 120.0
    assert float(data["cash_outflow"]) == 30.0
    assert float(data["momo_outflow"]) == 20.0
    assert float(data["total_outflow"]) == 50.0
    assert float(data["net_cash_flow"]) == 70.0


# ── Payroll auto-post ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_payroll_disbursement_posts_one_idempotent_wages_expense(
    async_client: AsyncClient, auth_headers, seeded_business, db_session
):
    from apps.api.modules.expenses.service import ExpenseService
    from apps.api.modules.payroll.models import PayrollRun
    from apps.api.modules.payroll.service import PayrollService

    business_id = seeded_business["business"].id
    run = PayrollRun(
        business_id=business_id,
        period_start=date(2026, 7, 1),
        period_end=date(2026, 7, 31),
        status="approved",
        total_gross=Decimal("1000.00"),
        total_ssnit_employer=Decimal("130.00"),
        total_ssnit_employee=Decimal("55.00"),
        total_income_tax=Decimal("45.00"),
        total_net=Decimal("900.00"),
    )
    db_session.add(run)
    await db_session.flush([run])

    svc = PayrollService(db_session)
    await svc._post_wages_expense(business_id, run)
    await svc._post_wages_expense(business_id, run)  # retried disbursement

    expenses, total = await ExpenseService(db_session).list_expenses(
        business_id, category="wages_salaries"
    )
    assert total == 1
    posted = expenses[0]
    # Employer cost: gross 1000 + employer SSNIT 130 (not net pay).
    assert posted.amount == Decimal("1130.00")
    assert posted.source == "payroll"
    assert posted.source_id == run.id
    assert posted.expense_date == date(2026, 7, 31)


@pytest.mark.asyncio
async def test_system_expense_cannot_be_edited_or_deleted(
    async_client: AsyncClient, auth_headers, seeded_business, db_session
):
    from apps.api.modules.expenses.service import ExpenseService

    business_id = seeded_business["business"].id
    run_id = uuid.uuid4()
    expense = await ExpenseService(db_session).upsert_system_expense(
        business_id,
        source="payroll",
        source_id=run_id,
        category="wages_salaries",
        amount=Decimal("500.00"),
        expense_date=date.today(),
    )
    await db_session.flush()

    detail = await async_client.get(f"/api/v1/expenses/{expense.id}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["is_editable"] is False
    assert detail.json()["source"] == "payroll"

    patched = await async_client.patch(
        f"/api/v1/expenses/{expense.id}", json={"amount": "1.00"}, headers=auth_headers
    )
    assert patched.status_code == 409

    deleted = await async_client.delete(f"/api/v1/expenses/{expense.id}", headers=auth_headers)
    assert deleted.status_code == 409


@pytest.mark.asyncio
async def test_payroll_expense_reaches_net_profit(
    async_client: AsyncClient, auth_headers, seeded_business, seeded_item, db_session
):
    from apps.api.modules.expenses.service import ExpenseService

    business_id = seeded_business["business"].id
    await seed_sale(db_session, business_id, seeded_item)
    await ExpenseService(db_session).upsert_system_expense(
        business_id,
        source="payroll",
        source_id=uuid.uuid4(),
        category="wages_salaries",
        amount=Decimal("10.00"),
        expense_date=date.today(),
    )
    await db_session.flush()

    data = await get_pnl(async_client, auth_headers)
    assert float(data["operating_expenses"]) == 10.0
    assert float(data["net_profit"]) == 30.0
