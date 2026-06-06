"""KYC request and response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from apps.api.core.gh_identifiers import GHANA_CARD_PATTERN, TIN_PATTERN

# Exhaustive list of document types accepted by SMEflow KYC.
# Adding new types requires a schema migration and re-deploy.
_KYCDocumentType = Literal[
    "ghana_card_front",
    "ghana_card_back",
    "business_registration",
    "tin_certificate",
    "utility_bill",
]


class KYCDocument(BaseModel):
    """A single KYC verification document record."""

    document_type: _KYCDocumentType
    url: str = Field(..., max_length=500)
    # Optional SHA-256 hex digest for client-side integrity verification.
    sha256: str | None = Field(None, min_length=64, max_length=64)


class KYCSubmit(BaseModel):
    ghana_card_id: str | None = Field(None, pattern=GHANA_CARD_PATTERN)
    tin: str | None = Field(None, pattern=TIN_PATTERN)
    business_registration_ref: str | None = Field(None, max_length=100)
    documents: list[KYCDocument] = Field(default_factory=list, max_length=10)


class KYCReview(BaseModel):
    status: Literal["verified", "failed", "pending"]
    provider: str | None = Field(None, max_length=50)
    provider_ref: str | None = Field(None, max_length=100)
    failure_reason: str | None = None


class KYCStatusPollResponse(BaseModel):
    """Lightweight status response for mobile polling."""

    status: Literal["pending", "verified", "failed", "not_submitted"]
    failure_reason: str | None = None
    verified_at: datetime | None = None


class KYCResponse(BaseModel):
    id: UUID
    business_id: UUID
    user_id: UUID
    ghana_card_id: str | None
    tin: str | None
    business_registration_ref: str | None
    status: str
    provider: str | None
    provider_ref: str | None
    failure_reason: str | None
    documents: list[KYCDocument]
    submitted_at: datetime
    reviewed_at: datetime | None

    model_config = {"from_attributes": True}
