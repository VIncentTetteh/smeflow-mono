"""Lender partner API endpoints.

Two sub-sections:
  POST /lender/auth/token          — exchange API key for short-lived JWT (no auth needed)
  GET  /lender/businesses          — list business refs that consented to this lender
  GET  /lender/credit-profiles/{business_ref} — get anonymised credit profile

  POST /credit/consent             — business grants consent to a lender (user auth)
  DELETE /credit/consent/{lender}  — business revokes consent (user auth)
  GET  /credit/consent             — list active consents (user auth)
"""

import csv
import hashlib
import io
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import (
    RequireRole,
    get_current_business_id,
    require_lender_scope,
)
from apps.api.core.security import (
    create_lender_password_reset_token,
    create_lender_token,
    decode_lender_password_reset_token,
)
from apps.api.modules.credit.schemas import (
    LenderLoanDecision,
    LenderLoanListItem,
    LoanRequestResponse,
)
from apps.api.modules.lender.schemas import (
    AnonymizedCreditProfile,
    LenderConsentCreate,
    LenderConsentResponse,
    LenderPasswordResetRequest,
    LenderPortalAuthResponse,
    LenderPortalLoginRequest,
    LenderTokenRequest,
    LenderTokenResponse,
    LoanProductCreate,
    LoanProductResponse,
    LoanProductUpdate,
)
from apps.api.modules.lender.service import LenderService

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

_LOGIN_MAX_FAILURES = 5  # lockout after 5 consecutive wrong credentials
_LOGIN_LOCKOUT_SECONDS = 900  # 15-minute lockout window


async def _check_lender_login_lockout(key: str) -> None:
    """Raise 429 if the given key (email or lender_id) is locked out."""
    from apps.api.core.redis import get_idempotency_redis

    redis = get_idempotency_redis()
    lock_key = f"lender_login_lock:{key}"
    try:
        locked = await redis.get(lock_key)
        if locked:
            ttl = await redis.ttl(lock_key)
            import structlog

            structlog.get_logger().warning("lender.login.locked_out", key=key[:6])
            raise HTTPException(
                status_code=429,
                detail=f"Too many failed attempts. Try again in {ttl} seconds.",
            )
    except HTTPException:
        raise
    except Exception:
        pass  # fail-open so Redis downtime doesn't block legit logins


async def _record_lender_login_failure(key: str) -> None:
    """Increment failure counter; lock key after _LOGIN_MAX_FAILURES attempts."""
    from apps.api.core.redis import get_idempotency_redis

    redis = get_idempotency_redis()
    fail_key = f"lender_login_fail:{key}"
    lock_key = f"lender_login_lock:{key}"
    try:
        count = await redis.incr(fail_key)
        if count == 1:
            await redis.expire(fail_key, _LOGIN_LOCKOUT_SECONDS)
        if count >= _LOGIN_MAX_FAILURES:
            await redis.set(lock_key, "1", ex=_LOGIN_LOCKOUT_SECONDS)
    except Exception:
        pass


async def _clear_lender_login_failures(key: str) -> None:
    """Clear failure counter on successful login."""
    from apps.api.core.redis import get_idempotency_redis

    redis = get_idempotency_redis()
    try:
        await redis.delete(f"lender_login_fail:{key}", f"lender_login_lock:{key}")
    except Exception:
        pass


# ── Auth (no JWT needed) ─────────────────────────────────────────────────────


