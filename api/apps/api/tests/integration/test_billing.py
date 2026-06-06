"""Integration tests for Billing & Subscription endpoints."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

# ── Plans catalogue ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_plans(async_client: AsyncClient, auth_headers):
    resp = await async_client.get("/api/v1/billing/plans", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    # Response is a list of plan objects
    assert isinstance(data, list)
    plan_names = [p["name"] for p in data]
    assert "free" in plan_names
    assert "starter" in plan_names
    assert "pro" in plan_names
    free = next(p for p in data if p["name"] == "free")
    starter = next(p for p in data if p["name"] == "starter")
    pro = next(p for p in data if p["name"] == "pro")
    assert free["price"] == "0"
    assert free["items"] == 50
    assert free["customers"] == 50
    assert free["monthly_invoices"] == 0
    assert free["ai_messages"] == 30
    assert starter["price"] == "49"
    assert starter["annual_price_ghs"] == "490"
    assert starter["employees"] == 3
    assert starter["monthly_invoices"] == 20
    assert pro["sale_limit"] is None  # unlimited
    assert pro["annual_price_ghs"] == "1490"
    assert pro["users"] == 6
    assert pro["businesses"] == 3


# ── Subscription bootstrap ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_subscription_bootstraps_free(async_client: AsyncClient, auth_headers):
    """First access auto-creates a free subscription."""
    resp = await async_client.get("/api/v1/billing/subscription", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["plan"] == "free"
    assert data["status"] == "active"
    assert data["cancel_at_period_end"] is False


@pytest.mark.asyncio
async def test_get_subscription_idempotent(async_client: AsyncClient, auth_headers):
    """Calling twice returns the same subscription."""
    r1 = await async_client.get("/api/v1/billing/subscription", headers=auth_headers)
    r2 = await async_client.get("/api/v1/billing/subscription", headers=auth_headers)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]


# ── Plan change ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upgrade_to_starter(async_client: AsyncClient, auth_headers):
    # Bootstrap free first
    await async_client.get("/api/v1/billing/subscription", headers=auth_headers)

    resp = await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "starter"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["plan"] == "starter"
    assert data["billing_interval"] == "monthly"
    assert data["status"] == "active"


@pytest.mark.asyncio
async def test_change_plan_to_annual_interval(async_client: AsyncClient, auth_headers):
    await async_client.get("/api/v1/billing/subscription", headers=auth_headers)

    resp = await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "pro", "billing_interval": "annual"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["plan"] == "pro"
    assert data["billing_interval"] == "annual"


@pytest.mark.asyncio
async def test_change_to_same_plan_conflict(async_client: AsyncClient, auth_headers):
    # Bootstrap free
    await async_client.get("/api/v1/billing/subscription", headers=auth_headers)

    resp = await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "free"},
        headers=auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_change_to_invalid_plan(async_client: AsyncClient, auth_headers):
    resp = await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "enterprise"},
        headers=auth_headers,
    )
    assert resp.status_code in (400, 422)


# ── Cancel ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cancel_free_plan_rejected(async_client: AsyncClient, auth_headers):
    await async_client.get("/api/v1/billing/subscription", headers=auth_headers)
    resp = await async_client.post("/api/v1/billing/subscription/cancel", headers=auth_headers)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_cancel_paid_plan(async_client: AsyncClient, auth_headers):
    # Bootstrap and upgrade
    await async_client.get("/api/v1/billing/subscription", headers=auth_headers)
    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "pro"},
        headers=auth_headers,
    )

    resp = await async_client.post("/api/v1/billing/subscription/cancel", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["cancel_at_period_end"] is True


# ── Billing history ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_transactions_empty(async_client: AsyncClient, auth_headers):
    resp = await async_client.get("/api/v1/billing/transactions", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert data["total"] == 0
