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
