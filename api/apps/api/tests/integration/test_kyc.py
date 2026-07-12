"""Integration tests for the two parallel KYC systems.

Business KYC (`/api/v1/kyc/*`, modules/kyc) and personal KYC (`/api/v1/auth/kyc/*`,
modules/auth) are intentionally separate — see KYCService docstrings and the
mobile business.api.ts / auth.api.ts call sites. Neither had endpoint-level
coverage before this file; only field-level schema validation existed
(tests/unit/test_kyc_schemas.py).
"""

from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
class TestBusinessKYC:
    """`/api/v1/kyc/*` — seeded_business (via auth_headers) always starts with a
    pre-verified KYCVerification row, so these tests exercise the
    already-verified state and the re-submission transition back to pending."""

    async def test_get_me_returns_seeded_verified_status(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.get("/api/v1/kyc/me", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "verified"
        assert data["tin"] == "C0012345678"

    async def test_poll_status_returns_verified(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.get("/api/v1/kyc/status", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "verified"
        # seeded_business sets status="verified" directly without going through
        # KYCService.review(), so reviewed_at (-> verified_at) is never populated.
        assert data["verified_at"] is None

    async def test_submit_transitions_verified_business_back_to_pending(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        """Resubmitting (e.g. updated documents) on an already-verified business
        must reset it to pending for re-review — KYCService.submit has no
        "already verified" guard, unlike the personal KYC flow."""
        resp = await async_client.post(
            "/api/v1/kyc/submit",
            json={
                "business_registration_ref": "BN-99999999",
                "tin": "98765432109",
                "documents": [
                    {
                        "document_type": "business_registration",
                        "url": "https://cdn.smeflow.app/docs/reg.jpg",
                    }
                ],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "pending"
        assert data["business_registration_ref"] == "BN-99999999"
        assert data["tin"] == "98765432109"
        assert len(data["documents"]) == 1

        status_resp = await async_client.get("/api/v1/kyc/status", headers=auth_headers)
        assert status_resp.json()["status"] == "pending"

    async def test_review_requires_platform_admin_role(
        self, async_client: AsyncClient, auth_headers: dict, seeded_business
    ):
        """The authenticated test user has JWT role 'owner' — review is
        platform_admin-only regardless of any PlatformAdmin DB row."""
        business_id = str(seeded_business["business"].id)
        resp = await async_client.post(
            f"/api/v1/kyc/review/{business_id}",
            json={"status": "verified"},
            headers=auth_headers,
        )
        assert resp.status_code == 403

    async def test_poll_status_not_submitted_for_business_with_no_kyc_row(
        self, db_session
    ):
        """A business that never went through seeded_business's auto-verify
        (i.e. genuinely never submitted KYC) must poll as not_submitted, not
        404 — this is the mobile app's expected steady-state before onboarding."""
        from apps.api.core.security import create_access_token
        from apps.api.core.database import get_db
        from apps.api.main import app
        from apps.api.modules.auth.models import User
        from apps.api.modules.business.models import Business, BusinessMember

        user = User(phone="+233244000111", name="Fresh Owner")
        db_session.add(user)
        await db_session.flush([user])
        biz = Business(owner_id=user.id, name="Brand New Shop", type="shop")
        db_session.add(biz)
        await db_session.flush([biz])
        db_session.add(BusinessMember(business_id=biz.id, user_id=user.id, role="owner"))
        await db_session.flush()

        token = create_access_token(user_id=user.id, business_id=biz.id, role="owner")
        headers = {"Authorization": f"Bearer {token}"}

        async def override_get_db():
            yield db_session

        app.dependency_overrides[get_db] = override_get_db
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.get("/api/v1/kyc/status", headers=headers)
        finally:
            app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert resp.json()["status"] == "not_submitted"


@pytest.mark.asyncio
class TestPersonalKYC:
    """`/api/v1/auth/kyc/*` — per-user Ghana Card verification, independent of
    business KYC. Fresh seeded users start "unverified" (User.kyc_status
    default), unlike business KYC which seeded_business pre-verifies."""

    async def test_status_defaults_to_unverified(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.get("/api/v1/auth/kyc/status", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["kyc_status"] == "unverified"
        assert data["kyc_submitted_at"] is None

    async def test_submit_transitions_to_pending(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.post(
            "/api/v1/auth/kyc/submit",
            json={"ghana_card_id": "GHA-123456789-0"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["kyc_status"] == "pending"
        assert data["kyc_submitted_at"] is not None

        status_resp = await async_client.get("/api/v1/auth/kyc/status", headers=auth_headers)
        assert status_resp.json()["kyc_status"] == "pending"

    async def test_resubmit_while_pending_returns_409(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        first = await async_client.post(
            "/api/v1/auth/kyc/submit",
            json={"ghana_card_id": "GHA-123456789-0"},
            headers=auth_headers,
        )
        assert first.status_code == 200

        second = await async_client.post(
            "/api/v1/auth/kyc/submit",
            json={"ghana_card_id": "GHA-987654321-1"},
            headers=auth_headers,
        )
        assert second.status_code == 409
        assert "already" in str(second.json()).lower()

    async def test_invalid_ghana_card_format_rejected(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.post(
            "/api/v1/auth/kyc/submit",
            json={"ghana_card_id": "not-a-real-card"},
            headers=auth_headers,
        )
        assert resp.status_code == 422
