"""Integration coverage for user, business, onboarding, wallet, and KYC compliance."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient


def _headers(user_id, business_id=None, role="owner") -> dict[str, str]:
    from apps.api.core.security import create_access_token

    token = create_access_token(user_id=user_id, business_id=business_id, role=role)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_business_templates_expose_ghana_market_defaults(async_client: AsyncClient):
    resp = await async_client.get("/api/v1/business/templates")

    assert resp.status_code == 200
    data = resp.json()
    slugs = {template["slug"] for template in data["items"]}
    assert {
        "retail_shop",
        "pharmacy",
        "provision_store",
        "market_trader",
        "services",
        "wholesaler",
        "agro_inputs",
    }.issubset(slugs)

    market = next(template for template in data["items"] if template["slug"] == "market_trader")
    assert market["type"] == "market_stall"
    assert "preferred_language" in data["onboarding_fields"]
    assert "tax_vat_status" in data["onboarding_fields"]


@pytest.mark.asyncio
async def test_business_create_accepts_ghana_card_ref_and_normalizes_member_phone(
    async_client: AsyncClient, db_session
):
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import BusinessMember

    owner = User(phone="+233244111000", name="Owner")
    db_session.add(owner)
    await db_session.flush([owner])

    resp = await async_client.post(
        "/api/v1/business",
        json={
            "name": "Makola Stall",
            "type": "market_stall",
            "tin": "C0012345678",
            "ghana_card_ref": "GHA-123456789-1",
            "address": "Makola",
        },
        headers=_headers(owner.id),
    )
    assert resp.status_code == 201
    business_id = UUID(resp.json()["business"]["id"])

    invite = await async_client.post(
        "/api/v1/business/members/invite",
        json={"phone": "0244123456", "role": "staff"},
        headers=_headers(owner.id, business_id, "owner"),
    )
    assert invite.status_code == 201

    member = (
        await db_session.execute(
            BusinessMember.__table__.select().where(BusinessMember.business_id == business_id)
        )
    ).all()
    assert member

    user = (
        await db_session.execute(User.__table__.select().where(User.phone == "+233244123456"))
    ).first()
    assert user is not None


@pytest.mark.asyncio
async def test_switch_business_uses_actual_member_role(async_client: AsyncClient, db_session):
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business, BusinessMember

    user = User(phone="+233244222000", name="Staff User")
    owner = User(phone="+233244222001", name="Owner")
    db_session.add_all([user, owner])
    await db_session.flush([user, owner])

    business = Business(owner_id=owner.id, name="Role Shop", type="shop")
    db_session.add(business)
    await db_session.flush([business])
    db_session.add(BusinessMember(business_id=business.id, user_id=user.id, role="staff"))
    await db_session.flush()

    resp = await async_client.post(
        "/api/v1/auth/switch-business",
        json={"business_id": str(business.id)},
        headers=_headers(user.id),
    )
    assert resp.status_code == 200
    assert resp.json()["business_id"] == str(business.id)
    assert resp.json()["role"] == "staff"

    blocked = await async_client.post(
        "/api/v1/business/momo-accounts",
        json={"provider": "mtn", "phone": "+233244222002"},
        headers={"Authorization": f"Bearer {resp.json()['access_token']}"},
    )
    assert blocked.status_code == 403

    businesses = await async_client.get(
        "/api/v1/auth/businesses",
        headers={"Authorization": f"Bearer {resp.json()['access_token']}"},
    )
    assert businesses.status_code == 200
    assert businesses.json() == [
        {
            "business_id": str(business.id),
            "business_name": "Role Shop",
            "role": "staff",
            "is_active": True,
            "subscription": "free",
            "is_current": True,
        }
    ]


@pytest.mark.asyncio
async def test_dva_retry_requires_verified_business_kyc(async_client: AsyncClient, db_session):
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business

    owner = User(phone="+233244222010", name="Owner")
    db_session.add(owner)
    await db_session.flush([owner])

    business = Business(owner_id=owner.id, name="DVA Pending Shop", type="shop")
    db_session.add(business)
    await db_session.flush([business])

    resp = await async_client.post(
        "/api/v1/business/dva/provision",
        headers=_headers(owner.id, business.id, "owner"),
    )

    assert resp.status_code == 409
    assert "KYC must be verified" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_dva_retry_returns_existing_dedicated_account(async_client: AsyncClient, db_session):
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business
    from apps.api.modules.kyc.models import KYCVerification

    owner = User(phone="+233244222011", name="Owner")
    db_session.add(owner)
    await db_session.flush([owner])

    business = Business(
        owner_id=owner.id,
        name="DVA Ready Shop",
        type="shop",
        paystack_customer_code="CUS_ready",
        dva_account_number="1234567890",
        dva_account_name="DVA Ready Shop",
        dva_bank_name="Test Bank",
    )
    db_session.add(business)
    await db_session.flush([business])
    db_session.add(KYCVerification(business_id=business.id, user_id=owner.id, status="verified"))
    await db_session.flush()

    resp = await async_client.post(
        "/api/v1/business/dva/provision",
        headers=_headers(owner.id, business.id, "owner"),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["provisioned"] is True
    assert data["account"]["account_number"] == "1234567890"
    assert data["account"]["bank_name"] == "Test Bank"


@pytest.mark.asyncio
async def test_owner_can_update_and_deactivate_non_owner_members(
    async_client: AsyncClient, db_session
):
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business, BusinessMember

    owner = User(phone="+233244223000", name="Owner")
    staff = User(phone="+233244223001", name="Staff")
    db_session.add_all([owner, staff])
    await db_session.flush([owner, staff])

    business = Business(owner_id=owner.id, name="Member Shop", type="shop")
    db_session.add(business)
    await db_session.flush([business])
    owner_member = BusinessMember(business_id=business.id, user_id=owner.id, role="owner")
    staff_member = BusinessMember(business_id=business.id, user_id=staff.id, role="staff")
    db_session.add_all([owner_member, staff_member])
    await db_session.flush()

    promoted = await async_client.patch(
        f"/api/v1/business/members/{staff_member.id}",
        json={"role": "manager"},
        headers=_headers(owner.id, business.id, "owner"),
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "manager"

    removed = await async_client.delete(
        f"/api/v1/business/members/{staff_member.id}",
        headers=_headers(owner.id, business.id, "owner"),
    )
    assert removed.status_code == 204

    blocked = await async_client.delete(
        f"/api/v1/business/members/{owner_member.id}",
        headers=_headers(owner.id, business.id, "owner"),
    )
    assert blocked.status_code == 409


@pytest.mark.asyncio
async def test_business_membership_rejects_agent_role(async_client: AsyncClient, db_session):
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business, BusinessMember

    owner = User(phone="+233244224000", name="Owner")
    staff = User(phone="+233244224001", name="Staff")
    db_session.add_all([owner, staff])
    await db_session.flush([owner, staff])

    business = Business(owner_id=owner.id, name="No Agent Role Shop", type="shop")
    db_session.add(business)
    await db_session.flush([business])
    staff_member = BusinessMember(business_id=business.id, user_id=staff.id, role="staff")
    db_session.add(staff_member)
    await db_session.flush()

    invite = await async_client.post(
        "/api/v1/business/members/invite",
        json={"phone": "0244224002", "role": "agent"},
        headers=_headers(owner.id, business.id, "owner"),
    )
    assert invite.status_code == 422

    update = await async_client.patch(
        f"/api/v1/business/members/{staff_member.id}",
        json={"role": "agent"},
        headers=_headers(owner.id, business.id, "owner"),
    )
    assert update.status_code == 422


@pytest.mark.asyncio
async def test_wallet_lifecycle_and_paystack_disbursement(
    async_client: AsyncClient, auth_headers, monkeypatch
):
    from libs.payment_clients.base import DisbursementResponse
    from libs.payment_clients.paystack import PaystackClient

    async def fake_disburse(self, amount, phone, reference, description):
        return DisbursementResponse(external_ref="ps-disburse-1", status="pending")

    monkeypatch.setattr(PaystackClient, "disburse", fake_disburse)

    add = await async_client.post(
        "/api/v1/business/momo-accounts",
        json={"provider": "mtn", "phone": "0244555666", "is_primary": True},
        headers=auth_headers,
    )
    assert add.status_code == 201
    account_id = add.json()["id"]
    assert add.json()["phone"] == "+233244555666"
    assert add.json()["status"] == "pending"

    verified = await async_client.post(
        f"/api/v1/business/momo-accounts/{account_id}/verify",
        json={"status": "verified", "verification_ref": "manual-ok"},
        headers=auth_headers,
    )
    assert verified.status_code == 200
    assert verified.json()["is_verified"] is True

    disburse = await async_client.post(
        "/api/v1/payments/disburse",
        json={
            "amount": "12.50",
            "phone": "+233244777888",
            "idempotency_key": str(uuid4()),
        },
        headers=auth_headers,
    )
    assert disburse.status_code == 201
    assert disburse.json()["external_ref"] == "mtn-disburse-1"


@pytest.mark.asyncio
async def test_kyc_gates_lending_for_unverified_business(async_client: AsyncClient, db_session):
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business, BusinessMember

    user = User(phone="+233244333000", name="Unverified")
    db_session.add(user)
    await db_session.flush([user])
    business = Business(owner_id=user.id, name="Unverified Shop", type="shop")
    db_session.add(business)
    await db_session.flush([business])
    db_session.add(BusinessMember(business_id=business.id, user_id=user.id, role="owner"))
    await db_session.flush()

    denied = await async_client.post(
        "/api/v1/credit/request",
        json={"amount_requested": "1000.00", "term_days": 30},
        headers=_headers(user.id, business.id, "owner"),
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "KYC_VERIFICATION_REQUIRED"

    submit = await async_client.post(
        "/api/v1/kyc/submit",
        json={"business_registration_ref": "BN-12345678"},
        headers=_headers(user.id, business.id, "owner"),
    )
    assert submit.status_code == 201

    admin = await async_client.post(
        f"/api/v1/kyc/review/{business.id}",
        json={"status": "verified", "provider": "manual", "provider_ref": "ok"},
        headers=_headers(user.id, role="platform_admin"),
    )
    assert admin.status_code == 200

    allowed = await async_client.post(
        "/api/v1/credit/request",
        json={"amount_requested": "1000.00", "term_days": 30},
        headers=_headers(user.id, business.id, "owner"),
    )
    assert allowed.status_code == 201


@pytest.mark.asyncio
async def test_agent_can_onboard_trader_business_wallet_and_kyc(
    async_client: AsyncClient, auth_headers
):
    register = await async_client.post(
        "/api/v1/agents/register",
        json={"region": "Greater Accra", "district": "Accra Central"},
        headers=auth_headers,
    )
    assert register.status_code == 201

    started = await async_client.post(
        "/api/v1/agents/onboarding/start",
        json={"phone": "0244888999", "name": "Trader One"},
        headers=auth_headers,
    )
    assert started.status_code == 201
    assert started.json()["phone"] == "+233244888999"

    business = await async_client.post(
        "/api/v1/agents/onboarding/business",
        json={
            "trader_user_id": started.json()["user_id"],
            "name": "Trader One Shop",
            "type": "shop",
            "address": "Circle",
        },
        headers=auth_headers,
    )
    assert business.status_code == 201
    business_id = business.json()["business_id"]

    wallet = await async_client.post(
        f"/api/v1/agents/onboarding/business/{business_id}/wallet",
        json={"provider": "mtn", "phone": "+233244888999", "is_primary": True},
        headers=auth_headers,
    )
    assert wallet.status_code == 201

    kyc = await async_client.post(
        f"/api/v1/agents/onboarding/business/{business_id}/kyc",
        json={"business_registration_ref": "BN-12345678", "tin": "C0099999999"},
        headers=auth_headers,
    )
    assert kyc.status_code == 201

    complete = await async_client.post(
        f"/api/v1/agents/onboarding/business/{business_id}/complete",
        headers=auth_headers,
    )
    assert complete.status_code == 200
    assert complete.json()["status"] == "active"
