"""Auth endpoints: OTP request/verify, token refresh, logout."""

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import get_current_user_id
from apps.api.core.exceptions import UnauthorizedError
from apps.api.core.middleware import limiter
from apps.api.core.security import blacklist_token, decode_token, is_token_blacklisted
from apps.api.core.security import verify_otp as verify_otp_code
from apps.api.modules.auth.repository import UserRepository
from apps.api.modules.auth.schemas import (
    BusinessSwitchRequest,
    EmailOTPRequest,
    EmailOTPVerify,
    GoogleAuthRequest,
    KYCStatusResponse,
    KYCSubmitRequest,
    LogoutRequest,
    OTPRequest,
    OTPRequestResponse,
    OTPVerify,
    RefreshTokenRequest,
    TokenResponse,
    UserResponse,
    UserUpdate,
)
from apps.api.modules.auth.service import AuthService
from apps.api.modules.business.repository import BusinessRepository
from apps.api.modules.business.schemas import BusinessMembershipResponse

# SMS/WhatsApp import (lazy — avoids import errors in dev without creds)
router = APIRouter()


class DeviceRegisterRequest(BaseModel):
    token: str
    platform: str


async def _check_per_phone_otp_rate(phone: str) -> None:
    """Enforce per-phone OTP rate limit (configurable via OTP_RATE_LIMIT / OTP_RATE_WINDOW_SECONDS).

    Uses a Redis counter keyed by normalized phone number with a rolling TTL.
    Raises HTTP 429 when the limit is exceeded, preventing brute-force enumeration.
    """
    from fastapi import HTTPException

    from apps.api.core.config import get_settings
    from apps.api.core.redis import get_idempotency_redis

    settings = get_settings()
    otp_limit = settings.OTP_RATE_LIMIT
    otp_window = settings.OTP_RATE_WINDOW_SECONDS

    redis = get_idempotency_redis()
    key = f"otp_rate:{phone}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, otp_window)
        if count > otp_limit:
            ttl = await redis.ttl(key)
            import structlog

            structlog.get_logger().warning("otp.rate_limit_exceeded", phone=phone)
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Too many OTP requests for this number. "
                    f"Please wait {ttl} seconds before trying again."
                ),
            )
    except HTTPException:
        raise
    except Exception:
        import structlog

        structlog.get_logger().warning("otp.rate_limit_redis_unavailable", phone=phone[-4:])


async def _dispatch_otp_sms(phone: str, otp: str) -> None:
    """Deliver the OTP SMS. Runs as a background task so the request returns
    immediately — the SMS provider (Techieszon/Hubtel/AT) can take several
    seconds, which otherwise pushes the mobile client past its request timeout."""
    from apps.api.core.config import get_settings
    from apps.api.modules.notifications.service import (
        NotificationDispatcher,
        NotificationMessage,
        sms_provider_configured,
    )

    if not sms_provider_configured(get_settings()):
        return
    await NotificationDispatcher().send(
        NotificationMessage(phone, f"Your SME Flow OTP is {otp}. It expires in 5 minutes."),
        channel="sms",
    )


