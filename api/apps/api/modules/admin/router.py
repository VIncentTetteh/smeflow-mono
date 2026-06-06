"""
Admin router — platform-level endpoints, IP-gated and role-gated.

Authentication flow
──────────────────
1. POST /admin/auth/login   — email + password → short-lived admin JWT
2. All other /admin routes  — require that JWT AND match the DB-stored
   allowed_ips list for the admin account.

IP allowlist enforcement
────────────────────────
* The allowed_ips field on PlatformAdmin stores a JSON list of IPv4/IPv6
  addresses or CIDR ranges.
* The ADMIN_ALLOWED_IPS env-var provides a comma-separated global allowlist
  applied to every admin (union with per-admin list).
* If both lists are empty the allowlist is considered unconfigured and ALL
  access is denied. Populate at least ADMIN_ALLOWED_IPS in every environment.
* Operate defence-in-depth: enforce the same CIDR at the load-balancer/VPN
  level; this app-layer check is the last line of defence.
"""

from __future__ import annotations

import ipaddress
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.modules.admin.models import PendingAdminAction, SuspensionAppeal
from apps.api.modules.admin.models import PlatformAdmin as PlatformAdminModel
from apps.api.modules.admin.service import AdminService

logger = structlog.get_logger()
router = APIRouter()


# ── IP allowlist helper ───────────────────────────────────────────────────────


def _ip_in_allowlist(client_ip: str, allowed: list[str]) -> bool:
    """Return True if client_ip matches any entry in the allowlist."""
    if not allowed:
        return True  # empty list = no restriction
    try:
        addr = ipaddress.ip_address(client_ip)
        for entry in allowed:
            entry = entry.strip()
            if not entry:
                continue
            try:
                if addr in ipaddress.ip_network(entry, strict=False):
                    return True
            except ValueError:
                if client_ip == entry:
                    return True
    except ValueError:
        pass
    return False


def _get_client_ip(request: Request) -> str:
    """Extract real client IP from X-Forwarded-For or direct connection."""
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


def _fingerprint(request: Request) -> str:
    from apps.api.core.security import admin_fingerprint

    return admin_fingerprint(_get_client_ip(request), request.headers.get("User-Agent", ""))


# ── Platform-admin auth guard ─────────────────────────────────────────────────


