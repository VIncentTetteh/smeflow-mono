"""Credit scoring and loan lifecycle endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import (
    RequireFeature,
    RequireRole,
    get_current_business_id,
    require_kyc_verified,
)
from apps.api.core.middleware import limiter
from apps.api.modules.credit.schemas import (
    CreditScoreResponse,
    LoanConfirmRequest,
    LoanRequestCreate,
    LoanRequestResponse,
    RepaymentInstalmentResponse,
)
from apps.api.modules.credit.service import CreditService
from apps.api.modules.lender.schemas import LenderWithProducts

router = APIRouter()


# ── Credit score ──────────────────────────────────────────────────────────────


@router.get("/score", response_model=CreditScoreResponse)
async def current_score(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> CreditScoreResponse:
    score = await CreditService(db).current_score(business_id)
    return CreditScoreResponse.model_validate(score)


@router.get("/score/history", response_model=list[CreditScoreResponse])
async def score_history(
    limit: int = Query(20, ge=1, le=100),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[CreditScoreResponse]:
    scores = await CreditService(db).score_history(business_id, limit)
    return [CreditScoreResponse.model_validate(score) for score in scores]


# ── Loan request (merchant) ───────────────────────────────────────────────────


@router.post("/request", response_model=LoanRequestResponse, status_code=201)
@limiter.limit("3/day")
async def create_loan_request(
    request: Request,
    body: LoanRequestCreate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    _feat: None = Depends(RequireFeature("credit_scoring")),
    db: AsyncSession = Depends(get_db),
) -> LoanRequestResponse:
    """Submit a new loan request to the lender pool."""
    svc = CreditService(db)
    loan_request = await svc.create_loan_request(
        business_id,
        body.amount_requested,
        body.term_days,
        target_lender_id=body.target_lender_id,
        disbursement_phone=body.disbursement_phone,
        loan_product_id=body.loan_product_id,
    )
    await db.commit()
    return LoanRequestResponse.model_validate(loan_request)


@router.get("/requests", response_model=list[LoanRequestResponse])
async def list_loan_requests(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[LoanRequestResponse]:
    requests = await CreditService(db).list_requests(business_id)
    return [LoanRequestResponse.model_validate(r) for r in requests]


@router.get("/loans/{loan_id}", response_model=LoanRequestResponse)
async def get_loan(
    loan_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> LoanRequestResponse:
    """Get details of a specific loan request."""
    loan = await CreditService(db).get_loan(loan_id, business_id)
    return LoanRequestResponse.model_validate(loan)


@router.get("/loans/{loan_id}/schedule", response_model=list[RepaymentInstalmentResponse])
async def get_repayment_schedule(
    loan_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[RepaymentInstalmentResponse]:
    """Get the full repayment schedule for an active loan."""
    instalments = await CreditService(db).get_repayment_schedule(loan_id, business_id)
    return [RepaymentInstalmentResponse.model_validate(i) for i in instalments]


# ── Merchant OTP confirmation ─────────────────────────────────────────────────


@router.post("/loans/{loan_id}/confirm/resend", status_code=200)
async def resend_confirm_otp(
    loan_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Re-send the loan confirmation OTP to the business owner."""
    await CreditService(db).send_loan_confirm_otp(loan_id, business_id)
    return {"message": "Confirmation OTP re-sent via SMS"}


@router.post("/loans/{loan_id}/confirm", response_model=LoanRequestResponse)
async def confirm_loan(
    loan_id: UUID,
    body: LoanConfirmRequest,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> LoanRequestResponse:
    """
    Confirm the approved loan using the OTP sent to the business owner.

    This is the merchant's explicit consent to receive the disbursement.
    After confirmation the loan status moves to 'confirmed' and the
    platform admin can initiate the MoMo disbursement.
    """
    svc = CreditService(db)
    loan = await svc.confirm_loan(loan_id, business_id, body.otp)
    await db.commit()
    return LoanRequestResponse.model_validate(loan)


# ── Active lender discovery (merchant) ───────────────────────────────────────


@router.get("/lenders", response_model=list[LenderWithProducts])
async def list_active_lenders(
    _: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[LenderWithProducts]:
    """Return active lender partners with their pre-published loan products."""
    from apps.api.modules.lender.service import LenderService

    data = await LenderService(db).list_active_lenders_with_products()
    return [LenderWithProducts.model_validate(item) for item in data]


# ── Disbursement (platform_admin only) ───────────────────────────────────────


@router.post("/loans/{loan_id}/disburse", response_model=LoanRequestResponse)
async def disburse_loan(
    loan_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> LoanRequestResponse:
    """
    Trigger MoMo disbursement for a confirmed loan.

    **Restricted to platform_admin.**  The caller must present an admin JWT
    obtained from POST /admin/auth/login.
    """
    from apps.api.modules.admin.router import _require_platform_admin

    admin_id = await _require_platform_admin(request, db)
    svc = CreditService(db)
    loan = await svc.disburse_loan(loan_id, disbursed_by=admin_id)
    await db.commit()
    return LoanRequestResponse.model_validate(loan)


@router.get("/loans/{loan_id}/disbursement")
async def get_disbursement_status(
    loan_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Return disbursement status and transfer details for a loan.
    Merchant-facing — scoped to the authenticated business.
    """
    from sqlalchemy import select

    from apps.api.modules.credit.models import LoanRequest

    result = await db.execute(
        select(LoanRequest).where(
            LoanRequest.id == loan_id,
            LoanRequest.business_id == business_id,
        )
    )
    loan = result.scalar_one_or_none()
    if not loan:
        from fastapi import HTTPException
        raise HTTPException(404, "Loan not found")

    return {
        "loan_id": str(loan.id),
        "status": loan.status,
        "amount_approved_ghs": str(loan.amount_approved) if loan.amount_approved else None,
        "disbursement_phone": loan.disbursement_phone,
        "disbursement_transfer_code": loan.disbursement_transfer_code,
        "disbursement_payment_ref": loan.disbursement_payment_ref,
        "disbursed_at": loan.disbursed_at.isoformat() if loan.disbursed_at else None,
    }
