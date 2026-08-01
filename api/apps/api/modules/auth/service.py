"""Auth service — OTP flow + JWT issuance."""

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.audit import audit
from apps.api.core.exceptions import (
    ConflictError,
    ForbiddenError,
    InvalidOTPError,
    OTPRateLimitError,
    SMEFlowError,
    UnauthorizedError,
)
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

        otp = generate_otp(length=settings.OTP_LENGTH)
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

        return await self._issue_tokens(user, is_new_user)

    async def _issue_tokens(self, user: User, is_new_user: bool) -> TokenResponse:
        """Shared tail for every login path: determine business, mint JWTs, audit-log.

        Used by the phone-OTP flow above and by the email-OTP / Google
        Sign-In flows so all login methods issue tokens identically.
        """
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

    # ── Email OTP ─────────────────────────────────────────────────────────────

    async def request_email_otp(self, email: str) -> str:
        """Request an email OTP. Always locally generated — there is no
        Hubtel-equivalent hosted OTP API for email."""
        from apps.api.core.config import get_settings

        email = email.strip().lower()
        attempt_count = await get_otp_attempt_count(email)
        if attempt_count >= OTP_MAX_ATTEMPTS:
            raise OTPRateLimitError()
        otp = generate_otp(length=get_settings().OTP_LENGTH)
        await store_otp(email, otp)
        logger.info("otp.email.generated")
        return otp

    async def verify_email_otp_and_login(self, email: str, otp: str) -> TokenResponse:
        """Verify an email OTP and log in. Never creates a new user — the
        email must already be linked to a phone-verified account."""
        email = email.strip().lower()
        if await is_otp_verify_locked(email):
            raise OTPRateLimitError()
        if not await verify_otp(email, otp):
            raise InvalidOTPError()
        user = await self.user_repo.get_by_email(email)
        if user is None:
            raise SMEFlowError(
                "No account is linked to this email. Sign in with your phone number "
                "first, then link this email from Settings.",
                code="ACCOUNT_NOT_LINKED",
                status_code=404,
            )
        return await self._issue_tokens(user, is_new_user=False)

    async def link_email(self, user_id, email: str, otp: str) -> User:
        """Verify OTP ownership of `email`, then attach it to an already-authenticated user."""
        email = email.strip().lower()
        if await is_otp_verify_locked(email):
            raise OTPRateLimitError()
        if not await verify_otp(email, otp):
            raise InvalidOTPError()
        existing = await self.user_repo.get_by_email(email)
        if existing is not None and str(existing.id) != str(user_id):
            raise ConflictError("This email is already linked to another account.")
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise UnauthorizedError()
        return await self.user_repo.update(user, email=email)

    # ── Google Sign-In ────────────────────────────────────────────────────────

    async def verify_google_id_token_and_login(self, id_token: str) -> TokenResponse:
        """Verify a Google id_token and log in. Never creates a new user — the
        Google account must already be linked to a phone-verified account."""
        from libs.google_id_token import InvalidGoogleTokenError, verify_google_token

        try:
            claims = verify_google_token(id_token)
        except InvalidGoogleTokenError as exc:
            raise UnauthorizedError(str(exc)) from exc

        user = await self.user_repo.get_by_google_sub(claims["sub"])
        if user is None:
            raise SMEFlowError(
                "This Google account isn't linked yet. Sign in with your phone number "
                "first, then link Google from Settings.",
                code="ACCOUNT_NOT_LINKED",
                status_code=404,
            )
        return await self._issue_tokens(user, is_new_user=False)

    async def link_google_account(self, user_id, id_token: str) -> User:
        """Verify a Google id_token, then attach its `sub` to an already-authenticated user."""
        from libs.google_id_token import InvalidGoogleTokenError, verify_google_token

        try:
            claims = verify_google_token(id_token)
        except InvalidGoogleTokenError as exc:
            raise UnauthorizedError(str(exc)) from exc

        existing = await self.user_repo.get_by_google_sub(claims["sub"])
        if existing is not None and str(existing.id) != str(user_id):
            raise ConflictError("This Google account is already linked to another account.")
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise UnauthorizedError()
        update_fields: dict = {"google_sub": claims["sub"]}
        if not user.email and claims.get("email"):
            update_fields["email"] = claims["email"].strip().lower()
        return await self.user_repo.update(user, **update_fields)

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
