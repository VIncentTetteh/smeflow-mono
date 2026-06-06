"""Business request/response schemas."""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from apps.api.core.phone import normalize_ghana_phone

BUSINESS_TYPES = Literal[
    "market_stall",
    "shop",
    "artisan",
    "restaurant",
    "pharmacy",
    "salon",
    "transport",
    "agriculture",
    "service",
    "other",
]

MOMO_PROVIDERS = Literal["mtn", "vodafone", "airteltigo"]
MEMBER_ROLES = Literal["owner", "manager", "staff"]
PREFERRED_LANGUAGES = Literal["en", "tw", "ee", "gaa", "pcm"]
TAX_VAT_STATUS = Literal["unknown", "not_registered", "registered", "exempt"]


class BusinessTemplateResponse(BaseModel):
    slug: str
    label: str
    type: str
    default_unit: str
    recommended_features: list[str]


# ── Business ──────────────────────────────────────────────────────────────────
class BusinessCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: BUSINESS_TYPES
    tin: str | None = Field(None, max_length=20)
    ghana_card_ref: str | None = Field(None, max_length=50)
    address: str | None = Field(None, max_length=500)
    region: str | None = Field(None, max_length=100)
    city: str | None = Field(None, max_length=100)
    market: str | None = Field(None, max_length=150)
    preferred_language: PREFERRED_LANGUAGES = "en"
    momo_provider: MOMO_PROVIDERS | None = None
    tax_vat_status: TAX_VAT_STATUS = "unknown"
    template_slug: str | None = Field(None, max_length=80)
    location_lat: Decimal | None = None
    location_lng: Decimal | None = None
    onboarding_channel: str | None = Field(None, max_length=30)
    onboarding_agent_id: UUID | None = None


class BusinessUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    type: BUSINESS_TYPES | None = None
    tin: str | None = Field(None, max_length=20)
    ghana_card_ref: str | None = Field(None, max_length=50)
    address: str | None = Field(None, max_length=500)
    region: str | None = Field(None, max_length=100)
    city: str | None = Field(None, max_length=100)
    market: str | None = Field(None, max_length=150)
    preferred_language: PREFERRED_LANGUAGES | None = None
    momo_provider: MOMO_PROVIDERS | None = None
    tax_vat_status: TAX_VAT_STATUS | None = None
    template_slug: str | None = Field(None, max_length=80)
    location_lat: Decimal | None = None
    location_lng: Decimal | None = None


class BusinessResponse(BaseModel):
    id: UUID
    name: str
    type: str
    tin: str | None
    address: str | None
    subscription: str
    sub_expires_at: datetime | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class BusinessDetailResponse(BusinessResponse):
    owner_id: UUID
    ghana_card_ref: str | None
    ghqr_merchant_id: str | None
    dva_id: str | None = None
    dva_account_number: str | None = None
    dva_account_name: str | None = None
    dva_bank_name: str | None = None
    location_lat: Decimal | None
    location_lng: Decimal | None


class BusinessMembershipResponse(BaseModel):
    business_id: UUID
    business_name: str
    role: str
    is_active: bool
    subscription: str
    is_current: bool = False


# ── Members ───────────────────────────────────────────────────────────────────
class MemberInvite(BaseModel):
    phone: str = Field(..., description="Ghana phone number of the new member")
    role: MEMBER_ROLES = "staff"

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        return normalize_ghana_phone(v)


class MemberUpdate(BaseModel):
    role: MEMBER_ROLES | None = None
    is_active: bool | None = None


class MemberResponse(BaseModel):
    id: UUID
    user_id: UUID
    role: str
    is_active: bool
    joined_at: datetime
    user_name: str | None = None
    user_phone: str | None = None

    model_config = {"from_attributes": True}


# ── MoMo Accounts ─────────────────────────────────────────────────────────────
class MoMoAccountAdd(BaseModel):
    provider: MOMO_PROVIDERS
    phone: str
    account_name: str | None = None
    is_primary: bool = False

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        return normalize_ghana_phone(v)


class MoMoAccountUpdate(BaseModel):
    phone: str | None = None
    account_name: str | None = Field(None, max_length=255)
    is_primary: bool | None = None

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str | None) -> str | None:
        return normalize_ghana_phone(v) if v else v


class MoMoAccountVerify(BaseModel):
    status: Literal["verified", "failed"]
    verification_ref: str | None = Field(None, max_length=100)
    failure_reason: str | None = Field(None, max_length=255)


class MoMoAccountResponse(BaseModel):
    id: UUID
    provider: str
    phone: str
    account_name: str | None
    is_primary: bool
    is_verified: bool
    status: str = "pending"
    verified_at: datetime | None = None
    verification_ref: str | None = None
    failure_reason: str | None = None

    model_config = {"from_attributes": True}
