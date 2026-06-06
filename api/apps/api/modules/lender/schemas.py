"""Lender partner API schemas — all anonymised, no raw PII."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class AnonymizedCreditProfile(BaseModel):
    """Anonymised credit profile returned to lender partners.

    Never contains raw business_id or any personally identifiable fields.
    lender_business_ref is a one-way hash of (business_id + lender_id).
    """

    lender_business_ref: str  # full sha256(business_id+lender_id)
    score: int
    band: str  # A | B | C | D | E
    max_loan_amount: Decimal | None
    account_age_days: int
    revenue_band: str  # low | medium | high | very_high
    repayment_history_summary: str  # "good" | "fair" | "poor" | "no_data"
    computed_at: datetime
    kyc_status: str  # "verified" | "submitted" | "pending" | "not_started"
    monthly_revenue: list[dict]  # [{"month": "Jan", "amount": 12000.0}, ...]
    risk_indicators: list[dict]  # [{"label": str, "value": str, "tone": str}, ...]
    consent_granted_at: datetime | None


class LenderConsentCreate(BaseModel):
    lender_id: str


class LenderConsentResponse(BaseModel):
    id: UUID
    business_id: UUID
    lender_id: str
    is_active: bool
    consented_at: datetime
    revoked_at: datetime | None
    lender_name: str | None = None

    model_config = {"from_attributes": True}


class LoanProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    min_amount_ghs: Decimal = Field(..., gt=0)
    max_amount_ghs: Decimal = Field(..., gt=0)
    interest_rate_annual: Decimal = Field(..., ge=0, le=100)
    min_term_days: int = Field(default=30, ge=1, le=365)
    max_term_days: int = Field(default=365, ge=1, le=365)
    min_credit_band: str = Field(default="C", pattern=r"^[A-E]$")


class LoanProductUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)
    min_amount_ghs: Decimal | None = Field(None, gt=0)
    max_amount_ghs: Decimal | None = Field(None, gt=0)
    interest_rate_annual: Decimal | None = Field(None, ge=0, le=100)
    min_term_days: int | None = Field(None, ge=1, le=365)
    max_term_days: int | None = Field(None, ge=1, le=365)
    min_credit_band: str | None = Field(None, pattern=r"^[A-E]$")
    is_active: bool | None = None


class LoanProductResponse(BaseModel):
    id: UUID
    lender_id: str
    name: str
    description: str
    min_amount_ghs: Decimal
    max_amount_ghs: Decimal
    interest_rate_annual: Decimal
    min_term_days: int
    max_term_days: int
    min_credit_band: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LenderWithProducts(BaseModel):
    lender_id: str
    name: str
    contact_email: str | None
    products: list[LoanProductResponse]


class LenderTokenRequest(BaseModel):
    lender_id: str
    api_key: str


class LenderTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    lender_id: str


class LenderPortalLoginRequest(BaseModel):
    email: str
    password: str


class LenderPortalAuthResponse(BaseModel):
    lender_id: str
    token_type: str = "bearer"
    must_reset_password: bool = False
    access_token: str | None = None
    reset_token: str | None = None


class LenderPasswordResetRequest(BaseModel):
    reset_token: str
    new_password: str = Field(..., min_length=8, max_length=128)
