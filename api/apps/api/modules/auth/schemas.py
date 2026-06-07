"""Auth request/response schemas."""

from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from apps.api.core.gh_identifiers import GHANA_CARD_PATTERN, TIN_PATTERN
from apps.api.core.phone import normalize_ghana_phone


def validate_gh_phone(phone: str) -> str:
    """Normalize and validate a Ghana phone number to E.164 format (+233XXXXXXXXX)."""
    return normalize_ghana_phone(phone)


# ── OTP ───────────────────────────────────────────────────────────────────────
class OTPRequest(BaseModel):
    phone: str = Field(..., description="Ghana phone number (e.g. +233244123456 or 0244123456)")

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        return validate_gh_phone(v)


class OTPVerify(BaseModel):
    phone: str
    otp: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        return validate_gh_phone(v)


class OTPRequestResponse(BaseModel):
    success: bool = True
    message: str = "OTP sent successfully"
    expires_in_seconds: int = 300


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: UUID
    business_id: UUID | None = None
    role: str = "none"
    is_new_user: bool = False


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class BusinessSwitchRequest(BaseModel):
    business_id: UUID


# ── User profile ──────────────────────────────────────────────────────────────
class UserUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    ghana_card_id: str | None = Field(None, pattern=GHANA_CARD_PATTERN)
    tin: str | None = Field(None, pattern=TIN_PATTERN)


class UserResponse(BaseModel):
    id: UUID
    phone: str
    name: str | None
    ghana_card_id: str | None
    tin: str | None
    kyc_status: str = "unverified"
    is_active: bool

    model_config = {"from_attributes": True}


# ── KYC ───────────────────────────────────────────────────────────────────────
class KYCSubmitRequest(BaseModel):
    ghana_card_id: str = Field(..., pattern=GHANA_CARD_PATTERN)


class KYCStatusResponse(BaseModel):
    user_id: UUID
    kyc_status: str  # unverified | pending | verified | rejected
    kyc_submitted_at: str | None = None
    kyc_verified_at: str | None = None

    model_config = {"from_attributes": True}
