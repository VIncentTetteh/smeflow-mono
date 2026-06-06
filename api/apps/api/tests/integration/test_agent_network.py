"""Integration tests for Agent Network endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_headers(user_id, business_id=None) -> dict[str, str]:
    from apps.api.core.security import create_access_token

    token = create_access_token(user_id=user_id, business_id=business_id, role="owner")
    return {"Authorization": f"Bearer {token}"}


# ── Registration ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_register_agent(async_client: AsyncClient, seeded_business):
    user_id = seeded_business["user"].id
    biz_id = seeded_business["business"].id
    headers = _make_headers(user_id, biz_id)

    resp = await async_client.post(
        "/api/v1/agents/register",
        json={"region": "Greater Accra", "district": "Accra Central"},
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["region"] == "Greater Accra"
    assert data["district"] == "Accra Central"
    assert data["is_active"] is True
    assert data["onboarded_count"] == 0
    assert float(data["total_commission_earned"]) == 0.0


@pytest.mark.asyncio
async def test_register_agent_duplicate_conflict(async_client: AsyncClient, seeded_business):
    """Registering the same user twice should return 409."""
    user_id = seeded_business["user"].id
    biz_id = seeded_business["business"].id
    headers = _make_headers(user_id, biz_id)

    await async_client.post(
        "/api/v1/agents/register",
        json={"region": "Ashanti"},
        headers=headers,
    )
    resp2 = await async_client.post(
        "/api/v1/agents/register",
        json={"region": "Ashanti"},
        headers=headers,
    )
    assert resp2.status_code == 409


# ── Dashboard ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_me_not_registered(async_client: AsyncClient, db_session):
    """A user who hasn't registered returns a soft error, not 404."""
    from apps.api.modules.auth.models import User

    user = User(phone="+233244000099", name="Unregistered")
    db_session.add(user)
    await db_session.flush([user])

    headers = _make_headers(user.id)
    resp = await async_client.get("/api/v1/agents/me", headers=headers)
    assert resp.status_code == 200
    assert "error" in resp.json()