@router.post("/auth/token", response_model=LenderTokenResponse)
@limiter.limit("10/minute")
async def lender_auth_token(
    request: Request,
    body: LenderTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> LenderTokenResponse:
    """Exchange a lender API key for a short-lived (1 h) JWT with scope=lender."""
    await _check_lender_login_lockout(body.lender_id)
    if not await LenderService(db).verify_api_key(body.lender_id, body.api_key):
        await _record_lender_login_failure(body.lender_id)
        raise HTTPException(status_code=401, detail="Invalid lender credentials")
    await _clear_lender_login_failures(body.lender_id)
    await db.commit()
    token = create_lender_token(body.lender_id)
    return LenderTokenResponse(access_token=token, lender_id=body.lender_id)


@router.post("/auth/login", response_model=LenderPortalAuthResponse)
@limiter.limit("5/minute")
async def lender_portal_login(
    request: Request,
    body: LenderPortalLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> LenderPortalAuthResponse:
    """Authenticate a lender portal user with email/password."""
    await _check_lender_login_lockout(body.email.lower())
    try:
        partner, must_reset = await LenderService(db).authenticate_portal_login(
            body.email, body.password
        )
    except Exception as exc:
        await _record_lender_login_failure(body.email.lower())
        raise HTTPException(status_code=401, detail="Invalid lender credentials") from exc
    await _clear_lender_login_failures(body.email.lower())
    await db.commit()
    if must_reset:
        return LenderPortalAuthResponse(
            lender_id=partner.lender_id,
            must_reset_password=True,
            reset_token=create_lender_password_reset_token(partner.lender_id),
        )
    return LenderPortalAuthResponse(
        lender_id=partner.lender_id,
        must_reset_password=False,
        access_token=create_lender_token(partner.lender_id),
    )


@router.post("/auth/reset-password", response_model=LenderPortalAuthResponse)
async def lender_portal_reset_password(
    body: LenderPasswordResetRequest,
    db: AsyncSession = Depends(get_db),
) -> LenderPortalAuthResponse:
    """Complete the lender's first-login password reset."""
    try:
        lender_id = decode_lender_password_reset_token(body.reset_token)
        partner = await LenderService(db).reset_portal_password(lender_id, body.new_password)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired reset token") from exc
    await db.commit()
    return LenderPortalAuthResponse(
        lender_id=partner.lender_id,
        must_reset_password=False,
        access_token=create_lender_token(partner.lender_id),
    )


@router.post("/auth/refresh", response_model=LenderTokenResponse)
async def lender_auth_refresh(
    lender_id: str = Depends(require_lender_scope),
) -> LenderTokenResponse:
    new_token = create_lender_token(lender_id)
    return LenderTokenResponse(access_token=new_token, lender_id=lender_id)


# ── Lender-scoped endpoints (require scope=lender JWT) ───────────────────────


@router.get("/businesses")
async def list_consented_businesses(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List businesses that have consented to share data with this lender."""
    items, total = await LenderService(db).list_consented_businesses(lender_id, limit, offset)
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.get("/credit-profiles/{business_ref}", response_model=AnonymizedCreditProfile)
@limiter.limit("100/hour")
async def get_credit_profile(
    request: Request,
    business_ref: str,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> AnonymizedCreditProfile:
    """Return an anonymised credit profile for a business (consent required)."""
    svc = LenderService(db)
    business_id = await svc.resolve_business_ref(business_ref, lender_id)
    profile = await svc.get_anonymized_profile(business_id, lender_id)
    return AnonymizedCreditProfile(**profile)


# ── Loan products (lender-authenticated) ────────────────────────────────────


@router.post("/products", response_model=LoanProductResponse, status_code=201)
async def create_loan_product(
    body: LoanProductCreate,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> LoanProductResponse:
    """Create a new pre-published loan product for this lender."""
    product = await LenderService(db).create_product(lender_id, body.model_dump())
    await db.commit()
    return LoanProductResponse.model_validate(product)


@router.get("/products", response_model=list[LoanProductResponse])
async def list_loan_products(
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> list[LoanProductResponse]:
    """List this lender's loan products."""
    products = await LenderService(db).list_products(lender_id)
    return [LoanProductResponse.model_validate(p) for p in products]


@router.patch("/products/{product_id}", response_model=LoanProductResponse)
async def update_loan_product(
    product_id: UUID,
    body: LoanProductUpdate,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> LoanProductResponse:
    """Update a loan product (rates, terms, active flag)."""
    product = await LenderService(db).update_product(
        product_id, lender_id, body.model_dump(exclude_none=True)
    )
    await db.commit()
    return LoanProductResponse.model_validate(product)


@router.delete("/products/{product_id}", response_model=LoanProductResponse)
async def deactivate_loan_product(
    product_id: UUID,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> LoanProductResponse:
    """Soft-deactivate a loan product (sets is_active=False)."""
    product = await LenderService(db).deactivate_product(product_id, lender_id)
    await db.commit()
    return LoanProductResponse.model_validate(product)


# ── Business consent management (user-authenticated) ─────────────────────────


@router.post("/consent", response_model=LenderConsentResponse, status_code=201)
async def grant_lender_consent(
    body: LenderConsentCreate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> LenderConsentResponse:
    """Grant a lender partner access to this business's credit profile."""
    consent = await LenderService(db).grant_consent(business_id, body.lender_id)
    await db.commit()
    return LenderConsentResponse.model_validate(consent)


@router.delete("/consent/{lender_id}", response_model=LenderConsentResponse)
async def revoke_lender_consent(
    lender_id: str,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> LenderConsentResponse:
    """Revoke a lender partner's access to this business's credit profile."""
    consent = await LenderService(db).revoke_consent(business_id, lender_id)
    await db.commit()
    return LenderConsentResponse.model_validate(consent)


@router.get("/consent", response_model=list[LenderConsentResponse])
async def list_lender_consents(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[LenderConsentResponse]:
    """List active lender consents for this business."""
    consents = await LenderService(db).list_consents(business_id)
    return [LenderConsentResponse.model_validate(c) for c in consents]


# ── Lender loan management ────────────────────────────────────────────────────


@router.get("/loans", response_model=list[LenderLoanListItem])
async def list_pending_loans(
    status: str | None = Query(
        None, description="Filter by status (pending_partner|approved|rejected)"
    ),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> list[LenderLoanListItem]:
    """
    List loan requests visible to this lender.

    Returns all pending_partner requests (open to any lender) plus requests
    that are already assigned to this lender.  Responses use anonymised
    business refs so the lender cannot identify the merchant directly.
    """
    items = await LenderService(db).list_loans_for_lender(lender_id, status, limit, offset)
    return [LenderLoanListItem.model_validate(item) for item in items]


@router.post("/loans/{loan_id}/approve", response_model=LoanRequestResponse)
async def approve_loan(
    loan_id: UUID,
    body: LenderLoanDecision,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> LoanRequestResponse:
    """
    Approve a pending loan request.

    Required fields in body: amount_approved, interest_rate, term_days.
    Optional: partner_ref, lender_webhook_url.
    """
    from apps.api.modules.credit.service import CreditService

    if not body.amount_approved or not body.interest_rate or not body.term_days:
        raise HTTPException(
            400, "amount_approved, interest_rate, and term_days are required to approve a loan"
        )

    svc = CreditService(db)
    loan = await svc.lender_approve(
        loan_id=loan_id,
        lender_id=lender_id,
        amount_approved=body.amount_approved,
        interest_rate=body.interest_rate,
        term_days=body.term_days,
        partner_ref=body.partner_ref,
        lender_webhook_url=body.lender_webhook_url,
    )
    await db.commit()
    return LoanRequestResponse.model_validate(loan)


@router.post("/loans/{loan_id}/reject", response_model=LoanRequestResponse)
async def reject_loan(
    loan_id: UUID,
    body: LenderLoanDecision,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> LoanRequestResponse:
    """Reject a pending loan request with an optional reason."""
    from apps.api.modules.credit.service import CreditService

    svc = CreditService(db)
    loan = await svc.lender_reject(
        loan_id=loan_id,
        lender_id=lender_id,
        rejection_reason=body.rejection_reason,
    )
    await db.commit()
    return LoanRequestResponse.model_validate(loan)


# ── Lender analytics dashboard ────────────────────────────────────────────────


@router.get("/analytics")
async def lender_analytics(
    from_date: datetime | None = Query(None, description="Start date for analytics window (ISO 8601)"),
    to_date: datetime | None = Query(None, description="End date for analytics window (ISO 8601)"),
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Portfolio analytics for the lender dashboard."""
    from collections import defaultdict

    from sqlalchemy import and_, exists, func, or_, select

    from apps.api.modules.credit.models import LenderConsent, LoanRequest, RepaymentInstalment
    from apps.api.modules.lender.models import LenderPartner, LoanProduct

    partner = (
        await db.execute(select(LenderPartner).where(LenderPartner.lender_id == lender_id))
    ).scalar_one_or_none()
    if not partner:
        raise HTTPException(404, "Lender not found")

    visible_pending_filter = and_(
        LoanRequest.status == "pending_partner",
        LoanRequest.lender_id.is_(None),
        exists(
            select(LenderConsent.id).where(
                LenderConsent.business_id == LoanRequest.business_id,
                LenderConsent.lender_id == lender_id,
                LenderConsent.is_active.is_(True),
            )
        ),
    )

    pending_loan_requests = (
        await db.execute(select(func.count(LoanRequest.id)).where(visible_pending_filter))
    ).scalar_one()

    consented_businesses = (
        await db.execute(
            select(func.count(LenderConsent.id)).where(
                LenderConsent.lender_id == lender_id,
                LenderConsent.is_active.is_(True),
            )
        )
    ).scalar_one()

    active_products = (
        await db.execute(
            select(func.count(LoanProduct.id)).where(
                LoanProduct.lender_id == lender_id,
                LoanProduct.is_active.is_(True),
            )
        )
    ).scalar_one()

    total_products = (
        await db.execute(
            select(func.count(LoanProduct.id)).where(LoanProduct.lender_id == lender_id)
        )
    ).scalar_one()

    review_rows = (
        await db.execute(
            select(LoanRequest.id, LoanRequest.amount_requested, LoanRequest.requested_at)
            .where(
                or_(
                    visible_pending_filter,
                    and_(
                        LoanRequest.lender_id == lender_id,
                        LoanRequest.status.in_(["approved", "confirmed", "disbursing"]),
                    ),
                )
            )
            .order_by(LoanRequest.requested_at.desc())
            .limit(5)
        )
    ).all()
    review_queue = [
        {
            "id": str(row.id),
            "amount_requested": float(row.amount_requested or 0),
            "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        }
        for row in review_rows
    ]

    # Active and repaid loans for this lender
    total_disbursed = (
        await db.execute(
            select(func.sum(LoanRequest.amount_approved)).where(
                LoanRequest.lender_id == lender_id,
                LoanRequest.status.in_(["active", "repaid", "disbursing"]),
            )
        )
    ).scalar_one() or 0

    active_loans = (
        await db.execute(
            select(func.count(LoanRequest.id)).where(
                LoanRequest.lender_id == lender_id,
                LoanRequest.status == "active",
            )
        )
    ).scalar_one()

    overdue_count = (
        await db.execute(
            select(func.count(LoanRequest.id)).where(
                LoanRequest.lender_id == lender_id,
                LoanRequest.status == "defaulted",
            )
        )
    ).scalar_one()

    # Repayment rate: paid instalments / total due instalments (non-pending)
    total_due = (
        await db.execute(
            select(func.count(RepaymentInstalment.id))
            .join(LoanRequest, LoanRequest.id == RepaymentInstalment.loan_request_id)
            .where(
                LoanRequest.lender_id == lender_id,
                RepaymentInstalment.status.in_(["paid", "failed", "defaulted"]),
            )
        )
    ).scalar_one() or 1  # avoid div-by-zero

    paid_instalments = (
        await db.execute(
            select(func.count(RepaymentInstalment.id))
            .join(LoanRequest, LoanRequest.id == RepaymentInstalment.loan_request_id)
            .where(
                LoanRequest.lender_id == lender_id,
                RepaymentInstalment.status == "paid",
            )
        )
    ).scalar_one()

    repayment_rate = round((paid_instalments / total_due) * 100, 1)

    # Date range for analytics window
    if to_date is None:
        to_date = datetime.now(timezone.utc)
    if from_date is None:
        from_date = to_date - timedelta(days=180)
    six_months_ago = from_date  # kept for backward compat with monthly_repaid query below

    # Monthly disbursements
    monthly_rows = (
        await db.execute(
            select(LoanRequest.disbursed_at, LoanRequest.amount_approved)
            .where(
                LoanRequest.lender_id == lender_id,
                LoanRequest.disbursed_at >= from_date,
                LoanRequest.disbursed_at <= to_date,
                LoanRequest.disbursed_at.is_not(None),
            )
            .order_by(LoanRequest.disbursed_at)
        )
    ).all()

    monthly_disbursement_buckets: dict[tuple[int, int], float] = defaultdict(float)
    for row in monthly_rows:
        disbursed_at = row.disbursed_at
        if disbursed_at:
            monthly_disbursement_buckets[(disbursed_at.year, disbursed_at.month)] += float(
                row.amount_approved or 0
            )
    monthly_disbursements = [
        {
            "month": datetime(year, month, 1).strftime("%b"),
            "amount": amount,
        }
        for (year, month), amount in sorted(monthly_disbursement_buckets.items())
    ]

    # ── Portfolio by sector ───────────────────────────────────────────────────
    from apps.api.modules.business.models import Business

    sector_rows = (
        await db.execute(
            select(
                Business.type,
                func.count(LoanRequest.id).label("cnt"),
                func.sum(LoanRequest.amount_approved).label("amt"),
            )
            .join(LoanRequest, LoanRequest.business_id == Business.id)
            .where(
                LoanRequest.lender_id == lender_id,
                LoanRequest.status.in_(["active", "repaid", "disbursing"]),
            )
            .group_by(Business.type)
            .order_by(func.sum(LoanRequest.amount_approved).desc())
        )
    ).all()

    total_sector_amount = sum(float(r.amt or 0) for r in sector_rows) or 1
    portfolio_by_sector = [
        {
            "sector": r.type or "Other",
            "pct": round(float(r.amt or 0) / total_sector_amount * 100, 1),
            "amount": float(r.amt or 0),
        }
        for r in sector_rows[:6]
    ]

    # ── Repayment health buckets ──────────────────────────────────────────────
    today = datetime.now(timezone.utc).date()

    instalment_rows = (
        await db.execute(
            select(RepaymentInstalment.status, RepaymentInstalment.due_date)
            .join(LoanRequest, LoanRequest.id == RepaymentInstalment.loan_request_id)
            .where(LoanRequest.lender_id == lender_id, RepaymentInstalment.status != "pending")
        )
    ).all()

    total_inst = max(len(instalment_rows), 1)
    on_time = sum(1 for r in instalment_rows if r.status == "paid")

    def _days_overdue(r) -> int:
        due = r.due_date.date() if hasattr(r.due_date, "date") else r.due_date
        return (today - due).days if due else 0

    late_1_7 = sum(
        1
        for r in instalment_rows
        if r.status not in ("paid", "pending") and 1 <= _days_overdue(r) <= 7
    )
    late_8_30 = sum(
        1
        for r in instalment_rows
        if r.status not in ("paid", "pending") and 8 <= _days_overdue(r) <= 30
    )
    defaulted_inst = sum(1 for r in instalment_rows if r.status == "defaulted")

    repayment_health = [
        {"label": "On time", "pct": round(on_time / total_inst * 100, 1), "tone": "brand"},
        {"label": "1-7 days late", "pct": round(late_1_7 / total_inst * 100, 1), "tone": "gold"},
        {"label": "8-30 days", "pct": round(late_8_30 / total_inst * 100, 1), "tone": "warn"},
        {
            "label": "Defaulted",
            "pct": round(defaulted_inst / total_inst * 100, 1),
            "tone": "danger",
        },
    ]

    # ── Monthly repaid rates (last 6 months) ─────────────────────────────────
    monthly_repaid_rows = (
        await db.execute(
            select(RepaymentInstalment.due_date, RepaymentInstalment.status)
            .join(LoanRequest, LoanRequest.id == RepaymentInstalment.loan_request_id)
            .where(
                LoanRequest.lender_id == lender_id,
                RepaymentInstalment.due_date >= from_date,
                RepaymentInstalment.due_date <= to_date,
            )
            .order_by(RepaymentInstalment.due_date)
        )
    ).all()

    monthly_repaid_buckets: dict[tuple[int, int], dict[str, int]] = defaultdict(
        lambda: {"total": 0, "paid": 0}
    )
    for row in monthly_repaid_rows:
        due_date = row.due_date
        if not due_date:
            continue
        bucket = monthly_repaid_buckets[(due_date.year, due_date.month)]
        bucket["total"] += 1
        if row.status == "paid":
            bucket["paid"] += 1
    monthly_repaid = [
        {
            "month": datetime(year, month, 1).strftime("%b"),
            "rate": round(counts["paid"] / max(counts["total"], 1) * 100, 1),
        }
        for (year, month), counts in sorted(monthly_repaid_buckets.items())
    ]

    # ── Avg ticket, avg tenor, NPL rate ──────────────────────────────────────
    avg_tenor_row = (
        await db.execute(
            select(func.avg(LoanRequest.term_days)).where(
                LoanRequest.lender_id == lender_id,
                LoanRequest.status == "active",
            )
        )
    ).scalar_one() or 0

    avg_ticket = round(float(total_disbursed) / max(active_loans, 1), 2)
    avg_tenor_days = round(float(avg_tenor_row), 0)
    npl_rate = round(overdue_count / max(active_loans, 1) * 100, 1)

    return {
        "total_disbursed": float(total_disbursed),
        "active_loans": active_loans,
        "repayment_rate": repayment_rate,
        "overdue_count": overdue_count,
        "pending_loan_requests": pending_loan_requests,
        "consented_businesses": consented_businesses,
        "active_products": active_products,
        "total_products": total_products,
        "api_ready": bool(partner.api_key_hint),
        "webhook_configured": bool(partner.webhook_url),
        "review_queue": review_queue,
        "monthly_disbursements": monthly_disbursements,
        "portfolio_by_sector": portfolio_by_sector,
        "repayment_health": repayment_health,
        "monthly_repaid": monthly_repaid,
        "avg_ticket": avg_ticket,
        "avg_tenor_days": avg_tenor_days,
        "npl_rate": npl_rate,
    }


# ── Lender revenue dashboard ─────────────────────────────────────────────────


@router.get("/revenue/summary")
async def lender_revenue_summary(
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Summarise earned/reconciled platform fees for this lender's loans."""
    from sqlalchemy import func, select

    from apps.api.modules.lender.models import LenderLoanRevenue

    rows = (
        await db.execute(
            select(
                LenderLoanRevenue.status,
                func.count(LenderLoanRevenue.id).label("count"),
                func.coalesce(func.sum(LenderLoanRevenue.fee_amount), 0).label("fee_amount"),
                func.coalesce(func.sum(LenderLoanRevenue.principal_amount), 0).label("principal_amount"),
            )
            .where(LenderLoanRevenue.lender_id == lender_id)
            .group_by(LenderLoanRevenue.status)
        )
    ).all()
    totals = {
        "earned_amount": 0.0,
        "paid_amount": 0.0,
        "reversed_amount": 0.0,
        "principal_amount": 0.0,
        "count": 0,
    }
    by_status: dict[str, dict] = {}
    for row in rows:
        amount = float(row.fee_amount or 0)
        principal = float(row.principal_amount or 0)
        by_status[row.status] = {
            "count": row.count,
            "fee_amount": amount,
            "principal_amount": principal,
        }
        if row.status in ("earned", "paid", "reversed"):
            totals[f"{row.status}_amount"] += amount
        totals["principal_amount"] += principal
        totals["count"] += row.count
    return {"totals": totals, "by_status": by_status}


@router.get("/revenue")
async def lender_revenue(
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List revenue rows for this lender only."""
    from sqlalchemy import func, select

    from apps.api.modules.lender.models import LenderLoanRevenue

    query = select(LenderLoanRevenue).where(LenderLoanRevenue.lender_id == lender_id)
    count_q = select(func.count(LenderLoanRevenue.id)).where(
        LenderLoanRevenue.lender_id == lender_id
    )
    if status:
        query = query.where(LenderLoanRevenue.status == status)
        count_q = count_q.where(LenderLoanRevenue.status == status)
    total = (await db.execute(count_q)).scalar_one()
    rows = (
        await db.execute(
            query.order_by(LenderLoanRevenue.earned_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(row.id),
                "loan_request_id": str(row.loan_request_id),
                "business_ref": hashlib.sha256(f"{row.business_id}{lender_id}".encode()).hexdigest(),
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


# ── Lender profile & settings ─────────────────────────────────────────────────


@router.get("/me")
async def lender_profile(
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return this lender's profile and settings."""
    from sqlalchemy import select

    from apps.api.modules.lender.models import LenderPartner

    partner = (
        await db.execute(select(LenderPartner).where(LenderPartner.lender_id == lender_id))
    ).scalar_one_or_none()
    if not partner:
        raise HTTPException(404, "Lender not found")
    secret = partner.webhook_secret if hasattr(partner, "webhook_secret") else None
    return {
        "lender_id": lender_id,
        "name": partner.name,
        "contact_email": partner.contact_email,
        "webhook_url": partner.webhook_url,
        "api_key_hint": partner.api_key_hint,
        "paystack_subaccount_code": partner.paystack_subaccount_code,
        "paystack_split_code": partner.paystack_split_code,
        "settlement_bank_code": partner.settlement_bank_code,
        "settlement_account_hint": (
            f"••••{partner.settlement_account_number[-4:]}"
            if partner.settlement_account_number
            else None
        ),
        "platform_fee_percent": partner.platform_fee_percent,
        "settlement_ready": bool(partner.paystack_subaccount_code and partner.paystack_split_code),
        "webhook_secret_hint": f"...{secret[-6:]}" if secret else None,
    }


class LenderSettingsUpdate(BaseModel):
    webhook_url: str | None = None
    contact_email: str | None = None
    current_password: str | None = None
    new_password: str | None = Field(None, min_length=8, max_length=128)


@router.patch("/settings")
async def update_lender_settings(
    body: LenderSettingsUpdate,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update lender settings (webhook_url, contact_email, password)."""
    from sqlalchemy import select

    from apps.api.core.security import hash_password, verify_password
    from apps.api.modules.lender.models import LenderPartner

    partner = (
        await db.execute(select(LenderPartner).where(LenderPartner.lender_id == lender_id))
    ).scalar_one_or_none()
    if not partner:
        raise HTTPException(404, "Lender not found")
    if body.webhook_url is not None:
        partner.webhook_url = body.webhook_url
    if body.contact_email is not None:
        partner.contact_email = body.contact_email
    if body.new_password is not None:
        if not body.current_password:
            raise HTTPException(400, "current_password is required to change password")
        if not partner.portal_password_hash or not verify_password(
            body.current_password, partner.portal_password_hash
        ):
            raise HTTPException(403, "Current password is incorrect")
        partner.portal_password_hash = hash_password(body.new_password)
    await db.commit()
    return {"ok": True, "webhook_url": partner.webhook_url}


# ── Single loan detail ───────────────────────────────────────────────────────


@router.get("/loans/{loan_id}")
async def get_loan_detail(
    loan_id: UUID,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return a single loan visible to this lender (404 if not found/accessible)."""
    from apps.api.core.exceptions import ForbiddenError, NotFoundError

    try:
        return await LenderService(db).get_loan_for_lender(loan_id, lender_id)
    except NotFoundError:
        raise HTTPException(404, "Loan not found")
    except ForbiddenError:
        raise HTTPException(404, "Loan not found or not accessible")


# ── Loan instalment schedule ──────────────────────────────────────────────────


@router.get("/loans/{loan_id}/installments")
async def loan_installments(
    loan_id: UUID,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return the repayment instalment schedule for a loan."""
    from sqlalchemy import select

    from apps.api.modules.credit.models import LoanRequest, RepaymentInstalment

    # Verify lender has access to this loan
    loan = (
        await db.execute(
            select(LoanRequest).where(
                LoanRequest.id == loan_id,
                LoanRequest.lender_id == lender_id,
            )
        )
    ).scalar_one_or_none()
    if not loan:
        raise HTTPException(404, "Loan not found or not accessible")

    instalments = (
        (
            await db.execute(
                select(RepaymentInstalment)
                .where(RepaymentInstalment.loan_request_id == loan_id)
                .order_by(RepaymentInstalment.instalment_number)
            )
        )
        .scalars()
        .all()
    )

    return [
        {
            "id": str(inst.id),
            "instalment_number": inst.instalment_number,
            "due_date": inst.due_date.isoformat(),
            "amount": float(inst.amount),
            "principal": float(inst.principal),
            "interest": float(inst.interest),
            "status": inst.status,
            "paid_at": inst.paid_at.isoformat() if inst.paid_at else None,
        }
        for inst in instalments
    ]

# ── Webhook test ──────────────────────────────────────────────────────────────


@router.post("/settings/test-webhook")
async def test_lender_webhook(
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send a test event to the configured webhook URL."""
    import hashlib
    import hmac
    import json
    import time

    import httpx
    from sqlalchemy import select

    from apps.api.modules.lender.models import LenderPartner

    partner = (
        await db.execute(select(LenderPartner).where(LenderPartner.lender_id == lender_id))
    ).scalar_one_or_none()
    if not partner or not partner.webhook_url:
        raise HTTPException(400, "No webhook URL configured")

    payload = {
        "event": "webhook.test",
        "lender_id": lender_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    json_body = json.dumps(payload)
    ts = int(time.time())
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "X-SMEFlow-Timestamp": str(ts),
    }
    secret = getattr(partner, "webhook_secret", None)
    if secret:
        sig = hmac.new(secret.encode(), json_body.encode(), hashlib.sha256).hexdigest()
        headers["X-SMEFlow-Signature"] = f"sha256={sig}"

    start = time.monotonic()
    http_status = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(partner.webhook_url, content=json_body, headers=headers)
            http_status = resp.status_code
        latency_ms = (time.monotonic() - start) * 1000
        status = "delivered" if http_status and http_status < 400 else "failed"
    except Exception:
        latency_ms = (time.monotonic() - start) * 1000
        status = "failed"

    return {"status": status, "http_status": http_status, "latency_ms": round(latency_ms, 2)}


# ── API key rotation ──────────────────────────────────────────────────────────


class RotateKeyRequest(BaseModel):
    current_password: str


@router.post("/auth/rotate-key")
async def rotate_lender_api_key(
    body: RotateKeyRequest,
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Rotate lender API key after verifying current password."""
    from apps.api.core.audit import audit
    from apps.api.core.security import verify_password
    from apps.api.modules.lender.models import LenderPartner

    from sqlalchemy import select

    partner = (
        await db.execute(select(LenderPartner).where(LenderPartner.lender_id == lender_id))
    ).scalar_one_or_none()
    if not partner:
        raise HTTPException(404, "Lender not found")
    if not partner.portal_password_hash or not verify_password(
        body.current_password, partner.portal_password_hash
    ):
        raise HTTPException(403, "Current password is incorrect")

    svc = LenderService(db)
    partner_obj, new_key = await svc.update_partner(lender_id, rotate_key=True)
    await audit(
        db,
        action="lender.api_key_rotated",
        resource_type="LenderPartner",
        resource_id=partner_obj.id,
        business_id=None,
        after={"hint": partner_obj.api_key_hint},
    )
    await db.commit()
    return {
        "api_key": new_key,
        "lender_id": lender_id,
        "hint": partner_obj.api_key_hint,
    }


# ── Revenue CSV export ────────────────────────────────────────────────────────


@router.get("/revenue/export")
async def lender_revenue_export(
    lender_id: str = Depends(require_lender_scope),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Export revenue ledger as CSV."""
    from sqlalchemy import select

    from apps.api.modules.lender.models import LenderLoanRevenue

    rows = (
        await db.execute(
            select(LenderLoanRevenue)
            .where(LenderLoanRevenue.lender_id == lender_id)
            .order_by(LenderLoanRevenue.earned_at.desc())
            .limit(10000)
        )
    ).scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["loan_ref", "business_ref", "principal", "fee_rate_pct", "fee_amount",
         "status", "provider_ref", "earned_at", "paid_at"]
    )
    for row in rows:
        writer.writerow([
            str(row.loan_request_id),
            hashlib.sha256(f"{row.business_id}{lender_id}".encode()).hexdigest(),
            float(row.principal_amount),
            float(row.fee_rate_percent),
            float(row.fee_amount),
            row.status,
            row.provider_ref or "",
            row.earned_at.isoformat() if row.earned_at else "",
            row.paid_at.isoformat() if row.paid_at else "",
        ])

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=revenue.csv"},
    )
