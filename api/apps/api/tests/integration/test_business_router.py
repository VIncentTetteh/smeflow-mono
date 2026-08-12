"""Integration tests for business/router.py endpoints not covered by
test_onboarding_compliance.py: GET/PATCH /me, GET /dashboard-summary, and
POST /support/appeal."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestBusinessProfile:
    async def test_get_my_business_returns_profile(
        self, async_client: AsyncClient, auth_headers: dict, seeded_business
    ):
        resp = await async_client.get("/api/v1/business/me", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(seeded_business["business"].id)
        assert data["name"] == "Test Shop"
        assert data["owner_id"] == str(seeded_business["user"].id)

    async def test_update_my_business_as_owner(
        self, async_client: AsyncClient, auth_headers: dict, seeded_business
    ):
        resp = await async_client.patch(
            "/api/v1/business/me",
            # region/city are accepted by BusinessUpdate but not echoed back by
            # BusinessResponse/BusinessDetailResponse — only assert fields the
            # response schema actually exposes.
            json={"name": "Renamed Shop", "address": "12 Oxford Street", "region": "Ashanti"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Renamed Shop"
        assert data["address"] == "12 Oxford Street"

        refetch = await async_client.get("/api/v1/business/me", headers=auth_headers)
        assert refetch.json()["name"] == "Renamed Shop"


@pytest.mark.asyncio
class TestDashboardSummary:
    async def test_dashboard_summary_returns_all_sections_for_fresh_business(
        self, async_client: AsyncClient, auth_headers: dict, seeded_business
    ):
        """A brand-new business has no sales/alerts/credit history — every
        section must fail open (return null/empty) rather than 500, so the
        mobile home screen always loads per the endpoint's own docstring."""
        resp = await async_client.get("/api/v1/business/dashboard-summary", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {
            "daily_summary",
            "alerts",
            "credit_score",
            "tax_summary",
            "low_stock_preview",
            "generated_at",
        }
        assert data["low_stock_preview"] == []
        assert data["alerts"] == {"items": [], "unread_count": 0}

    async def test_dashboard_summary_reflects_recorded_sale(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        sale = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "1", "unit_price": "12.00"}],
                "payment_method": "cash",
                "idempotency_key": "dashboard-summary-sale-check",
            },
            headers=auth_headers,
        )
        assert sale.status_code == 201

        resp = await async_client.get("/api/v1/business/dashboard-summary", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["daily_summary"] is not None


@pytest.mark.asyncio
class TestMyStores:
    async def test_my_stores_returns_only_businesses_owned_by_caller(
        self, async_client: AsyncClient, auth_headers: dict, seeded_business, db_session
    ):
        from decimal import Decimal
        from uuid import uuid4

        from apps.api.modules.business.models import Business, BusinessMember
        from apps.api.modules.sales.models import Sale

        owner = seeded_business["user"]
        first_biz = seeded_business["business"]

        second_biz = Business(owner_id=owner.id, name="Second Shop", type="shop")
        db_session.add(second_biz)
        await db_session.flush([second_biz])
        db_session.add(BusinessMember(business_id=second_biz.id, user_id=owner.id, role="owner"))

        # A sale on the first business today, plus one that shouldn't count
        # (voided) — confirms the today_sales aggregation is correct.
        db_session.add_all(
            [
                Sale(
                    business_id=first_biz.id,
                    recorded_by=owner.id,
                    status="completed",
                    payment_method="cash",
                    subtotal=Decimal("40.00"),
                    total=Decimal("40.00"),
                    amount_paid=Decimal("40.00"),
                    idempotency_key=str(uuid4()),
                ),
                Sale(
                    business_id=first_biz.id,
                    recorded_by=owner.id,
                    status="voided",
                    payment_method="cash",
                    subtotal=Decimal("999.00"),
                    total=Decimal("999.00"),
                    amount_paid=Decimal("0.00"),
                    idempotency_key=str(uuid4()),
                ),
            ]
        )
        await db_session.flush()

        resp = await async_client.get("/api/v1/business/my-stores", headers=auth_headers)
        assert resp.status_code == 200
        stores = {s["business_id"]: s for s in resp.json()}
        assert set(stores) == {str(first_biz.id), str(second_biz.id)}
        assert stores[str(first_biz.id)]["today_sales"] == 40.0
        assert stores[str(first_biz.id)]["staff_count"] == 1
        assert stores[str(second_biz.id)]["today_sales"] == 0.0
        assert stores[str(second_biz.id)]["business_name"] == "Second Shop"

    async def test_my_stores_excludes_businesses_where_caller_is_staff_not_owner(
        self, async_client: AsyncClient, auth_headers: dict, seeded_business, db_session
    ):
        from apps.api.modules.auth.models import User
        from apps.api.modules.business.models import Business, BusinessMember

        owner = seeded_business["user"]
        other_owner = User(phone="+233244999002", name="Other Owner")
        db_session.add(other_owner)
        await db_session.flush([other_owner])

        other_biz = Business(owner_id=other_owner.id, name="Not Mine", type="shop")
        db_session.add(other_biz)
        await db_session.flush([other_biz])
        db_session.add(BusinessMember(business_id=other_biz.id, user_id=owner.id, role="staff"))
        await db_session.flush()

        resp = await async_client.get("/api/v1/business/my-stores", headers=auth_headers)
        assert resp.status_code == 200
        business_ids = {s["business_id"] for s in resp.json()}
        assert str(other_biz.id) not in business_ids
        assert str(seeded_business["business"].id) in business_ids


@pytest.mark.asyncio
class TestSuspensionAppeal:
    async def test_submit_appeal_creates_pending_record(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.post(
            "/api/v1/business/support/appeal",
            json={
                "reason": "We were suspended in error; here is our GRA TIN certificate.",
                "evidence_url": "https://cdn.smeflow.app/appeals/tin.pdf",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["appeal_id"]
        assert data["status"] == "pending"

    async def test_submit_appeal_without_evidence_url(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.post(
            "/api/v1/business/support/appeal",
            json={"reason": "Appeal with no evidence attached."},
            headers=auth_headers,
        )
        assert resp.status_code == 201