@pytest.mark.asyncio
async def test_me_after_registration(async_client: AsyncClient, seeded_business):
    user_id = seeded_business["user"].id
    biz_id = seeded_business["business"].id
    headers = _make_headers(user_id, biz_id)

    await async_client.post(
        "/api/v1/agents/register",
        json={"region": "Volta"},
        headers=headers,
    )

    resp = await async_client.get("/api/v1/agents/me", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "agent_id" in data or "onboarded_count" in data  # dashboard shape


# ── Merchant attribution ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_attribute_onboarding(async_client: AsyncClient, seeded_business, db_session):
    """Agent attributes a different business to themselves."""
    agent_user = seeded_business["user"]
    agent_biz = seeded_business["business"]
    agent_headers = _make_headers(agent_user.id, agent_biz.id)

    # Register agent
    await async_client.post(
        "/api/v1/agents/register",
        json={"region": "Northern"},
        headers=agent_headers,
    )

    # Create a second business to attribute
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business

    merchant_user = User(phone="+233244111222", name="Merchant Owner")
    db_session.add(merchant_user)
    await db_session.flush([merchant_user])

    merchant_biz = Business(owner_id=merchant_user.id, name="Merchant Shop", type="shop")
    db_session.add(merchant_biz)
    await db_session.flush([merchant_biz])

    resp = await async_client.post(
        "/api/v1/agents/attribute",
        json={"business_id": str(merchant_biz.id), "channel": "field"},
        headers=agent_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["channel"] == "field"
    assert str(data["business_id"]) == str(merchant_biz.id)
    assert data["status"] == "registered"


@pytest.mark.asyncio
async def test_attribute_without_being_agent(async_client: AsyncClient, seeded_business):
    """Non-agent trying to attribute should get 404."""

    from apps.api.core.security import create_access_token

    biz_id = seeded_business["business"].id

    # Use a fresh user that definitely hasn't registered
    import uuid

    fresh_user_id = uuid.uuid4()
    fresh_headers = {
        "Authorization": f"Bearer {create_access_token(user_id=fresh_user_id, role='owner')}"
    }

    resp = await async_client.post(
        "/api/v1/agents/attribute",
        json={"business_id": str(biz_id), "channel": "digital"},
        headers=fresh_headers,
    )
    assert resp.status_code == 404


# ── Commission trigger ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_trigger_commission_onboarding(
    async_client: AsyncClient, seeded_business, db_session
):
    agent_user = seeded_business["user"]
    agent_biz = seeded_business["business"]
    agent_headers = _make_headers(agent_user.id, agent_biz.id)

    # Register agent
    await async_client.post(
        "/api/v1/agents/register",
        json={"region": "Central"},
        headers=agent_headers,
    )

    # Create merchant biz for the commission target
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business

    m_user = User(phone="+233244333444", name="Merchant2")
    db_session.add(m_user)
    await db_session.flush([m_user])

    m_biz = Business(owner_id=m_user.id, name="Merchant2 Shop", type="shop")
    db_session.add(m_biz)
    await db_session.flush([m_biz])

    resp = await async_client.post(
        "/api/v1/agents/commissions/trigger",
        json={"business_id": str(m_biz.id), "trigger": "onboarding"},
        headers=agent_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["trigger"] == "onboarding"
    assert float(data["amount"]) == 5.0  # COMMISSION_RATES["onboarding"] == 5
    assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_trigger_unknown_commission(async_client: AsyncClient, seeded_business, db_session):
    agent_user = seeded_business["user"]
    agent_biz = seeded_business["business"]
    agent_headers = _make_headers(agent_user.id, agent_biz.id)

    await async_client.post(
        "/api/v1/agents/register",
        json={},
        headers=agent_headers,
    )

    resp = await async_client.post(
        "/api/v1/agents/commissions/trigger",
        json={"business_id": str(agent_biz.id), "trigger": "nonexistent_trigger"},
        headers=agent_headers,
    )
    assert resp.status_code == 200
    assert "Unknown trigger" in resp.json().get("message", "")


# ── Commission listing ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_commissions_empty(async_client: AsyncClient, seeded_business):
    agent_user = seeded_business["user"]
    agent_biz = seeded_business["business"]
    agent_headers = _make_headers(agent_user.id, agent_biz.id)

    await async_client.post("/api/v1/agents/register", json={}, headers=agent_headers)

    resp = await async_client.get("/api/v1/agents/commissions", headers=agent_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert "items" in data
    assert data["total"] == 0


# ── List all agents ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_all_agents(async_client: AsyncClient, seeded_business, auth_headers):
    # Register at least one agent
    user_id = seeded_business["user"].id
    biz_id = seeded_business["business"].id
    agent_headers = _make_headers(user_id, biz_id)
    await async_client.post(
        "/api/v1/agents/register", json={"region": "Eastern"}, headers=agent_headers
    )

    resp = await async_client.get("/api/v1/agents/agents", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_activation_commission_is_created_once(db_session, seeded_business):
    from sqlalchemy import func, select

    from apps.api.modules.agent_network.models import Agent, AgentCommission, OnboardingReferral
    from apps.api.modules.agent_network.service import AgentNetworkService
    from apps.api.modules.auth.models import User

    agent_user = User(phone="+233244777100", name="Agent")
    db_session.add(agent_user)
    await db_session.flush([agent_user])
    agent = Agent(user_id=agent_user.id, region="Greater Accra", is_active=True)
    db_session.add(agent)
    await db_session.flush([agent])
    business_id = seeded_business["business"].id
    referral = OnboardingReferral(agent_id=agent.id, business_id=business_id, status="registered")
    db_session.add(referral)
    await db_session.flush([referral])

    svc = AgentNetworkService(db_session)
    first = await svc.trigger_activation_commission(business_id, "first_sale")
    second = await svc.trigger_activation_commission(business_id, "first_sale")

    assert first is not None
    assert second is None
    count = (
        await db_session.execute(
            select(func.count(AgentCommission.id)).where(
                AgentCommission.agent_id == agent.id,
                AgentCommission.business_id == business_id,
                AgentCommission.trigger == "first_sale",
            )
        )
    ).scalar_one()
    assert count == 1
    assert referral.status == "first_sale"


@pytest.mark.asyncio
async def test_admin_agent_commission_report_reconciles_paid_and_pending(
    async_client: AsyncClient, seeded_business, db_session
):
    from apps.api.core.security import create_access_token
    from apps.api.modules.agent_network.models import Agent, AgentCommission
    from apps.api.modules.auth.models import User

    admin_id = seeded_business["user"].id
    admin_headers = {
        "Authorization": (
            "Bearer "
            + create_access_token(user_id=admin_id, business_id=None, role="platform_admin")
        )
    }
    agent_user = User(phone="+233244777200", name="Agent Two")
    db_session.add(agent_user)
    await db_session.flush([agent_user])
    agent = Agent(user_id=agent_user.id, region="Ashanti", is_active=True)
    db_session.add(agent)
    await db_session.flush([agent])
    business_id = seeded_business["business"].id
    db_session.add_all(
        [
            AgentCommission(
                agent_id=agent.id,
                business_id=business_id,
                trigger="first_sale",
                amount="10.00",
                status="pending",
            ),
            AgentCommission(
                agent_id=agent.id,
                business_id=business_id,
                trigger="first_loan",
                amount="30.00",
                status="paid",
            ),
        ]
    )
    await db_session.flush()

    resp = await async_client.get("/api/v1/admin/agent-commissions/report", headers=admin_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["totals"]["pending_amount"] == 10.0
    assert data["totals"]["paid_amount"] == 30.0
    assert data["by_trigger"]["first_sale"]["pending_amount"] == 10.0
    assert data["by_trigger"]["first_loan"]["paid_amount"] == 30.0


@pytest.mark.asyncio
async def test_record_sale_triggers_first_sale_commission_once(
    async_client: AsyncClient, auth_headers: dict, seeded_business, seeded_item, db_session
):
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent, AgentCommission, OnboardingReferral
    from apps.api.modules.auth.models import User

    agent_user = User(phone="+233244777300", name="Field Agent")
    db_session.add(agent_user)
    await db_session.flush([agent_user])
    agent = Agent(user_id=agent_user.id, region="Greater Accra", is_active=True)
    db_session.add(agent)
    await db_session.flush([agent])
    business_id = seeded_business["business"].id
    db_session.add(OnboardingReferral(agent_id=agent.id, business_id=business_id))
    await db_session.flush()

    sale_payload = {
        "items": [{"item_id": str(seeded_item.id), "qty": "1", "unit_price": "12.00"}],
        "payment_method": "cash",
    }
    first = await async_client.post(
        "/api/v1/sales/record",
        json={**sale_payload, "idempotency_key": str(uuid4())},
        headers=auth_headers,
    )
    second = await async_client.post(
        "/api/v1/sales/record",
        json={**sale_payload, "idempotency_key": str(uuid4())},
        headers=auth_headers,
    )

    assert first.status_code == 201
    assert second.status_code == 201
    commissions = (
        (
            await db_session.execute(
                select(AgentCommission).where(
                    AgentCommission.agent_id == agent.id,
                    AgentCommission.business_id == business_id,
                    AgentCommission.trigger == "first_sale",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(commissions) == 1


@pytest.mark.asyncio
async def test_paid_plan_webhook_triggers_subscription_commission_once(db_session, seeded_business):
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent, AgentCommission, OnboardingReferral
    from apps.api.modules.auth.models import User
    from apps.api.modules.billing.models import BillingTransaction, Subscription
    from apps.api.modules.billing.service import BillingService

    business_id = seeded_business["business"].id
    agent_user = User(phone="+233244777400", name="Subscription Agent")
    db_session.add(agent_user)
    await db_session.flush([agent_user])
    agent = Agent(user_id=agent_user.id, region="Eastern", is_active=True)
    db_session.add(agent)
    await db_session.flush([agent])
    db_session.add(OnboardingReferral(agent_id=agent.id, business_id=business_id))

    subscription = Subscription(business_id=business_id, plan="free", status="active")
    db_session.add(subscription)
    await db_session.flush([subscription])
    txn = BillingTransaction(
        subscription_id=subscription.id,
        business_id=business_id,
        amount=Decimal("49.00"),
        status="pending",
        provider_ref="sub-paid-plan-1",
        description="subscription_upgrade:starter",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(txn)
    await db_session.flush([txn])

    service = BillingService(db_session)
    assert await service.handle_webhook_success("sub-paid-plan-1") is True
    assert await service.handle_webhook_success("sub-paid-plan-1") is True

    commissions = (
        (
            await db_session.execute(
                select(AgentCommission).where(
                    AgentCommission.agent_id == agent.id,
                    AgentCommission.business_id == business_id,
                    AgentCommission.trigger == "subscription_upgrade",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(commissions) == 1
    assert subscription.plan == "starter"