@router.post("/otp/request", response_model=OTPRequestResponse, status_code=200)
@limiter.limit("5/minute")
async def request_otp(
    request: Request,  # required by slowapi
    body: OTPRequest,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> OTPRequestResponse:
    """Send a 4-digit OTP to the given Ghana phone number.

    When Hubtel OTP credentials are set, Hubtel delivers the SMS directly.
    Enforces two rate limits:
    - IP-based: 5/minute via slowapi (stops spray attacks)
    - Per-phone: 3/hour via Redis (stops targeted enumeration)
    """
    from apps.api.core.config import get_settings
    from apps.api.core.phone import normalize_ghana_phone

    normalized = normalize_ghana_phone(body.phone)
    await _check_per_phone_otp_rate(normalized)

    service = AuthService(db)
    otp = await service.request_otp(body.phone)

    import structlog

    settings = get_settings()
    # otp is None when Hubtel OTP is enabled — Hubtel delivers the SMS itself
    if otp is not None:
        # Deliver the SMS after the response is sent so the client isn't blocked
        # on the (multi-second) SMS provider round-trip.
        background.add_task(_dispatch_otp_sms, body.phone, otp)
        if settings.DEBUG_LOG_OTP and not settings.is_production:
            structlog.get_logger().info("otp.debug", otp=otp, note="DEBUG_LOG_OTP enabled")

    return OTPRequestResponse()


@router.post("/otp/verify", response_model=TokenResponse, status_code=200)
@limiter.limit("5/minute")
async def verify_otp(
    request: Request,
    body: OTPVerify,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Verify OTP and return JWT access + refresh tokens."""
    service = AuthService(db)
    return await service.verify_otp_and_login(body.phone, body.otp)


@router.post("/refresh", response_model=TokenResponse, status_code=200)
async def refresh_token(
    body: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Exchange a refresh token for a new access token."""
    from jose import JWTError

    from apps.api.core.security import create_access_token, create_refresh_token

    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise UnauthorizedError("Invalid token type")
    except JWTError as exc:
        raise UnauthorizedError("Invalid or expired refresh token") from exc

    # Reject blacklisted tokens (i.e. already logged out)
    jti = payload.get("jti", "")
    if jti and await is_token_blacklisted(jti):
        raise UnauthorizedError("Token has been revoked")

    from uuid import UUID

    user_id = UUID(payload["sub"])
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user or not user.is_active:
        raise UnauthorizedError()

    # Rotate: blacklist the old refresh token before issuing a new one
    if jti:
        from datetime import datetime, timezone

        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        await blacklist_token(jti, exp)

    service = AuthService(db)
    business_id = None
    role = "none"
    if payload.get("business_id"):
        from uuid import UUID

        requested_business_id = UUID(payload["business_id"])
        try:
            _token, role = await service.switch_business(user.id, requested_business_id)
            business_id = requested_business_id
        except Exception:
            membership = await service._get_primary_membership(user)
            business_id = membership[0] if membership else None
            role = membership[1] if membership else await service._get_agent_role(user.id)
    else:
        membership = await service._get_primary_membership(user)
        business_id = membership[0] if membership else None
        role = membership[1] if membership else await service._get_agent_role(user.id)

    return TokenResponse(
        access_token=create_access_token(user_id=user.id, business_id=business_id, role=role),
        refresh_token=create_refresh_token(user_id=user.id, business_id=business_id, role=role),
        user_id=user.id,
        business_id=business_id,
        role=role,
    )


@router.post("/switch-business", response_model=TokenResponse, status_code=200)
async def switch_business(
    body: BusinessSwitchRequest,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Issue a new access token scoped to one of the user's active businesses."""
    from apps.api.core.security import create_refresh_token

    service = AuthService(db)
    access_token, role = await service.switch_business(user_id, body.business_id)
    return TokenResponse(
        access_token=access_token,
        refresh_token=create_refresh_token(
            user_id=user_id, business_id=body.business_id, role=role
        ),
        user_id=user_id,
        business_id=body.business_id,
        role=role,
    )


@router.get("/businesses", response_model=list[BusinessMembershipResponse])
async def list_businesses(
    request: Request,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> list[BusinessMembershipResponse]:
    """Return all active businesses the authenticated user can switch into."""
    current_business_id = getattr(request.state, "business_id", None)
    repo = BusinessRepository(db)
    memberships = await repo.get_memberships_for_user(user_id)
    return [
        BusinessMembershipResponse(
            business_id=membership.business_id,
            business_name=membership.business.name if membership.business else "",
            role=membership.role,
            is_active=membership.is_active,
            subscription=membership.business.subscription if membership.business else "free",
            is_current=str(membership.business_id) == str(current_business_id),
        )
        for membership in memberships
    ]


@router.post("/logout", status_code=204)
async def logout(
    body: LogoutRequest,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Invalidate a refresh token. Access tokens expire naturally (short-lived)."""
    from uuid import UUID

    from jose import JWTError

    from apps.api.core.audit import audit

    try:
        payload = decode_token(body.refresh_token)
    except JWTError:
        return  # Already invalid — treat as successful logout

    jti = payload.get("jti")
    if jti:
        from datetime import datetime, timezone

        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        await blacklist_token(jti, exp)

    try:
        user_id = UUID(payload["sub"])
        business_id = UUID(payload["business_id"]) if payload.get("business_id") else None
        await audit(
            db, "auth.logout", "User", resource_id=user_id, user_id=user_id, business_id=business_id
        )
    except Exception:
        import structlog

        structlog.get_logger().warning("auth.logout_audit_failed")


@router.get("/me", response_model=UserResponse)
async def get_me(
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Return the currently authenticated user's profile."""
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise UnauthorizedError()
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Update authenticated user's profile (TIN, Ghana Card, name)."""
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise UnauthorizedError()
    updated = await repo.update(user, **body.model_dump(exclude_none=True))
    return UserResponse.model_validate(updated)


@router.post("/devices", status_code=201)
async def register_device(
    body: DeviceRegisterRequest,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from datetime import datetime, timezone

    from sqlalchemy import select

    from apps.api.modules.notifications.models import DeviceToken

    existing = (
        await db.execute(select(DeviceToken).where(DeviceToken.token == body.token))
    ).scalar_one_or_none()
    if existing:
        existing.user_id = user_id
        existing.platform = body.platform
        existing.is_active = True
        existing.last_seen_at = datetime.now(timezone.utc)
        token = existing
    else:
        token = DeviceToken(user_id=user_id, token=body.token, platform=body.platform)
        db.add(token)
    await db.commit()
    return {"device_token_id": str(token.id), "is_active": token.is_active}


# ── KYC ───────────────────────────────────────────────────────────────────────


@router.post("/kyc/submit", response_model=KYCStatusResponse, status_code=200)
async def submit_kyc(
    body: KYCSubmitRequest,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> KYCStatusResponse:
    """
    Submit user KYC via Ghana Card ID.
    Transitions status: unverified → pending.
    Already-pending or verified users receive 409.
    """
    from datetime import datetime, timezone

    from fastapi import HTTPException

    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise UnauthorizedError()

    if user.kyc_status in ("pending", "verified"):
        raise HTTPException(
            status_code=409,
            detail=f"KYC already {user.kyc_status}. "
            "Contact support if you need to update your documents.",
        )

    # Persist document references
    update_fields: dict = {
        "kyc_status": "pending",
        "kyc_submitted_at": datetime.now(timezone.utc),
        "ghana_card_id": body.ghana_card_id,
    }

    user = await repo.update(user, **update_fields)

    # Fire background verification task (stub — real impl calls GRA/NIA APIs)
    try:
        from apps.api.workers.dispatch import enqueue_task
        from apps.api.workers.tasks.kyc_tasks import verify_kyc_documents

        enqueue_task(verify_kyc_documents, str(user.id))
    except Exception:
        import structlog

        structlog.get_logger().warning("kyc.enqueue_failed")

    import structlog

    structlog.get_logger().info("kyc.submitted", user_id=str(user.id))

    return KYCStatusResponse(
        user_id=user.id,
        kyc_status=user.kyc_status,
        kyc_submitted_at=user.kyc_submitted_at.isoformat() if user.kyc_submitted_at else None,
        kyc_verified_at=user.kyc_verified_at.isoformat() if user.kyc_verified_at else None,
    )


@router.get("/kyc/status", response_model=KYCStatusResponse)
async def kyc_status(
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> KYCStatusResponse:
    """Return the current KYC status for the authenticated user."""
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise UnauthorizedError()
    return KYCStatusResponse(
        user_id=user.id,
        kyc_status=user.kyc_status,
        kyc_submitted_at=user.kyc_submitted_at.isoformat() if user.kyc_submitted_at else None,
        kyc_verified_at=user.kyc_verified_at.isoformat() if user.kyc_verified_at else None,
    )


# ── Account Recovery ──────────────────────────────────────────────────────────


class PhoneChangeRequest(BaseModel):
    new_phone: str
    otp: str  # OTP sent to the NEW phone to confirm ownership


class PhoneChangeInitiate(BaseModel):
    new_phone: str


@router.post("/account-recovery/initiate", status_code=200)
@limiter.limit("2/hour")
async def initiate_phone_change(
    request: Request,
    body: PhoneChangeInitiate,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Step 1 of phone-number change: send an OTP to the new phone number.

    The user must then call /account-recovery/confirm with that OTP.
    Requires an active JWT (i.e. the user can still log in with old phone).
    """
    from fastapi import HTTPException

    from apps.api.core.phone import normalize_ghana_phone
    from apps.api.modules.notifications.service import NotificationDispatcher, NotificationMessage

    normalized_new = normalize_ghana_phone(body.new_phone)
    await _check_per_phone_otp_rate(normalized_new)

    # Ensure new phone is not already taken
    existing = await UserRepository(db).get_by_phone(normalized_new)
    if existing and str(existing.id) != str(user_id):
        raise HTTPException(409, "That phone number is already registered to another account")

    service = AuthService(db)
    otp = await service.request_otp(normalized_new)

    # otp is None when Hubtel OTP is configured — Hubtel delivers the SMS itself
    if otp is not None:
        await NotificationDispatcher().send(
            NotificationMessage(
                normalized_new,
                f"Your SME Flow phone-change OTP is {otp}. Expires in 5 minutes.",
            ),
            channel="sms",
        )

    import structlog

    structlog.get_logger().info("account_recovery.otp_sent", user_id=str(user_id))
    return {"message": f"OTP sent to {normalized_new}. Use /account-recovery/confirm to complete."}


@router.post("/account-recovery/confirm", status_code=200)
async def confirm_phone_change(
    body: PhoneChangeRequest,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Step 2 of phone-number change: verify OTP and update the phone on the account.

    On success the user's phone is updated and all existing tokens remain valid.
    They should re-login with the new phone on next session.
    """
    from fastapi import HTTPException

    from apps.api.core.audit import audit
    from apps.api.core.config import get_settings
    from apps.api.core.phone import normalize_ghana_phone

    normalized_new = normalize_ghana_phone(body.new_phone)

    settings = get_settings()
    if settings.HUBTEL_OTP_ENABLED:
        from libs.hubtel_otp import HubtelOtpClient

        valid = await HubtelOtpClient().verify_otp(normalized_new, body.otp)
    else:
        valid = await verify_otp_code(normalized_new, body.otp)

    if not valid:
        raise HTTPException(400, "Invalid or expired OTP for the new phone number")

    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise UnauthorizedError()

    old_phone = user.phone
    user = await repo.update(user, phone=normalized_new)
    await audit(
        db,
        "auth.phone_changed",
        "User",
        resource_id=user_id,
        user_id=user_id,
        business_id=None,
        before={"phone": old_phone},
        after={"phone": normalized_new},
    )

    import structlog

    structlog.get_logger().info(
        "account_recovery.phone_changed", user_id=str(user_id), new_phone=normalized_new
    )
    return {"message": "Phone number updated successfully. Please log in with your new number."}


# ── Email OTP ────────────────────────────────────────────────────────────────


async def _send_email_otp(email: str, otp: str, *, purpose: str) -> None:
    from apps.api.core.config import get_settings
    from apps.api.modules.notifications.service import send_email

    settings = get_settings()
    if settings.DEBUG_LOG_OTP and not settings.is_production:
        import structlog

        structlog.get_logger().info(
            "otp.debug", otp=otp, channel="email", purpose=purpose, note="DEBUG_LOG_OTP enabled"
        )

    await send_email(
        to=email,
        subject="Your SMEflow verification code",
        html=(
            f"<p>Your SMEflow {purpose} code is <strong>{otp}</strong>. "
            "It expires in 5 minutes. If you didn't request this, you can ignore this email.</p>"
        ),
    )


@router.post("/email/link/initiate", status_code=200)
@limiter.limit("5/minute")
async def initiate_email_link(
    request: Request,
    body: EmailOTPRequest,
    background: BackgroundTasks,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Step 1 of linking an email to the logged-in account: send it an OTP."""
    from fastapi import HTTPException

    await _check_per_phone_otp_rate(body.email)

    existing = await UserRepository(db).get_by_email(body.email)
    if existing and str(existing.id) != str(user_id):
        raise HTTPException(409, "That email is already linked to another account")

    service = AuthService(db)
    otp = await service.request_email_otp(body.email)
    background.add_task(_send_email_otp, body.email, otp, purpose="email-link")
    return {"message": f"OTP sent to {body.email}. Use /email/link/confirm to complete."}


@router.post("/email/link/confirm", response_model=UserResponse, status_code=200)
async def confirm_email_link(
    body: EmailOTPVerify,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Step 2 of linking an email: verify the OTP and attach it to the account."""
    service = AuthService(db)
    user = await service.link_email(user_id, body.email, body.otp)
    return UserResponse.model_validate(user)


@router.post("/email/login/request", status_code=200)
@limiter.limit("5/minute")
async def request_email_login(
    request: Request,
    body: EmailOTPRequest,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send an OTP to log in with an already-linked email."""
    from fastapi import HTTPException

    await _check_per_phone_otp_rate(body.email)

    existing = await UserRepository(db).get_by_email(body.email)
    if existing is None:
        raise HTTPException(
            404,
            "No account is linked to this email. Sign in with your phone number "
            "first, then link this email from Settings.",
        )

    service = AuthService(db)
    otp = await service.request_email_otp(body.email)
    background.add_task(_send_email_otp, body.email, otp, purpose="login")
    return {"message": f"OTP sent to {body.email}."}


@router.post("/email/login/verify", response_model=TokenResponse, status_code=200)
@limiter.limit("5/minute")
async def verify_email_login(
    request: Request,
    body: EmailOTPVerify,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Verify an email OTP and return JWT access + refresh tokens."""
    service = AuthService(db)
    return await service.verify_email_otp_and_login(body.email, body.otp)


# ── Google Sign-In ─────────────────────────────────────────────────────────────


@router.post("/google/link", response_model=UserResponse, status_code=200)
@limiter.limit("5/minute")
async def link_google(
    request: Request,
    body: GoogleAuthRequest,
    user_id=Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Attach a Google account to the logged-in user."""
    service = AuthService(db)
    user = await service.link_google_account(user_id, body.id_token)
    return UserResponse.model_validate(user)


@router.post("/google/login", response_model=TokenResponse, status_code=200)
@limiter.limit("5/minute")
async def google_login(
    request: Request,
    body: GoogleAuthRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Verify a Google id_token and return JWT access + refresh tokens."""
    service = AuthService(db)
    return await service.verify_google_id_token_and_login(body.id_token)
