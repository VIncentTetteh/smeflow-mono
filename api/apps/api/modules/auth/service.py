"""Auth service — OTP flow + JWT issuance."""

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.audit import audit
from apps.api.core.exceptions import ForbiddenError, InvalidOTPError, OTPRateLimitError
from apps.api.core.phone import normalize_ghana_phone
from apps.api.core.security import (
    create_access_token,
    create_refresh_token,
    generate_otp,
    get_otp_attempt_count,
    is_otp_verify_locked,
    store_otp,
    verify_otp,
)
from apps.api.modules.auth.models import User
from apps.api.modules.auth.repository import UserRepository
from apps.api.modules.auth.schemas import TokenResponse

logger = structlog.get_logger()

OTP_MAX_ATTEMPTS = 3


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.user_repo = UserRepository(db)

    async def request_otp(self, phone: str) -> str | None:
        """Request OTP delivery.

        When Hubtel is configured, calls Hubtel's OTP API — Hubtel sends the
        SMS automatically and this returns None (caller must not send SMS).
        Otherwise generates a 4-digit local OTP, stores it in Redis, and
        returns it for the caller to dispatch via NotificationDispatcher.
        """
        from apps.api.core.config import get_settings

        settings = get_settings()

        attempt_count = await get_otp_attempt_count(phone)
        if attempt_count >= OTP_MAX_ATTEMPTS:
            raise OTPRateLimitError()

        if settings.HUBTEL_OTP_ENABLED:
            from apps.api.core.redis import RedisCache, get_otp_redis
            from libs.hubtel_otp import HubtelOtpClient

            await HubtelOtpClient().send_otp(phone)
            # Track attempt count (same window as local OTP)
            attempt_cache = RedisCache(get_otp_redis(), prefix="otp_attempts")
            await attempt_cache.increment(phone, ttl=300)
            logger.info("otp.hubtel.requested", phone=phone[-4:])
            return None

        otp = generate_otp(length=4)
        await store_otp(phone, otp)
        logger.info("otp.generated", phone=phone[-4:])
        return otp

    async def verify_otp_and_login(self, phone: str, otp: str) -> TokenResponse:
        """Verify OTP → upsert user → return JWT tokens."""
        from apps.api.core.config import get_settings

        settings = get_settings()
        phone = normalize_ghana_phone(phone)

        # Check lockout before attempting verification (avoids timing oracle)
        if await is_otp_verify_locked(phone):
            raise OTPRateLimitError()

        if settings.HUBTEL_OTP_ENABLED:
            from libs.hubtel_otp import HubtelOtpClient

            valid = await HubtelOtpClient().verify_otp(phone, otp)
        else:
            valid = await verify_otp(phone, otp)

        if not valid:
            raise InvalidOTPError()

        # Upsert user
        user = await self.user_repo.get_by_phone(phone)
        is_new_user = user is None
        hubtel_name: str | None = None
        if user is None or not user.name:
            try:
                hubtel_name = await self._lookup_hubtel_name(phone)
            except Exception as exc:
                logger.warning(
                    "hubtel.phone_enrichment.failed",
                    phone_suffix=phone[-4:],
                    error=exc.__class__.__name__,
                )
        if not user:
            user = await self.user_repo.create(phone=phone, name=hubtel_name)
            # Fire referral conversion hook for new users (non-blocking)
            try:
                from apps.api.modules.referral.service import ReferralService

                await ReferralService(self.db).on_user_registered(user)
            except Exception as _exc:
                logger.warning("referral.conversion_hook_failed", error=str(_exc))
        elif hubtel_name and not user.name:
            user = await self.user_repo.update(user, name=hubtel_name)

        # Determine active business (first membership)
        membership = await self._get_primary_membership(user)
        business_id = membership[0] if membership else None
        role = membership[1] if membership else await self._get_agent_role(user.id)

        access_token = create_access_token(
            user_id=user.id,
            business_id=business_id,
            role=role,
        )
        refresh_token = create_refresh_token(user_id=user.id, business_id=business_id, role=role)

        await audit(
            self.db,
            "auth.login",
            "User",
            resource_id=user.id,
            user_id=user.id,
            business_id=business_id,
            after={"is_new_user": is_new_user, "role": role},
        )
        logger.info("auth.login", user_id=str(user.id), is_new_user=is_new_user)
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            user_id=user.id,
            business_id=business_id,
            role=role,
            is_new_user=is_new_user,
        )

    async def _lookup_hubtel_name(self, phone: str) -> str | None:
        """Best-effort Hubtel registered-name enrichment. Never blocks login."""
        try:
            from libs.hubtel_verification import HubtelPhoneVerifier

            result = await HubtelPhoneVerifier().lookup_name(phone)
        except Exception as exc:
            logger.warning(
                "hubtel.phone_enrichment.failed",
                phone_suffix=phone[-4:],
                error=exc.__class__.__name__,
            )
            return None
        return result.name if result else None

    async def _get_primary_business(self, user: User):  # type: ignore[return]
        """Return the user's primary (first owner) business_id, or None."""
        membership = await self._get_primary_membership(user)
        return membership[0] if membership else None

    async def _get_primary_membership(self, user: User):  # type: ignore[return]
        """Return the user's first active business membership as (business_id, role)."""
        from sqlalchemy import select

        from apps.api.modules.business.models import Business, BusinessMember

        result = await self.db.execute(
            select(BusinessMember.business_id, BusinessMember.role)
            .join(Business, Business.id == BusinessMember.business_id)
            .where(
                BusinessMember.user_id == user.id,
                BusinessMember.is_active.is_(True),
                Business.is_active.is_(True),
            )
            .order_by(BusinessMember.joined_at)
            .limit(1)
        )
        row = result.one_or_none()
        return row

    async def _get_agent_role(self, user_id) -> str:
        """Return 'agent' if the user has an active Agent record, else 'none'."""
        from sqlalchemy import select

        from apps.api.modules.agent_network.models import Agent

        agent = await self.db.scalar(
            select(Agent.id).where(Agent.user_id == user_id, Agent.is_active.is_(True)).limit(1)
        )
        return "agent" if agent else "none"

    async def switch_business(self, user_id, business_id):
        """Issue a scoped token for an active business the user belongs to."""
        from apps.api.modules.business.repository import BusinessRepository

        repo = BusinessRepository(self.db)
        member = await repo.get_member(business_id, user_id)
        if not member:
            raise ForbiddenError("You are not a member of this business")
        business = await repo.get_by_id(business_id)
        if not business:
            raise ForbiddenError("Business is inactive or unavailable")
        token = create_access_token(user_id=user_id, business_id=business_id, role=member.role)
        return token, member.role
