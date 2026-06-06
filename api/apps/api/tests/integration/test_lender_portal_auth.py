"""Integration tests for lender portal password login."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


def _admin_headers(user_id) -> dict[str, str]:
    from apps.api.core.security import create_access_token

    token = create_access_token(user_id=user_id, business_id=None, role="platform_admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_admin_created_lender_must_reset_password_before_portal_access(
    async_client: AsyncClient, seeded_business
) -> None:
    headers = _admin_headers(seeded_business["user"].id)

    created = await async_client.post(
        "/api/v1/admin/lenders",
        json={
            "lender_id": "ghanafin",
            "name": "GhanaFin",
            "contact_email": "ops@ghanafin.test",
        },
        headers=headers,
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["api_key"].startswith("lf_")
    assert payload["temporary_password"]
    assert payload["portal_email"] == "ops@ghanafin.test"

    first_login = await async_client.post(
        "/api/v1/lender/auth/login",
        json={"email": "ops@ghanafin.test", "password": payload["temporary_password"]},
    )

    assert first_login.status_code == 200
    first_login_payload = first_login.json()
    assert first_login_payload["must_reset_password"] is True
    assert first_login_payload["reset_token"]
    assert first_login_payload["access_token"] is None

    reset = await async_client.post(
        "/api/v1/lender/auth/reset-password",
        json={"reset_token": first_login_payload["reset_token"], "new_password": "NewPass123!"},
    )

    assert reset.status_code == 200
    reset_payload = reset.json()
    assert reset_payload["access_token"]
    assert reset_payload["must_reset_password"] is False

    lender_headers = {"Authorization": f"Bearer {reset_payload['access_token']}"}
    profile = await async_client.get("/api/v1/lender/me", headers=lender_headers)
    assert profile.status_code == 200
    assert profile.json()["lender_id"] == "ghanafin"

    reused_reset_token = await async_client.post(
        "/api/v1/lender/auth/reset-password",
        json={"reset_token": first_login_payload["reset_token"], "new_password": "AnotherPass123!"},
    )
    assert reused_reset_token.status_code == 401

    old_password = await async_client.post(
        "/api/v1/lender/auth/login",
        json={"email": "ops@ghanafin.test", "password": payload["temporary_password"]},
    )
    assert old_password.status_code == 401

    second_login = await async_client.post(
        "/api/v1/lender/auth/login",
        json={"email": "ops@ghanafin.test", "password": "NewPass123!"},
    )
    assert second_login.status_code == 200
    assert second_login.json()["access_token"]
    assert second_login.json()["must_reset_password"] is False


@pytest.mark.asyncio
async def test_lender_analytics_exposes_operational_readiness_counts(
    async_client: AsyncClient, seeded_business
) -> None:
    headers = _admin_headers(seeded_business["user"].id)

    created = await async_client.post(
        "/api/v1/admin/lenders",
        json={
            "lender_id": "opsfin",
            "name": "OpsFin",
            "contact_email": "ops@opsfin.test",
        },
        headers=headers,
    )
    assert created.status_code == 201
    payload = created.json()

    first_login = await async_client.post(
        "/api/v1/lender/auth/login",
        json={"email": "ops@opsfin.test", "password": payload["temporary_password"]},
    )
    reset = await async_client.post(
        "/api/v1/lender/auth/reset-password",
        json={"reset_token": first_login.json()["reset_token"], "new_password": "NewPass123!"},
    )
    lender_headers = {"Authorization": f"Bearer {reset.json()['access_token']}"}

    analytics = await async_client.get("/api/v1/lender/analytics", headers=lender_headers)

    assert analytics.status_code == 200
    body = analytics.json()
    assert body["pending_loan_requests"] == 0
    assert body["consented_businesses"] == 0
    assert body["active_products"] == 0
    assert body["total_products"] == 0
    assert body["api_ready"] is True
    assert body["webhook_configured"] is False
    assert body["review_queue"] == []


@pytest.mark.asyncio
async def test_inactive_lender_cannot_use_portal_login_or_api_key(
    async_client: AsyncClient, db_session, seeded_business
) -> None:
    from apps.api.modules.lender.models import LenderPartner

    headers = _admin_headers(seeded_business["user"].id)
    created = await async_client.post(
        "/api/v1/admin/lenders",
        json={
            "lender_id": "inactivefin",
            "name": "Inactive Fin",
            "contact_email": "ops@inactive.test",
        },
        headers=headers,
    )
    assert created.status_code == 201
    payload = created.json()

    from sqlalchemy import select

    partner = (
        await db_session.execute(
            select(LenderPartner).where(LenderPartner.lender_id == payload["lender_id"])
        )
    ).scalar_one()
    partner.is_active = False
    await db_session.flush([partner])

    portal_login = await async_client.post(
        "/api/v1/lender/auth/login",
        json={"email": "ops@inactive.test", "password": payload["temporary_password"]},
    )
    assert portal_login.status_code == 401

    api_key_login = await async_client.post(
        "/api/v1/lender/auth/token",
        json={"lender_id": "inactivefin", "api_key": payload["api_key"]},
    )
    assert api_key_login.status_code == 401
