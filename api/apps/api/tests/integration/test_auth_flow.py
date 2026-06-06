"""Integration tests for the auth flow (OTP request → verify → JWT)."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select


@pytest.mark.asyncio
class TestOTPFlow:
    async def test_request_otp_returns_success(self, async_client: AsyncClient):
        with (
            patch(
                "apps.api.modules.auth.router._check_per_phone_otp_rate",
                new_callable=AsyncMock,
            ),
            patch("apps.api.modules.auth.service.store_otp", new_callable=AsyncMock),
            patch(
                "apps.api.modules.auth.service.get_otp_attempt_count",
                new_callable=AsyncMock,
                return_value=0,
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/otp/request",
                json={"phone": "+233244123456"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    async def test_request_otp_normalizes_local_number(self, async_client: AsyncClient):
        """0244... should be accepted and normalized to +233244..."""
        with (
            patch(
                "apps.api.modules.auth.router._check_per_phone_otp_rate",
                new_callable=AsyncMock,
            ),
            patch("apps.api.modules.auth.service.store_otp", new_callable=AsyncMock),
            patch(
                "apps.api.modules.auth.service.get_otp_attempt_count",
                new_callable=AsyncMock,
                return_value=0,
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/otp/request",
                json={"phone": "0244123456"},  # local format
            )
        assert resp.status_code == 200

    async def test_invalid_phone_returns_422(self, async_client: AsyncClient):
        resp = await async_client.post(
            "/api/v1/auth/otp/request",
            json={"phone": "not-a-phone"},
        )
        assert resp.status_code == 422

    async def test_verify_valid_otp_returns_token(self, async_client: AsyncClient):
        phone = "+233244000001"
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
            resp = await async_client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": phone, "otp": "123456"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["is_new_user"] is True

    async def test_verify_new_user_uses_hubtel_name(self, async_client: AsyncClient, db_session):
        from apps.api.modules.auth.models import User
        from apps.api.modules.auth.service import AuthService

        phone = "+233244000101"
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
            patch.object(
                AuthService,
                "_lookup_hubtel_name",
                new_callable=AsyncMock,
                return_value="Akua Manu",
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": phone, "otp": "123456"},
            )

        assert resp.status_code == 200
        user = (
            await db_session.execute(select(User).where(User.phone == phone))
        ).scalar_one_or_none()
        assert user is not None
        assert user.name == "Akua Manu"

    async def test_verify_existing_unnamed_user_gets_hubtel_name(
        self, async_client: AsyncClient, db_session
    ):
        from apps.api.modules.auth.models import User
        from apps.api.modules.auth.service import AuthService

        phone = "+233244000102"
        user = User(phone=phone)
        db_session.add(user)
        await db_session.flush([user])

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
            patch.object(
                AuthService,
                "_lookup_hubtel_name",
                new_callable=AsyncMock,
                return_value="Kofi Mensah",
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": phone, "otp": "123456"},
            )

        assert resp.status_code == 200
        assert user.name == "Kofi Mensah"

    async def test_verify_existing_named_user_is_not_overwritten(
        self, async_client: AsyncClient, db_session
    ):
        from apps.api.modules.auth.models import User
        from apps.api.modules.auth.service import AuthService

        phone = "+233244000103"
        user = User(phone=phone, name="User Chosen")
        db_session.add(user)
        await db_session.flush([user])

        lookup = AsyncMock(return_value="Hubtel Name")
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
            patch.object(AuthService, "_lookup_hubtel_name", lookup),
        ):
            resp = await async_client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": phone, "otp": "123456"},
            )

        assert resp.status_code == 200
        assert user.name == "User Chosen"
        lookup.assert_not_awaited()

    async def test_verify_allows_login_when_hubtel_has_no_name(
        self, async_client: AsyncClient, db_session
    ):
        from apps.api.modules.auth.models import User
        from apps.api.modules.auth.service import AuthService

        phone = "+233244000104"
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
            patch.object(
                AuthService,
                "_lookup_hubtel_name",
                new_callable=AsyncMock,
                return_value=None,
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": phone, "otp": "123456"},
            )

        assert resp.status_code == 200
        user = (
            await db_session.execute(select(User).where(User.phone == phone))
        ).scalar_one_or_none()
        assert user is not None
        assert user.name is None

    async def test_verify_allows_login_when_hubtel_fails(
        self, async_client: AsyncClient, db_session
    ):
        from apps.api.modules.auth.models import User
        from apps.api.modules.auth.service import AuthService

        phone = "+233244000105"
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
            patch.object(
                AuthService,
                "_lookup_hubtel_name",
                new_callable=AsyncMock,
                side_effect=RuntimeError("hubtel unavailable"),
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": phone, "otp": "123456"},
            )

        assert resp.status_code == 200
        user = (
            await db_session.execute(select(User).where(User.phone == phone))
        ).scalar_one_or_none()
        assert user is not None
        assert user.name is None

    async def test_verify_wrong_otp_returns_400(self, async_client: AsyncClient):
        with (
            patch(
                "apps.api.modules.auth.service.is_otp_verify_locked",
                new_callable=AsyncMock,
                return_value=False,
            ),
            patch(
                "apps.api.modules.auth.service.verify_otp",
                new_callable=AsyncMock,
                return_value=False,
            ),
        ):
            resp = await async_client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": "+233244000002", "otp": "000000"},
            )
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_OTP"
