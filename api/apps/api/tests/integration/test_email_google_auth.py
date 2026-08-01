"""Integration tests for email-OTP and Google Sign-In login/linking.

Both methods must only ever attach to an *existing* phone-verified user —
neither should be able to create a brand-new account.
"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
class TestEmailLinkAndLogin:
    async def test_link_email_then_login(
        self, async_client: AsyncClient, auth_headers, seeded_business
    ):
        email = "owner@example.com"
        with (
            patch(
                "apps.api.modules.auth.router._check_per_phone_otp_rate",
                new_callable=AsyncMock,
            ),
            patch(
                "apps.api.modules.auth.service.get_otp_attempt_count",
                new_callable=AsyncMock,
                return_value=0,
            ),
            patch("apps.api.modules.auth.service.store_otp", new_callable=AsyncMock),
            patch(
                "apps.api.modules.notifications.service.send_email", new_callable=AsyncMock
            ),
        ):
            initiate = await async_client.post(
                "/api/v1/auth/email/link/initiate",
                json={"email": email},
                headers=auth_headers,
            )
        assert initiate.status_code == 200

        with (
            patch(
                "apps.api.modules.auth.service.is_otp_verify_locked",
                new_callable=AsyncMock,
                return_value=False,
            ),
            patch(
                "apps.api.modules.auth.service.verify_otp",
                new_callable=AsyncMock,
                return_value=True,
            ),
        ):
            confirm = await async_client.post(
                "/api/v1/auth/email/link/confirm",
                json={"email": email, "otp": "1234"},
                headers=auth_headers,
            )
        assert confirm.status_code == 200
        assert confirm.json()["email"] == email

        # Now log in with the linked email.
        with (
            patch(
                "apps.api.modules.auth.router._check_per_phone_otp_rate",
                new_callable=AsyncMock,
            ),
            patch(
                "apps.api.modules.auth.service.get_otp_attempt_count",
                new_callable=AsyncMock,
                return_value=0,
            ),
            patch("apps.api.modules.auth.service.store_otp", new_callable=AsyncMock),
            patch(
                "apps.api.modules.notifications.service.send_email", new_callable=AsyncMock
            ),
        ):
            login_request = await async_client.post(
                "/api/v1/auth/email/login/request", json={"email": email}
            )
        assert login_request.status_code == 200

        with (
            patch(
                "apps.api.modules.auth.service.is_otp_verify_locked",
                new_callable=AsyncMock,
                return_value=False,
            ),
            patch(
                "apps.api.modules.auth.service.verify_otp",
                new_callable=AsyncMock,
                return_value=True,
            ),
        ):
            login_verify = await async_client.post(
                "/api/v1/auth/email/login/verify", json={"email": email, "otp": "1234"}
            )
        assert login_verify.status_code == 200
        data = login_verify.json()
        assert "access_token" in data
        assert data["user_id"] == str(seeded_business["user"].id)

    async def test_login_with_unlinked_email_returns_404(self, async_client: AsyncClient):
        with (
            patch(
                "apps.api.modules.auth.router._check_per_phone_otp_rate",
                new_callable=AsyncMock,
            ),
            patch(
                "apps.api.modules.auth.service.get_otp_attempt_count",
                new_callable=AsyncMock,
                return_value=0,
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/email/login/request",
                json={"email": "nobody@nowhere.com"},
            )
        assert resp.status_code == 404

    async def test_link_email_already_linked_to_another_user_returns_409(
        self, async_client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        from apps.api.modules.auth.models import User

        other = User(phone="+233244999777", email="taken@example.com")
        db_session.add(other)
        await db_session.flush([other])

        with (
            patch(
                "apps.api.modules.auth.router._check_per_phone_otp_rate",
                new_callable=AsyncMock,
            ),
            patch(
                "apps.api.modules.auth.service.get_otp_attempt_count",
                new_callable=AsyncMock,
                return_value=0,
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/email/link/initiate",
                json={"email": "taken@example.com"},
                headers=auth_headers,
            )
        assert resp.status_code == 409


@pytest.mark.asyncio
class TestGoogleLinkAndLogin:
    async def test_link_google_then_login(
        self, async_client: AsyncClient, auth_headers, seeded_business
    ):
        claims = {
            "sub": "google-sub-123",
            "email": "owner@gmail.com",
            "email_verified": True,
            "iss": "https://accounts.google.com",
        }
        with patch(
            "libs.google_id_token.verify_google_token", return_value=claims
        ):
            link_resp = await async_client.post(
                "/api/v1/auth/google/link",
                json={"id_token": "fake-token"},
                headers=auth_headers,
            )
        assert link_resp.status_code == 200
        assert link_resp.json()["email"] == "owner@gmail.com"

        with patch(
            "libs.google_id_token.verify_google_token", return_value=claims
        ):
            login_resp = await async_client.post(
                "/api/v1/auth/google/login", json={"id_token": "fake-token"}
            )
        assert login_resp.status_code == 200
        data = login_resp.json()
        assert data["user_id"] == str(seeded_business["user"].id)

    async def test_login_with_unlinked_google_account_returns_404(
        self, async_client: AsyncClient
    ):
        claims = {
            "sub": "never-linked-sub",
            "email": "stranger@gmail.com",
            "email_verified": True,
            "iss": "https://accounts.google.com",
        }
        with patch(
            "libs.google_id_token.verify_google_token", return_value=claims
        ):
            resp = await async_client.post(
                "/api/v1/auth/google/login", json={"id_token": "fake-token"}
            )
        assert resp.status_code == 404

    async def test_link_google_already_linked_to_another_user_returns_409(
        self, async_client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        from apps.api.modules.auth.models import User

        other = User(phone="+233244999778", google_sub="already-taken-sub")
        db_session.add(other)
        await db_session.flush([other])

        claims = {
            "sub": "already-taken-sub",
            "email": "someone@gmail.com",
            "email_verified": True,
            "iss": "https://accounts.google.com",
        }
        with patch(
            "libs.google_id_token.verify_google_token", return_value=claims
        ):
            resp = await async_client.post(
                "/api/v1/auth/google/link",
                json={"id_token": "fake-token"},
                headers=auth_headers,
            )
        assert resp.status_code == 409
