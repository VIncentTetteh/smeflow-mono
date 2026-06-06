"""Integration tests for Admin (platform-level) endpoints."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

# ── Helpers ───────────────────────────────────────────────────────────────────


def platform_admin_headers(user_id) -> dict[str, str]:
    """Build an Authorization header with role=platform_admin."""
    from apps.api.core.security import create_access_token

    token = create_access_token(user_id=user_id, business_id=None, role="platform_admin")
    return {"Authorization": f"Bearer {token}"}


# ── Role enforcement ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_metrics_rejects_non_admin(async_client: AsyncClient, auth_headers):
    """Regular owner JWT should be rejected with 403."""
    resp = await async_client.get("/api/v1/admin/metrics", headers=auth_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_metrics_rejects_missing_token(async_client: AsyncClient):
    resp = await async_client.get("/api/v1/admin/metrics")
    assert resp.status_code == 401


# ── Platform metrics ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_platform_metrics(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/metrics", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_businesses" in data
    assert "total_users" in data
    assert "total_sales" in data
    assert "total_revenue_ghs" in data
    assert data["total_businesses"] >= 1


@pytest.mark.asyncio
async def test_admin_kpis_contract(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/analytics/kpis", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    for key in [
        "total_businesses",
        "active_businesses",
        "active_subscriptions",
        "tpv_ghs",
        "subscription_revenue_ghs",
        "loan_disbursement_ghs",
        "pending_kyc",
        "verified_kyc",
    ]:
        assert key in data


@pytest.mark.asyncio
async def test_provider_readiness_report_is_admin_gated(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/provider-readiness", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ready", "blocked")
    assert "paystack" in data["providers"]
    assert "missing" in data["providers"]["paystack"]


# ── Business listing ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_businesses(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/businesses", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert "items" in data
    assert data["total"] >= 1
    names = [b["name"] for b in data["items"]]
    assert "Test Shop" in names


@pytest.mark.asyncio
async def test_list_businesses_search(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get(
        "/api/v1/admin/businesses",
        params={"search": "Test"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1

    resp_no_match = await async_client.get(
        "/api/v1/admin/businesses",
        params={"search": "zzz_no_match_zzz"},
        headers=headers,
    )
    assert resp_no_match.json()["total"] == 0


# ── Suspend / unsuspend ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_suspend_and_unsuspend_business(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    biz_id = seeded_business["business"].id
    headers = platform_admin_headers(admin_id)

    # Suspend
    resp = await async_client.post(f"/api/v1/admin/businesses/{biz_id}/suspend", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    # Suspend again → 409
    resp2 = await async_client.post(f"/api/v1/admin/businesses/{biz_id}/suspend", headers=headers)
    assert resp2.status_code == 409

    # Unsuspend
    resp3 = await async_client.post(f"/api/v1/admin/businesses/{biz_id}/unsuspend", headers=headers)
    assert resp3.status_code == 200
    assert resp3.json()["is_active"] is True


@pytest.mark.asyncio
async def test_suspend_nonexistent_business(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)
    fake_id = str(uuid.uuid4())

    resp = await async_client.post(f"/api/v1/admin/businesses/{fake_id}/suspend", headers=headers)
    assert resp.status_code == 404


# ── Credit override ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_credit_override(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    biz_id = seeded_business["business"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.post(
        "/api/v1/admin/credit/override",
        json={
            "business_id": str(biz_id),
            "score": 750.0,
            "band": "B",
            "max_loan_amount": 5000.0,
        },
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert float(data["score"]) == 750.0
    assert data["band"] == "B"
    assert float(data["max_loan_amount"]) == 5000.0
    assert str(data["business_id"]) == str(biz_id)


# ── Audit logs ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_audit_logs_empty(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/audit-logs", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert "items" in data
    assert all("actor_id" in item and "success" in item for item in data["items"])


@pytest.mark.asyncio
async def test_audit_logs_filter_by_business(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    biz_id = seeded_business["business"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get(
        "/api/v1/admin/audit-logs",
        params={"business_id": str(biz_id)},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    # All returned logs should belong to this business (or total=0 if none logged yet)
    for log in data["items"]:
        assert log["business_id"] == str(biz_id)


@pytest.mark.asyncio
async def test_fraud_queue_contract(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get(
        "/api/v1/admin/fraud-queue",
        params={"min_transactions": 2, "lookback_minutes": 1440},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "count" in data
    for item in data["items"]:
        assert {"business_id", "business_name", "signal", "detail", "severity", "flagged_at"}.issubset(item)


@pytest.mark.asyncio
async def test_pending_actions_contract(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/pending-actions", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert {"total", "items", "limit", "offset"}.issubset(data)


@pytest.mark.asyncio
async def test_transactions_contract(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/transactions", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert {"total", "items", "limit", "offset"}.issubset(data)


@pytest.mark.asyncio
async def test_appeals_contract(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/appeals", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert {"total", "items", "limit", "offset"}.issubset(data)


@pytest.mark.asyncio
async def test_admin_can_resolve_appeal(async_client: AsyncClient, seeded_business, db_session):
    from apps.api.modules.admin.models import SuspensionAppeal

    admin_id = seeded_business["user"].id
    business = seeded_business["business"]
    business.is_active = False
    appeal = SuspensionAppeal(
        business_id=business.id,
        submitted_by=seeded_business["user"].id,
        reason="We have resolved the issue.",
    )
    db_session.add(appeal)
    await db_session.commit()
    headers = platform_admin_headers(admin_id)

    resp = await async_client.post(
        f"/api/v1/admin/appeals/{appeal.id}/approve",
        json={"reason": "Appeal accepted"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
    await db_session.refresh(business)
    assert business.is_active is True


@pytest.mark.asyncio
async def test_admin_account_management_contract(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/admins", headers=headers)

    assert resp.status_code == 200
    assert {"total", "items", "limit", "offset"}.issubset(resp.json())


@pytest.mark.asyncio
async def test_lender_revenue_contract(async_client: AsyncClient, seeded_business):
    admin_id = seeded_business["user"].id
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/lender-revenue", headers=headers)
    summary = await async_client.get("/api/v1/admin/lender-revenue/summary", headers=headers)

    assert resp.status_code == 200
    assert {"total", "items", "limit", "offset"}.issubset(resp.json())
    assert summary.status_code == 200
    assert {"totals", "by_lender"}.issubset(summary.json())


@pytest.mark.asyncio
async def test_kyc_queue_includes_pending_user_kyc(async_client: AsyncClient, seeded_business, db_session):
    from datetime import datetime, timezone

    admin_id = seeded_business["user"].id
    user = seeded_business["user"]
    user.kyc_status = "pending"
    user.kyc_submitted_at = datetime.now(timezone.utc)
    await db_session.commit()
    headers = platform_admin_headers(admin_id)

    resp = await async_client.get("/api/v1/admin/kyc/queue", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert {"total", "items", "limit", "offset"}.issubset(data)
    user_rows = [
        row for row in data["items"] if row["scope"] == "user" and row["user_id"] == str(user.id)
    ]
    assert user_rows
    assert user_rows[0]["status"] == "pending"
    assert user_rows[0]["business_name"] == "Test Shop"


@pytest.mark.asyncio
async def test_admin_can_review_user_kyc(async_client: AsyncClient, seeded_business, db_session):
    from datetime import datetime, timezone

    admin_id = seeded_business["user"].id
    user = seeded_business["user"]
    user.kyc_status = "pending"
    user.kyc_submitted_at = datetime.now(timezone.utc)
    await db_session.commit()
    headers = platform_admin_headers(admin_id)

    resp = await async_client.post(
        f"/api/v1/admin/kyc/users/{user.id}/review",
        json={"approved": True},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "verified"
    await db_session.refresh(user)
    assert user.kyc_status == "verified"
    assert user.kyc_verified_at is not None
