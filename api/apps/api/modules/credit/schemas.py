"""Credit scoring API schemas."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class CreditScoreResponse(BaseModel):
    id: UUID
    score: Decimal
    band: str
    max_loan_amount: Decimal | None
    computed_at: datetime
    factors: dict
    staleness_warning: bool = False

    model_config = {"from_attributes": True}


class LoanRequestCreate(BaseModel):
    amount_requested: Decimal = Field(..., gt=0)
    term_days: int = Field(..., ge=1, le=365)
    target_lender_id: str | None = None
    loan_product_id: UUID | None = None
    # MoMo phone for disbursement (defaults to business primary MoMo account if omitted)
    disbursement_phone: str | None = None


class RepaymentInstalmentResponse(BaseModel):
    id: UUID
    loan_request_id: UUID
    instalment_number: int
    due_date: datetime
    amount: Decimal
    principal: Decimal
    interest: Decimal
    status: str
    paid_at: datetime | None
    payment_ref: str | None
    collection_attempts: int

    model_config = {"from_attributes": True}


class LoanRequestResponse(BaseModel):
    id: UUID
    credit_score_id: UUID | None
    amount_requested: Decimal
    amount_approved: Decimal | None
    term_days: int | None
    interest_rate: Decimal | None
    lender_id: str | None
    partner_ref: str | None
    rejection_reason: str | None
    disbursement_phone: str | None
    status: str
    requested_at: datetime
    decided_at: datetime | None
    confirmed_at: datetime | None
    disbursed_at: datetime | None
    repaid_at: datetime | None
    defaulted_at: datetime | None

    model_config = {"from_attributes": True}


class LoanConfirmRequest(BaseModel):
    otp: str = Field(..., min_length=4, max_length=8)


# ── Lender-facing schemas ─────────────────────────────────────────────────────


class LenderLoanDecision(BaseModel):
    """Payload for a lender approving or rejecting a loan."""

    amount_approved: Decimal | None = Field(None, gt=0)
    interest_rate: Decimal | None = Field(None, ge=0, le=100)
    term_days: int | None = Field(None, ge=1, le=365)
    partner_ref: str | None = None
    lender_webhook_url: str | None = None
    rejection_reason: str | None = None


class LenderLoanListItem(BaseModel):
    id: UUID
    business_ref: str  # anonymised lender_business_ref, not raw business_id
    amount_requested: Decimal
    credit_score: Decimal | None
    credit_band: str | None
    status: str
    requested_at: datetime