async def _require_platform_admin(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> UUID:
    """
    1. Validate Bearer token (role == 'platform_admin').
    2. Load the PlatformAdmin row from DB (ensures the account still exists and
       is active — not just a valid JWT).
    3. Check client IP against the union of ADMIN_ALLOWED_IPS env-var and the
       per-admin allowed_ips list.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")

    try:
        from apps.api.core.security import decode_token

        payload = decode_token(auth[7:])
    except Exception as exc:
        raise HTTPException(401, "Invalid token") from exc

    if payload.get("role") != "platform_admin":
        raise HTTPException(403, "Platform admin role required")
    if payload.get("fph") and payload["fph"] != _fingerprint(request):
        raise HTTPException(401, "Admin session fingerprint changed")

    admin_id = UUID(payload["sub"])

    # ── DB existence + active check ───────────────────────────────────────────
    result = await db.execute(
        select(PlatformAdminModel).where(
            PlatformAdminModel.id == admin_id,
            PlatformAdminModel.is_active.is_(True),
        )
    )
    admin = result.scalar_one_or_none()
    if not admin:
        raise HTTPException(401, "Admin account not found or deactivated")

    # ── IP allowlist ──────────────────────────────────────────────────────────
    from apps.api.core.config import get_settings

    settings = get_settings()

    global_ips = [ip.strip() for ip in settings.ADMIN_ALLOWED_IPS.split(",") if ip.strip()]
    per_admin_ips: list[str] = admin.allowed_ips or []
    combined = list(set(global_ips + per_admin_ips))

    # Fail closed: if no IPs are configured the allowlist is unconfigured — deny all access.
    # Populate ADMIN_ALLOWED_IPS (or per-admin allowed_ips) in every environment.
    if not combined:
        logger.warning(
            "admin.ip_allowlist_unconfigured",
            admin_id=str(admin_id),
        )
        raise HTTPException(403, "Admin IP allowlist is not configured")

    client_ip = _get_client_ip(request)
    if not _ip_in_allowlist(client_ip, combined):
        logger.warning(
            "admin.ip_blocked",
            admin_id=str(admin_id),
            client_ip=client_ip,
        )
        raise HTTPException(403, "Access denied from this IP address")

    return admin_id


async def _require_admin_totp(
    admin_id: UUID,
    db: AsyncSession,
    code: str | None,
) -> None:
    admin = (
        await db.execute(select(PlatformAdminModel).where(PlatformAdminModel.id == admin_id))
    ).scalar_one_or_none()
    if not admin:
        raise HTTPException(401, "Admin account not found")
    if not admin.totp_enabled:
        return
    from apps.api.core.security import verify_totp

    if not code or not admin.totp_secret or not verify_totp(admin.totp_secret, code):
        raise HTTPException(403, "Valid X-Admin-TOTP code required")


PlatformAdmin = Annotated[UUID, Depends(_require_platform_admin)]


# ── Admin login endpoint ──────────────────────────────────────────────────────


class AdminLoginRequest(BaseModel):
    email: str
    password: str
    totp_code: str | None = None


class AdminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    totp_enabled: bool = False


class AdminCreateRequest(BaseModel):
    email: str
    password: str = Field(min_length=12, max_length=256)
    allowed_ips: list[str] = Field(default_factory=list)


class AdminLoanActionRequest(BaseModel):
    action: Literal["approve", "reject", "flag"]
    reason: str | None = Field(None, max_length=500)


def _issue_admin_token(admin: PlatformAdminModel, request: Request) -> str:
    from jose import jwt as jose_jwt

    from apps.api.core.config import get_settings

    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(hours=1)
    payload = {
        "sub": str(admin.id),
        "email": admin.email,
        "role": "platform_admin",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
        "fph": _fingerprint(request),
    }
    return jose_jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


@router.post("/auth/login", response_model=AdminTokenResponse)
async def admin_login(
    request: Request,
    body: AdminLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> AdminTokenResponse:
    """
    Authenticate a platform admin by email + password.

    Returns a short-lived JWT (role=platform_admin, TTL=1 hour).
    The caller must present this token in the Authorization header for all
    subsequent /admin requests.

    IP check is applied here too so brute-force attempts from unknown IPs
    are rejected before any password comparison occurs.
    """
    result = await db.execute(
        select(PlatformAdminModel).where(
            PlatformAdminModel.email == body.email.lower().strip(),
            PlatformAdminModel.is_active.is_(True),
        )
    )
    admin = result.scalar_one_or_none()

    # Constant-time path: always run verify_password even when admin not found
    from apps.api.core.security import verify_password

    dummy_hash = "$2b$12$dummyhashfortimingconstancy000000000000000000000000000"
    stored = admin.hashed_password if admin else dummy_hash
    password_ok = verify_password(body.password, stored)

    if not admin or not password_ok:
        logger.warning("admin.login.failed", email=body.email)
        raise HTTPException(401, "Invalid credentials")

    # ── IP allowlist pre-check ────────────────────────────────────────────────
    from apps.api.core.config import get_settings

    settings = get_settings()
    global_ips = [ip.strip() for ip in settings.ADMIN_ALLOWED_IPS.split(",") if ip.strip()]
    per_admin_ips: list[str] = admin.allowed_ips or []
    combined = list(set(global_ips + per_admin_ips))

    # Fail closed: unconfigured allowlist denies all login attempts.
    if not combined:
        logger.warning("admin.login.ip_allowlist_unconfigured", email=body.email)
        raise HTTPException(403, "Admin IP allowlist is not configured")

    client_ip = _get_client_ip(request)
    if not _ip_in_allowlist(client_ip, combined):
        logger.warning("admin.login.ip_blocked", email=body.email, client_ip=client_ip)
        raise HTTPException(403, "Access denied from this IP address")

    # ── TOTP check (only when MFA is enrolled) ────────────────────────────────
    if admin.totp_enabled:
        if not body.totp_code:
            raise HTTPException(428, detail="MFA required")
        from apps.api.core.security import verify_totp

        if not admin.totp_secret or not verify_totp(admin.totp_secret, body.totp_code):
            logger.warning("admin.login.mfa_failed", admin_id=str(admin.id))
            raise HTTPException(401, "Invalid MFA code")

    # Update last_login_at
    admin.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    logger.info("admin.login.success", admin_id=str(admin.id))
    return AdminTokenResponse(
        access_token=_issue_admin_token(admin, request),
        expires_in=3600,
        totp_enabled=admin.totp_enabled,
    )


@router.post("/auth/refresh", response_model=AdminTokenResponse)
async def refresh_admin_token(
    request: Request,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> AdminTokenResponse:
    """Refresh a still-valid admin access token and preserve fingerprint binding."""
    admin = (
        await db.execute(select(PlatformAdminModel).where(PlatformAdminModel.id == actor_id))
    ).scalar_one()
    return AdminTokenResponse(
        access_token=_issue_admin_token(admin, request),
        expires_in=3600,
        totp_enabled=admin.totp_enabled,
    )


# ── Schemas ───────────────────────────────────────────────────────────────────


class BusinessSummary(BaseModel):
    id: UUID
    name: str
    type: str
    subscription: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CreditOverrideRequest(BaseModel):
    business_id: UUID
    score: float
    band: str
    max_loan_amount: float


class LenderCreateRequest(BaseModel):
    lender_id: str
    name: str
    contact_email: str | None = None
    portal_email: str | None = None


class LenderUpdateRequest(BaseModel):
    name: str | None = None
    contact_email: str | None = None
    is_active: bool | None = None
    rotate_key: bool = False


class AgentApplicationDecision(BaseModel):
    reason: str | None = None


class TotpEnrollResponse(BaseModel):
    secret: str
    otpauth_uri: str


class AppealCreateRequest(BaseModel):
    reason: str
    evidence_url: str | None = None


class AppealDecisionRequest(BaseModel):
    reason: str | None = Field(None, max_length=500)


# ── Platform metrics ──────────────────────────────────────────────────────────


@router.get("/metrics")
async def platform_metrics(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """High-level KPI dashboard for the platform."""
    svc = AdminService(db)
    return await svc.platform_metrics()


@router.get("/provider-readiness")
async def provider_readiness_report(actor_id: PlatformAdmin) -> dict:
    """Configuration readiness summary for paid-pilot provider smoke tests."""
    from apps.api.core.config import get_settings
    from apps.api.core.provider_readiness import provider_readiness

    return provider_readiness(get_settings())


@router.post("/auth/totp/enroll", response_model=TotpEnrollResponse)
async def enroll_totp(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> TotpEnrollResponse:
    from urllib.parse import quote

    from apps.api.core.config import get_settings
    from apps.api.core.security import generate_totp_secret

    admin = (
        await db.execute(select(PlatformAdminModel).where(PlatformAdminModel.id == actor_id))
    ).scalar_one()
    secret = generate_totp_secret()
    admin.totp_secret = secret
    # Do NOT set totp_enabled=True here — wait for the admin to confirm with a valid code
    await db.commit()
    issuer = get_settings().ADMIN_TOTP_ISSUER
    label = quote(f"{issuer}:{admin.email}")
    uri = f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}"
    return TotpEnrollResponse(secret=secret, otpauth_uri=uri)


class TotpConfirmRequest(BaseModel):
    code: str


def _public_pending_payload(action: PendingAdminAction) -> dict:
    payload = dict(action.payload or {})
    if action.action_type == "admin_create":
        payload.pop("hashed_password", None)
    return payload


@router.post("/auth/totp/confirm")
async def confirm_totp(
    actor_id: PlatformAdmin,
    body: TotpConfirmRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Verify a TOTP code against the pending secret and enable MFA for this admin."""
    admin = (
        await db.execute(select(PlatformAdminModel).where(PlatformAdminModel.id == actor_id))
    ).scalar_one()
    if not admin.totp_secret:
        raise HTTPException(400, "Call /auth/totp/enroll first")
    from apps.api.core.security import verify_totp

    if not verify_totp(admin.totp_secret, body.code):
        raise HTTPException(400, "Invalid code — check your authenticator app and try again")
    admin.totp_enabled = True
    await db.commit()
    logger.info("admin.totp.enabled", admin_id=str(admin.id))
    return {"ok": True}


# ── Platform admin account management ────────────────────────────────────────


@router.get("/admins")
async def list_platform_admins(
    actor_id: PlatformAdmin,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List active platform admin accounts."""
    total = (
        await db.execute(
            select(func.count(PlatformAdminModel.id)).where(
                PlatformAdminModel.is_active.is_(True)
            )
        )
    ).scalar_one()
    rows = (
        (
            await db.execute(
                select(PlatformAdminModel)
                .where(PlatformAdminModel.is_active.is_(True))
                .order_by(PlatformAdminModel.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(admin.id),
                "email": admin.email,
                "totp_enabled": admin.totp_enabled,
                "last_login_at": admin.last_login_at.isoformat() if admin.last_login_at else None,
                "created_at": admin.created_at.isoformat(),
            }
            for admin in rows
        ],
    }


@router.post("/admins", status_code=202)
async def create_platform_admin(
    body: AdminCreateRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Request two-person approval to create a platform admin account."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    email = body.email.lower().strip()
    existing = (
        await db.execute(select(PlatformAdminModel).where(PlatformAdminModel.email == email))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Platform admin already exists")
    from apps.api.core.security import hash_password

    action = await AdminService(db).request_pending_action(
        "admin_create",
        {
            "email": email,
            "hashed_password": hash_password(body.password),
            "allowed_ips": body.allowed_ips,
        },
        actor_id,
    )
    await db.commit()
    return {"pending_action_id": str(action.id), "status": action.status, "email": email}


@router.post("/admins/{admin_id}/deactivate", status_code=202)
async def deactivate_platform_admin(
    admin_id: UUID,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Request two-person approval to deactivate a platform admin account."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    if admin_id == actor_id:
        raise HTTPException(409, "Admins cannot deactivate their own account")
    admin = (
        await db.execute(
            select(PlatformAdminModel).where(
                PlatformAdminModel.id == admin_id,
                PlatformAdminModel.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not admin:
        raise HTTPException(404, "Platform admin not found")
    action = await AdminService(db).request_pending_action(
        "admin_deactivate",
        {"admin_id": str(admin_id), "email": admin.email},
        actor_id,
    )
    await db.commit()
    return {"pending_action_id": str(action.id), "status": action.status, "admin_id": str(admin_id)}


# ── Business management ───────────────────────────────────────────────────────


@router.get("/businesses")
async def list_businesses(
    actor_id: PlatformAdmin,
    search: str | None = Query(None),
    is_active: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Paginated cross-tenant business list."""
    svc = AdminService(db)
    businesses, total = await svc.list_businesses(limit, offset, search, is_active)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [BusinessSummary.model_validate(b).model_dump() for b in businesses],
    }


@router.get("/businesses/{business_id}")
async def get_business_detail(
    business_id: UUID,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Full cross-tenant business detail for internal admin review."""
    return await AdminService(db).business_detail(business_id)


@router.post("/businesses/{business_id}/suspend")
async def suspend_business(
    business_id: UUID,
    request: Request,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Suspend a business (blocks login for its members)."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    svc = AdminService(db)
    biz = await svc.suspend_business(business_id, actor_id)
    await db.commit()
    return {"business_id": str(biz.id), "is_active": biz.is_active}


@router.post("/businesses/{business_id}/unsuspend")
async def unsuspend_business(
    business_id: UUID,
    request: Request,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Re-activate a suspended business."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    svc = AdminService(db)
    biz = await svc.unsuspend_business(business_id, actor_id)
    await db.commit()
    return {"business_id": str(biz.id), "is_active": biz.is_active}


# ── Credit score override ─────────────────────────────────────────────────────


@router.post("/credit/override")
async def override_credit(
    body: CreditOverrideRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Manually set a credit score for a business (fraud remediation / manual review)."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    payload = body.model_dump(mode="json")
    action = await AdminService(db).request_pending_action(
        "credit_override",
        payload,
        actor_id,
    )
    await db.commit()
    return {
        "pending_action_id": str(action.id),
        "status": action.status,
        "business_id": payload.get("business_id"),
        "score": payload.get("score"),
        "band": payload.get("band"),
        "max_loan_amount": payload.get("max_loan_amount"),
    }


@router.post("/credit/manual-review")
async def manual_credit_review(
    body: CreditOverrideRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Phase 3 alias for manual credit decision override review."""
    return await override_credit(body, actor_id, x_admin_totp, db)


@router.post("/pending-actions/{action_id}/approve")
async def approve_pending_action(
    action_id: UUID,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _require_admin_totp(actor_id, db, x_admin_totp)
    result = await AdminService(db).approve_pending_action(action_id, actor_id)
    await db.commit()
    return result


@router.get("/pending-actions")
async def list_pending_actions(
    actor_id: PlatformAdmin,
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List high-impact admin actions awaiting two-person approval."""
    query = select(PendingAdminAction).order_by(PendingAdminAction.created_at.desc())
    count_q = select(func.count(PendingAdminAction.id))
    if status:
        query = query.where(PendingAdminAction.status == status)
        count_q = count_q.where(PendingAdminAction.status == status)

    total = (await db.execute(count_q)).scalar_one()
    rows = (await db.execute(query.limit(limit).offset(offset))).scalars().all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(row.id),
                "action_type": row.action_type,
                "payload": _public_pending_payload(row),
                "requested_by": str(row.requested_by),
                "approved_by": str(row.approved_by) if row.approved_by else None,
                "status": row.status,
                "created_at": row.created_at.isoformat(),
                "expires_at": row.expires_at.isoformat(),
                "approved_at": row.approved_at.isoformat() if row.approved_at else None,
            }
            for row in rows
        ],
    }


# ── Lender Management (Admin) ─────────────────────────────────────────────────


@router.get("/lenders")
async def admin_list_lenders(
    actor_id: PlatformAdmin,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List all lender partners."""
    from apps.api.modules.lender.service import LenderService

    lenders, total = await LenderService(db).list_all_lenders(limit=limit, offset=offset)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(lp.id),
                "lender_id": lp.lender_id,
                "name": lp.name,
                "contact_email": lp.contact_email,
                "is_active": lp.is_active,
                "paystack_subaccount_code": lp.paystack_subaccount_code,
                "paystack_split_code": lp.paystack_split_code,
                "platform_fee_percent": lp.platform_fee_percent,
                "settlement_ready": bool(lp.paystack_subaccount_code and lp.paystack_split_code),
                "created_at": lp.created_at.isoformat(),
            }
            for lp in lenders
        ],
    }


@router.post("/lenders", status_code=201)
async def create_lender_partner(
    body: LenderCreateRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _require_admin_totp(actor_id, db, x_admin_totp)
    from apps.api.modules.lender.service import LenderService

    portal_email = body.portal_email or body.contact_email
    if not portal_email:
        raise HTTPException(400, "contact_email or portal_email is required")
    partner, api_key, temporary_password = await LenderService(db).create_partner(
        body.lender_id,
        body.name,
        body.contact_email,
        portal_email,
    )
    await db.commit()
    return {
        "id": str(partner.id),
        "lender_id": partner.lender_id,
        "name": partner.name,
        "contact_email": partner.contact_email,
        "portal_email": partner.portal_email,
        "api_key": api_key,
        "temporary_password": temporary_password,
    }


@router.patch("/lenders/{lender_id}")
async def update_lender_partner(
    lender_id: str,
    body: LenderUpdateRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _require_admin_totp(actor_id, db, x_admin_totp)
    if body.is_active is False:
        action = await AdminService(db).request_pending_action(
            "lender_deactivate",
            {"lender_id": lender_id},
            actor_id,
        )
        await db.commit()
        return {"pending_action_id": str(action.id), "status": action.status}
    from apps.api.modules.lender.service import LenderService

    partner, api_key = await LenderService(db).update_partner(
        lender_id,
        name=body.name,
        contact_email=body.contact_email,
        is_active=body.is_active,
        rotate_key=body.rotate_key,
    )
    await db.commit()
    result = {
        "id": str(partner.id),
        "lender_id": partner.lender_id,
        "name": partner.name,
        "contact_email": partner.contact_email,
        "is_active": partner.is_active,
    }
    if api_key:
        result["api_key"] = api_key
    return result


# ── Agent Management (Admin) ──────────────────────────────────────────────────


class AdminAgentCreate(BaseModel):
    phone: str
    name: str | None = None
    region: str | None = None
    district: str | None = None


class AdminAgentUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    region: str | None = None
    district: str | None = None
    is_active: bool | None = None


@router.get("/agents")
async def admin_list_agents(
    actor_id: PlatformAdmin,
    region: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List all field agents (admin view)."""
    from apps.api.modules.agent_network.service import AgentNetworkService
    from apps.api.modules.auth.models import User

    agents, total = await AgentNetworkService(db).list_agents(
        region=region, search=search, limit=limit, offset=offset
    )
    user_ids = [a.user_id for a in agents]
    users_by_id = {}
    if user_ids:
        user_rows = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        users_by_id = {u.id: u for u in user_rows}
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(a.id),
                "user_id": str(a.user_id),
                "name": users_by_id[a.user_id].name if a.user_id in users_by_id else None,
                "phone": users_by_id[a.user_id].phone if a.user_id in users_by_id else None,
                "region": a.region,
                "district": a.district,
                "is_active": a.is_active,
                "onboarded_count": a.onboarded_count,
                "total_commission_earned": str(a.total_commission_earned),
                "created_at": a.created_at.isoformat(),
            }
            for a in agents
        ],
    }


@router.get("/agents/health")
async def agent_network_health(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Real-time agent network health summary for the admin dashboard."""
    from datetime import date

    from apps.api.modules.agent_network.models import Agent, AgentCommission
    from apps.api.modules.auth.models import User

    total_active = (
        await db.execute(select(func.count(Agent.id)).where(Agent.is_active.is_(True)))
    ).scalar_one()

    today = date.today()
    new_today = (
        await db.execute(select(func.count(Agent.id)).where(func.date(Agent.created_at) == today))
    ).scalar_one()

    region_rows = (
        await db.execute(
            select(Agent.region, func.count(Agent.id).label("agents"))
            .where(Agent.is_active.is_(True), Agent.region.isnot(None))
            .group_by(Agent.region)
            .order_by(func.count(Agent.id).desc())
        )
    ).all()

    commission_due = (
        await db.execute(
            select(func.sum(AgentCommission.amount)).where(AgentCommission.status == "pending")
        )
    ).scalar_one() or 0

    # Top agent by onboarded_count, joined with User for display name
    top_row = (
        await db.execute(
            select(User.name, Agent.id, Agent.onboarded_count)
            .join(User, User.id == Agent.user_id)
            .where(Agent.is_active.is_(True))
            .order_by(Agent.onboarded_count.desc())
            .limit(1)
        )
    ).first()
    top_agent = (
        {
            "name": top_row.name or "—",
            "code": str(top_row.id)[:8].upper(),
            "onboarded": top_row.onboarded_count,
        }
        if top_row
        else {"name": "—", "code": "—", "onboarded": 0}
    )

    return {
        "total_active": total_active,
        "new_onboardings_today": new_today,
        "regions_covered": len(region_rows),
        "commission_due_ghs": float(commission_due),
        "top_agent": top_agent,
        "region_breakdown": [{"region": r.region, "agents": r.agents} for r in region_rows],
    }


@router.get("/loans")
async def admin_list_loans(
    actor_id: PlatformAdmin,
    status: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List all loan requests across all businesses (admin view)."""
    from apps.api.modules.credit.models import LoanRequest

    q = select(LoanRequest).order_by(LoanRequest.requested_at.desc()).limit(limit).offset(offset)
    count_q = select(func.count(LoanRequest.id))
    if status:
        q = q.where(LoanRequest.status == status)
        count_q = count_q.where(LoanRequest.status == status)

    rows = (await db.execute(q)).scalars().all()
    total = (await db.execute(count_q)).scalar_one()

    return {
        "total": total,
        "items": [
            {
                "id": str(r.id),
                "business_id": str(r.business_id),
                "amount_requested": float(r.amount_requested),
                "amount_approved": float(r.amount_approved) if r.amount_approved else None,
                "lender_id": r.lender_id,
                "status": r.status,
                "created_at": r.requested_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.post("/loans/{loan_id}/action")
async def admin_loan_action(
    loan_id: UUID,
    body: AdminLoanActionRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Apply an audited admin review action to a loan request."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    loan = await AdminService(db).action_loan(
        loan_id=loan_id,
        action=body.action,
        actor_id=actor_id,
        reason=body.reason.strip() if body.reason else None,
    )
    return {
        "id": str(loan.id),
        "business_id": str(loan.business_id),
        "amount_requested": float(loan.amount_requested),
        "amount_approved": float(loan.amount_approved) if loan.amount_approved else None,
        "lender_id": loan.lender_id,
        "status": loan.status,
        "reason": loan.rejection_reason,
        "decided_at": loan.decided_at.isoformat() if loan.decided_at else None,
    }


@router.get("/lender-revenue")
async def admin_lender_revenue(
    actor_id: PlatformAdmin,
    lender_id: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List platform revenue earned from lender-originated loans."""
    from apps.api.modules.lender.models import LenderLoanRevenue

    query = select(LenderLoanRevenue).order_by(LenderLoanRevenue.earned_at.desc())
    count_q = select(func.count(LenderLoanRevenue.id))
    if lender_id:
        query = query.where(LenderLoanRevenue.lender_id == lender_id)
        count_q = count_q.where(LenderLoanRevenue.lender_id == lender_id)
    if status:
        query = query.where(LenderLoanRevenue.status == status)
        count_q = count_q.where(LenderLoanRevenue.status == status)

    total = (await db.execute(count_q)).scalar_one()
    rows = (await db.execute(query.limit(limit).offset(offset))).scalars().all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(row.id),
                "loan_request_id": str(row.loan_request_id),
                "business_id": str(row.business_id),
                "lender_id": row.lender_id,
                "principal_amount": float(row.principal_amount),
                "fee_rate_percent": float(row.fee_rate_percent),
                "fee_amount": float(row.fee_amount),
                "status": row.status,
                "provider_ref": row.provider_ref,
                "earned_at": row.earned_at.isoformat(),
                "paid_at": row.paid_at.isoformat() if row.paid_at else None,
            }
            for row in rows
        ],
    }


@router.get("/lender-revenue/summary")
async def admin_lender_revenue_summary(
    actor_id: PlatformAdmin,
    lender_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Summarise lender revenue by status and lender."""
    from apps.api.modules.lender.models import LenderLoanRevenue

    query = select(
        LenderLoanRevenue.lender_id,
        LenderLoanRevenue.status,
        func.count(LenderLoanRevenue.id).label("count"),
        func.coalesce(func.sum(LenderLoanRevenue.fee_amount), 0).label("fee_amount"),
        func.coalesce(func.sum(LenderLoanRevenue.principal_amount), 0).label("principal_amount"),
    ).group_by(LenderLoanRevenue.lender_id, LenderLoanRevenue.status)
    if lender_id:
        query = query.where(LenderLoanRevenue.lender_id == lender_id)
    rows = (await db.execute(query)).all()

    totals = {"earned_amount": 0.0, "paid_amount": 0.0, "reversed_amount": 0.0}
    by_lender: dict[str, dict] = {}
    for row in rows:
        lender = by_lender.setdefault(
            row.lender_id,
            {"earned_amount": 0.0, "paid_amount": 0.0, "reversed_amount": 0.0, "count": 0},
        )
        key = f"{row.status}_amount"
        amount = float(row.fee_amount or 0)
        if key in lender:
            lender[key] += amount
            totals[key] += amount
        lender["count"] += row.count

    return {"totals": totals, "by_lender": by_lender}


@router.post("/lender-revenue/{revenue_id}/mark-paid")
async def admin_mark_lender_revenue_paid(
    revenue_id: UUID,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark an earned lender revenue row as paid/reconciled."""
    from datetime import datetime, timezone

    from apps.api.modules.lender.models import LenderLoanRevenue

    row = await db.get(LenderLoanRevenue, revenue_id)
    if not row:
        raise HTTPException(404, "Lender revenue not found")
    if row.status == "paid":
        raise HTTPException(409, "Lender revenue is already paid")
    row.status = "paid"
    row.paid_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": str(row.id), "status": row.status, "paid_at": row.paid_at.isoformat()}


@router.get("/agent-commissions/report")
async def admin_agent_commissions_report(
    actor_id: PlatformAdmin,
    year: int | None = Query(None, ge=2020, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Reconcile agent commissions by status and activation trigger."""
    from calendar import monthrange
    from datetime import datetime, timezone

    from apps.api.modules.agent_network.models import AgentCommission

    query = select(
        AgentCommission.trigger,
        AgentCommission.status,
        func.count(AgentCommission.id).label("count"),
        func.coalesce(func.sum(AgentCommission.amount), 0).label("amount"),
    )
    if year and month:
        _, last_day = monthrange(year, month)
        start = datetime(year, month, 1, tzinfo=timezone.utc)
        end = datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)
        query = query.where(AgentCommission.created_at >= start, AgentCommission.created_at <= end)
    query = query.group_by(AgentCommission.trigger, AgentCommission.status)
    rows = (await db.execute(query)).all()

    totals = {
        "pending_amount": 0.0,
        "paid_amount": 0.0,
        "reversed_amount": 0.0,
        "count": 0,
    }
    by_trigger: dict[str, dict] = {}
    for row in rows:
        trigger = by_trigger.setdefault(
            row.trigger,
            {"pending_amount": 0.0, "paid_amount": 0.0, "reversed_amount": 0.0, "count": 0},
        )
        key = f"{row.status}_amount"
        amount = float(row.amount or 0)
        if key in trigger:
            trigger[key] += amount
            totals[key] += amount
        commission_count = int(row._mapping["count"])
        trigger["count"] += commission_count
        totals["count"] += commission_count

    return {"totals": totals, "by_trigger": by_trigger}


@router.post("/agents", status_code=201)
async def admin_create_agent(
    body: AdminAgentCreate,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create an agent account directly (admin flow — no self-registration).

    Phone must be a valid Ghana number (+233XXXXXXXXX, 0XXXXXXXXX, or 9 bare digits).
    Returns 409 if the user is already registered as an agent.
    """
    await _require_admin_totp(actor_id, db, x_admin_totp)
    from sqlalchemy import select

    from apps.api.core.exceptions import ConflictError
    from apps.api.core.phone import normalize_ghana_phone
    from apps.api.modules.agent_network.service import AgentNetworkService
    from apps.api.modules.auth.repository import UserRepository
    from apps.api.modules.business.models import BusinessMember

    phone = normalize_ghana_phone(body.phone)
    user_repo = UserRepository(db)
    user = await user_repo.get_by_phone(phone)
    if user:
        membership = await db.scalar(
            select(BusinessMember).where(BusinessMember.user_id == user.id).limit(1)
        )
        if membership:
            raise ConflictError("Phone is already registered to a business account")
        if body.name and not user.name:
            user = await user_repo.update(user, name=body.name)
    else:
        user = await user_repo.create(phone=phone, name=body.name)

    agent = await AgentNetworkService(db).register_agent(
        user_id=user.id,
        region=body.region,
        district=body.district,
    )
    await db.commit()
    return {
        "id": str(agent.id),
        "user_id": str(agent.user_id),
        "phone": phone,
        "region": agent.region,
        "district": agent.district,
        "is_active": agent.is_active,
    }


@router.patch("/agents/{agent_id}")
async def admin_update_agent(
    agent_id: UUID,
    body: AdminAgentUpdate,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update an agent's profile fields (name, phone, region, district)."""
    from apps.api.core.phone import normalize_ghana_phone
    from apps.api.modules.agent_network.models import Agent
    from apps.api.modules.auth.repository import UserRepository

    agent = await db.get(Agent, agent_id)
    if not agent:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Agent not found")

    if body.region is not None:
        agent.region = body.region
    if body.district is not None:
        agent.district = body.district
    if body.is_active is not None:
        agent.is_active = body.is_active

    if body.name is not None or body.phone is not None:
        user_repo = UserRepository(db)
        user = await user_repo.get_by_id(agent.user_id)
        if user:
            updates: dict[str, object] = {}
            if body.name is not None:
                updates["name"] = body.name
            if body.phone is not None:
                updates["phone"] = normalize_ghana_phone(body.phone)
            if updates:
                await user_repo.update(user, **updates)

    await db.commit()
    await db.refresh(agent)
    return {
        "id": str(agent.id),
        "user_id": str(agent.user_id),
        "region": agent.region,
        "district": agent.district,
        "is_active": agent.is_active,
    }


@router.delete("/agents/{agent_id}", status_code=204)
async def admin_delete_agent(
    agent_id: UUID,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Permanently delete an agent account.

    Blocked if the agent has any commission or referral records — deactivate instead.
    """
    from sqlalchemy import select

    from apps.api.core.exceptions import ConflictError
    from apps.api.modules.agent_network.models import Agent, AgentCommission, OnboardingReferral

    agent = await db.get(Agent, agent_id)
    if not agent:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Agent not found")

    has_commissions = await db.scalar(
        select(AgentCommission.id).where(AgentCommission.agent_id == agent_id).limit(1)
    )
    if has_commissions:
        raise ConflictError(
            "Cannot delete an agent with commission records. Deactivate the account instead."
        )

    has_referrals = await db.scalar(
        select(OnboardingReferral.id).where(OnboardingReferral.agent_id == agent_id).limit(1)
    )
    if has_referrals:
        raise ConflictError(
            "Cannot delete an agent who has onboarded traders. Deactivate the account instead."
        )

    await db.delete(agent)
    await db.commit()


# ── Agent approvals ──────────────────────────────────────────────────────────


@router.get("/agents/applications")
async def list_agent_applications(
    actor_id: PlatformAdmin,
    status: str | None = Query("pending"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from apps.api.modules.agent_network.service import AgentNetworkService

    applications, total = await AgentNetworkService(db).list_applications(status, limit, offset)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(app.id),
                "user_id": str(app.user_id),
                "region": app.region,
                "district": app.district,
                "momo_phone": app.momo_phone,
                "status": app.status,
                "created_at": app.created_at.isoformat(),
            }
            for app in applications
        ],
    }


@router.post("/agents/applications/{application_id}/approve")
async def approve_agent_application(
    application_id: UUID,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _require_admin_totp(actor_id, db, x_admin_totp)
    from apps.api.modules.agent_network.service import AgentNetworkService

    agent = await AgentNetworkService(db).approve_application(application_id, actor_id)
    await db.commit()
    return {"agent_id": str(agent.id), "user_id": str(agent.user_id), "is_active": agent.is_active}


@router.post("/agents/applications/{application_id}/reject")
async def reject_agent_application(
    application_id: UUID,
    body: AgentApplicationDecision,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _require_admin_totp(actor_id, db, x_admin_totp)
    from apps.api.modules.agent_network.service import AgentNetworkService

    application = await AgentNetworkService(db).reject_application(
        application_id, actor_id, body.reason
    )
    await db.commit()
    return {"application_id": str(application.id), "status": application.status}


@router.get("/appeals")
async def list_suspension_appeals(
    actor_id: PlatformAdmin,
    status: str | None = Query("pending"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    query = select(SuspensionAppeal)
    count_q = select(func.count(SuspensionAppeal.id))
    if status:
        query = query.where(SuspensionAppeal.status == status)
        count_q = count_q.where(SuspensionAppeal.status == status)
    total = (await db.execute(count_q)).scalar_one()
    rows = (
        (
            await db.execute(
                query.order_by(SuspensionAppeal.created_at.desc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(row.id),
                "business_id": str(row.business_id),
                "submitted_by": str(row.submitted_by),
                "reason": row.reason,
                "evidence_url": row.evidence_url,
                "status": row.status,
                "review_reason": row.review_reason,
                "reviewed_by": str(row.reviewed_by) if row.reviewed_by else None,
                "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }


@router.post("/appeals/{appeal_id}/approve")
async def approve_suspension_appeal(
    appeal_id: UUID,
    body: AppealDecisionRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Approve a suspension appeal and unsuspend the associated business."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    appeal = await db.get(SuspensionAppeal, appeal_id)
    if not appeal:
        raise HTTPException(404, "Appeal not found")
    if appeal.status != "pending":
        raise HTTPException(409, f"Appeal is already {appeal.status}")
    svc = AdminService(db)
    try:
        await svc.unsuspend_business(appeal.business_id, actor_id)
    except Exception as exc:
        if "already active" not in str(exc).lower():
            raise
    now = datetime.now(timezone.utc)
    appeal.status = "approved"
    appeal.review_reason = body.reason
    appeal.reviewed_by = actor_id
    appeal.reviewed_at = now
    await db.commit()
    return {
        "id": str(appeal.id),
        "business_id": str(appeal.business_id),
        "status": appeal.status,
        "review_reason": appeal.review_reason,
        "reviewed_at": now.isoformat(),
    }


@router.post("/appeals/{appeal_id}/reject")
async def reject_suspension_appeal(
    appeal_id: UUID,
    body: AppealDecisionRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Reject a suspension appeal with an optional admin review reason."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    appeal = await db.get(SuspensionAppeal, appeal_id)
    if not appeal:
        raise HTTPException(404, "Appeal not found")
    if appeal.status != "pending":
        raise HTTPException(409, f"Appeal is already {appeal.status}")
    now = datetime.now(timezone.utc)
    appeal.status = "rejected"
    appeal.review_reason = body.reason
    appeal.reviewed_by = actor_id
    appeal.reviewed_at = now
    await db.commit()
    return {
        "id": str(appeal.id),
        "business_id": str(appeal.business_id),
        "status": appeal.status,
        "review_reason": appeal.review_reason,
        "reviewed_at": now.isoformat(),
    }


# ── Audit log browser ─────────────────────────────────────────────────────────


@router.get("/audit-logs")
async def audit_logs(
    actor_id: PlatformAdmin,
    business_id: UUID | None = Query(None),
    action: str | None = Query(None),
    from_dt: datetime | None = Query(None),
    to_dt: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Browse audit log entries with optional filters."""
    svc = AdminService(db)
    logs, total = await svc.list_audit_logs(business_id, action, from_dt, to_dt, limit, offset)
    actor_ids = [lg.user_id for lg in logs if lg.user_id]
    admins_by_id = {}
    if actor_ids:
        admin_rows = (
            await db.execute(select(PlatformAdminModel).where(PlatformAdminModel.id.in_(actor_ids)))
        ).scalars().all()
        admins_by_id = {admin.id: admin for admin in admin_rows}
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(lg.id),
                "business_id": str(lg.business_id) if lg.business_id else None,
                "user_id": str(lg.user_id) if lg.user_id else None,
                "actor_id": str(lg.user_id) if lg.user_id else None,
                "actor_email": admins_by_id[lg.user_id].email
                if lg.user_id in admins_by_id
                else None,
                "action": lg.action,
                "resource_type": lg.resource_type,
                "resource_id": str(lg.resource_id) if lg.resource_id else None,
                "ip_address": lg.ip_address,
                "success": True,
                "created_at": lg.created_at.isoformat(),
            }
            for lg in logs
        ],
    }


@router.get("/transactions")
async def admin_transactions(
    actor_id: PlatformAdmin,
    business_id: UUID | None = Query(None),
    payment_method: str | None = Query(None),
    status: str | None = Query(None),
    from_dt: datetime | None = Query(None),
    to_dt: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Cross-tenant transaction view for fraud and support review."""
    sales, total = await AdminService(db).list_transactions(
        business_id, payment_method, status, from_dt, to_dt, limit, offset
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(sale.id),
                "business_id": str(sale.business_id),
                "customer_id": str(sale.customer_id) if sale.customer_id else None,
                "status": sale.status,
                "payment_method": sale.payment_method,
                "total": sale.total,
                "amount_paid": sale.amount_paid,
                "balance_due": sale.balance_due,
                "created_at": sale.created_at.isoformat(),
            }
            for sale in sales
        ],
    }


@router.get("/fraud-queue")
async def fraud_queue(
    actor_id: PlatformAdmin,
    lookback_minutes: int = Query(60, ge=5, le=1440),
    min_transactions: int = Query(20, ge=2, le=1000),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Flagged high-velocity businesses for fraud review."""
    items = await AdminService(db).fraud_queue(lookback_minutes, min_transactions)
    return {"items": items, "count": len(items)}


@router.get("/sync/queue")
async def sync_queue(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Offline-originated sales synced in last 24h, grouped by business."""
    return await AdminService(db).sync_queue()


@router.get("/payments/settlements")
async def payments_settlements(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """MoMo collection settlements aggregated by provider per day."""
    return await AdminService(db).payment_settlements()


@router.get("/payments/dva")
async def dva_payments(
    actor_id: PlatformAdmin,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Recent inbound DVA/bank-transfer collections for operations monitoring."""
    from sqlalchemy import or_

    from apps.api.modules.business.models import Business
    from apps.api.modules.payments.models import Payment

    filters = [
        Payment.type == "collection",
        or_(
            Payment.channel.in_(["dedicated_nuban", "bank", "bank_transfer"]),
            Payment.metadata_["source"].astext == "dva",
            Payment.metadata_["dva"].as_boolean().is_(True),
        ),
    ]
    total = (await db.execute(select(func.count(Payment.id)).where(*filters))).scalar_one()
    rows = (
        await db.execute(
            select(Payment, Business.name)
            .join(Business, Business.id == Payment.business_id)
            .where(*filters)
            .order_by(Payment.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(payment.id),
                "business_id": str(payment.business_id),
                "business_name": business_name,
                "amount": float(payment.amount),
                "status": payment.status,
                "channel": payment.channel,
                "external_ref": payment.external_ref,
                "created_at": payment.created_at.isoformat(),
                "confirmed_at": payment.confirmed_at.isoformat() if payment.confirmed_at else None,
            }
            for payment, business_name in rows
        ],
    }


# ── Commission Rate Configuration ────────────────────────────────────────────


class CommissionRateUpdate(BaseModel):
    event_type: str
    rate: Decimal = Field(..., gt=0, le=Decimal("10000"))


@router.get("/commission-rates")
async def list_commission_rates(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List all configurable commission rates."""
    from apps.api.modules.agent_network.service import AgentNetworkService

    service = AgentNetworkService(db)
    rates = await service.list_commission_rates()
    return [
        {
            "event_type": r.event_type,
            "rate": str(r.rate),
            "updated_by": r.updated_by,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rates
    ]


@router.put("/commission-rates")
async def update_commission_rate(
    body: CommissionRateUpdate,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update a commission rate (creates if not existing)."""
    from apps.api.modules.agent_network.service import AgentNetworkService

    # Resolve admin email from DB for audit trail
    admin = (
        await db.execute(select(PlatformAdminModel).where(PlatformAdminModel.id == actor_id))
    ).scalar_one_or_none()
    admin_email = admin.email if admin else str(actor_id)

    service = AgentNetworkService(db)
    await service.upsert_commission_rate(body.event_type, body.rate, updated_by=admin_email)
    return {"status": "updated", "event_type": body.event_type, "rate": str(body.rate)}


# ── Analytics KPI alias ───────────────────────────────────────────────────────


@router.get("/analytics/kpis")
async def analytics_kpis(
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Frontend-facing KPI summary: maps platform_metrics to the dashboard card shape."""
    from apps.api.modules.kyc.models import KYCVerification

    svc = AdminService(db)
    metrics = await svc.platform_metrics()

    kyc_counts = (
        await db.execute(
            select(KYCVerification.status, func.count(KYCVerification.id)).group_by(
                KYCVerification.status
            )
        )
    ).all()
    kyc_by_status = {row[0]: row[1] for row in kyc_counts}

    # total_disbursed: sum of approved loan amounts (active + repaid)
    from apps.api.modules.credit.models import LoanRequest

    total_disbursed = (
        await db.execute(
            select(func.sum(LoanRequest.amount_approved)).where(
                LoanRequest.status.in_(["active", "repaid", "disbursing"])
            )
        )
    ).scalar_one() or 0

    subscription_revenue = float(metrics.get("total_revenue_ghs", 0) or 0)
    tpv = float(metrics.get("tpv_ghs", 0) or 0)

    return {
        "total_businesses": metrics["total_businesses"],
        "active_subscriptions": metrics["active_businesses"],
        "active_businesses": metrics["active_businesses"],
        "suspended_businesses": metrics["suspended_businesses"],
        "total_users": metrics["total_users"],
        "total_sales": metrics["total_sales"],
        "tpv_ghs": tpv,
        "subscription_revenue_ghs": subscription_revenue,
        "total_disbursed": float(total_disbursed),
        "loan_disbursement_ghs": float(total_disbursed),
        "pending_kyc": kyc_by_status.get("pending", 0),
        "reviewing_kyc": kyc_by_status.get("reviewing", 0),
        "verified_kyc": kyc_by_status.get("verified", 0),
        "failed_kyc": kyc_by_status.get("failed", 0),
    }


# ── Business subscription update ─────────────────────────────────────────────


class SubscriptionUpdateRequest(BaseModel):
    tier: str


@router.patch("/businesses/{business_id}/subscription")
async def update_business_subscription(
    business_id: UUID,
    body: SubscriptionUpdateRequest,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update a business's subscription tier."""
    await _require_admin_totp(actor_id, db, x_admin_totp)
    from apps.api.modules.business.models import Business

    result = await db.execute(select(Business).where(Business.id == business_id))
    biz = result.scalar_one_or_none()
    if not biz:
        raise HTTPException(404, "Business not found")
    biz.subscription = body.tier
    await db.commit()
    return {"business_id": str(biz.id), "subscription": biz.subscription}


# ── KYC queue (admin) ─────────────────────────────────────────────────────────


@router.get("/kyc/queue")
async def kyc_queue(
    actor_id: PlatformAdmin,
    status: str = Query("pending"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List business and personal KYC submissions pending admin review."""
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business, BusinessMember
    from apps.api.modules.kyc.models import KYCVerification

    business_count = (
        await db.execute(
            select(func.count(KYCVerification.id)).where(KYCVerification.status == status)
        )
    ).scalar_one()
    user_count = (
        await db.execute(select(func.count(User.id)).where(User.kyc_status == status))
    ).scalar_one()

    business_rows = (
        await db.execute(
            select(KYCVerification, Business.name.label("business_name"))
            .join(Business, Business.id == KYCVerification.business_id)
            .where(KYCVerification.status == status)
            .order_by(KYCVerification.submitted_at.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    business_items = [
        {
            "id": str(row.KYCVerification.id),
            "scope": "business",
            "business_id": str(row.KYCVerification.business_id),
            "user_id": str(row.KYCVerification.user_id),
            "business_name": row.business_name,
            "subject_name": row.business_name,
            "submitted_at": row.KYCVerification.submitted_at.isoformat(),
            "document_count": len(row.KYCVerification.documents or {}),
            "documents": row.KYCVerification.documents or {},
            "status": row.KYCVerification.status,
            "ghana_card_id": row.KYCVerification.ghana_card_id,
            "tin": row.KYCVerification.tin,
        }
        for row in business_rows
    ]

    user_rows = (
        await db.execute(
            select(User, Business.id.label("business_id"), Business.name.label("business_name"))
            .outerjoin(BusinessMember, BusinessMember.user_id == User.id)
            .outerjoin(Business, Business.id == BusinessMember.business_id)
            .where(User.kyc_status == status)
            .order_by(User.kyc_submitted_at.asc().nulls_last(), User.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    user_items = [
        {
            "id": f"user-{row.User.id}",
            "scope": "user",
            "business_id": str(row.business_id) if row.business_id else None,
            "user_id": str(row.User.id),
            "business_name": row.business_name or "No business linked",
            "subject_name": row.User.name or row.User.phone,
            "submitted_at": (
                row.User.kyc_submitted_at or row.User.created_at
            ).isoformat(),
            "document_count": 1 if row.User.ghana_card_id or row.User.tin else 0,
            "documents": {},
            "status": row.User.kyc_status,
            "ghana_card_id": row.User.ghana_card_id,
            "tin": row.User.tin,
        }
        for row in user_rows
    ]

    combined = business_items + user_items
    combined.sort(key=lambda item: item["submitted_at"])
    return {
        "total": business_count + user_count,
        "limit": limit,
        "offset": offset,
        "items": combined[:limit],
    }


# ── KYC review (admin) ────────────────────────────────────────────────────────


class AdminKYCReview(BaseModel):
    approved: bool
    failure_reason: str | None = None


@router.post("/kyc/users/{user_id}/review")
async def admin_review_user_kyc(
    user_id: UUID,
    body: AdminKYCReview,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Approve or reject a user's personal KYC submission."""
    from apps.api.modules.auth.models import User

    await _require_admin_totp(actor_id, db, x_admin_totp)
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.kyc_status not in {"pending", "submitted"}:
        raise HTTPException(409, f"User KYC is '{user.kyc_status}', not pending review")

    now = datetime.now(timezone.utc)
    user.kyc_status = "verified" if body.approved else "rejected"
    user.kyc_verified_at = now if body.approved else None
    await db.commit()
    return {
        "user_id": str(user.id),
        "status": user.kyc_status,
        "reviewed_at": now.isoformat(),
        "failure_reason": body.failure_reason,
    }


@router.post("/kyc/{business_id}/review")
async def admin_review_kyc(
    business_id: UUID,
    body: AdminKYCReview,
    actor_id: PlatformAdmin,
    x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Approve or reject a KYC submission."""
    from apps.api.modules.kyc.schemas import KYCReview
    from apps.api.modules.kyc.service import KYCService

    await _require_admin_totp(actor_id, db, x_admin_totp)
    review = KYCReview(
        status="verified" if body.approved else "failed",
        failure_reason=body.failure_reason,
    )
    verification = await KYCService(db).review(business_id, review)
    await db.commit()
    return {
        "id": str(verification.id),
        "business_id": str(verification.business_id),
        "status": verification.status,
        "reviewed_at": verification.reviewed_at.isoformat() if verification.reviewed_at else None,
        "failure_reason": verification.failure_reason,
    }


# ── Agent commissions (admin view) ────────────────────────────────────────────


@router.get("/agents/{agent_id}/commissions")
async def admin_list_agent_commissions(
    agent_id: UUID,
    actor_id: PlatformAdmin,
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin view: list commissions for a specific agent."""
    from apps.api.modules.agent_network.models import AgentCommission
    from apps.api.modules.business.models import Business

    query = (
        select(AgentCommission, Business.name.label("business_name"))
        .outerjoin(Business, Business.id == AgentCommission.business_id)
        .where(AgentCommission.agent_id == agent_id)
    )

    count_q = select(func.count(AgentCommission.id)).where(AgentCommission.agent_id == agent_id)

    if status:
        query = query.where(AgentCommission.status == status)
        count_q = count_q.where(AgentCommission.status == status)

    total = (await db.execute(count_q)).scalar_one()
    rows = (
        await db.execute(
            query.order_by(AgentCommission.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(row.AgentCommission.id),
                "event_type": row.AgentCommission.trigger,
                "amount": float(row.AgentCommission.amount),
                "business_id": str(row.AgentCommission.business_id),
                "business_name": row.business_name,
                "created_at": row.AgentCommission.created_at.isoformat(),
                "paid": row.AgentCommission.status == "paid",
            }
            for row in rows
        ],
    }


# ── Mark single commission paid (admin) ───────────────────────────────────────


@router.put("/agents/{agent_id}/commissions/{commission_id}/mark-paid")
async def admin_mark_commission_paid(
    agent_id: UUID,
    commission_id: UUID,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark a single agent commission as paid."""
    from apps.api.modules.agent_network.service import AgentNetworkService

    svc = AgentNetworkService(db)
    updated = await svc.mark_commissions_paid_by_admin(
        [commission_id], admin_id=actor_id, paid_via="manual", agent_id=agent_id
    )
    await db.commit()
    if updated == 0:
        raise HTTPException(404, "Commission not found or already paid")
    return {"commission_id": str(commission_id), "status": "paid", "updated": updated}


# ── Merchant settlement controls (canonical admin paths) ─────────────────────


class MerchantSettlementConfigBody(BaseModel):
    settlement_enabled: bool | None = None
    settlement_threshold: Decimal | None = Field(
        None, gt=0, description="Minimum GHS balance before auto-settlement fires"
    )


@router.get("/merchants/{business_id}/settlement-balance")
async def admin_merchant_settlement_balance(
    business_id: UUID,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Settlement wallet summary and recent ledger for a merchant."""
    from apps.api.core.exceptions import NotFoundError
    from apps.api.modules.settlements.service import MerchantSettlementService

    svc = MerchantSettlementService(db)
    try:
        balance = await svc.get_merchant_balance(business_id)
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc

    ledger = await svc.get_ledger(business_id=business_id, limit=10, offset=0)
    return {**balance, "recent_ledger": ledger["items"]}


@router.patch("/merchants/{business_id}/settlement-config")
async def admin_update_merchant_settlement_config(
    business_id: UUID,
    body: MerchantSettlementConfigBody,
    actor_id: PlatformAdmin,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Toggle settlement_enabled (pause/resume payouts) or update auto-settlement threshold.
    """
    from apps.api.core.exceptions import ConflictError, NotFoundError
    from apps.api.modules.settlements.service import MerchantSettlementService

    if body.settlement_enabled is None and body.settlement_threshold is None:
        raise HTTPException(400, "Provide at least one field to update.")

    svc = MerchantSettlementService(db)
    try:
        result = await svc.update_settlement_config(
            business_id=business_id,
            settlement_enabled=body.settlement_enabled,
            settlement_threshold=body.settlement_threshold,
            admin_id=actor_id,
        )
        await db.commit()
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ConflictError as exc:
        raise HTTPException(409, str(exc)) from exc

    return result
