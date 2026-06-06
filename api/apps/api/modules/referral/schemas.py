"""Referral schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ReferralInvite(BaseModel):
    referee_phone: str = Field(
        ..., min_length=9, max_length=15, description="Phone number to invite"
    )


class ReferralResponse(BaseModel):
    id: UUID
    referrer_id: UUID
    referee_phone: str
    status: str
    reward_granted: bool
    converted_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReferralStatusResponse(BaseModel):
    referral_code: str
    total_invited: int
    converted: int
    pending: int
    reward_granted: bool
    referrals: list[ReferralResponse]
