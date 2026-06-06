"""Referral endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import get_current_user_id
from apps.api.core.middleware import limiter
from apps.api.modules.referral.schemas import (
    ReferralInvite,
    ReferralResponse,
    ReferralStatusResponse,
)
from apps.api.modules.referral.service import ReferralService

router = APIRouter()


@router.get("/my-code")
async def get_my_referral_code(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return (or generate) the caller's personal referral code."""
    svc = ReferralService(db)
    code = await svc.get_or_create_code(user_id)
    await db.commit()
    return {"referral_code": code}


@router.post("/invite", response_model=ReferralResponse, status_code=201)
@limiter.limit("20/day")
async def invite_friend(
    request: Request,
    body: ReferralInvite,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ReferralResponse:
    """Send a referral invitation to a phone number."""
    svc = ReferralService(db)
    referral = await svc.invite(user_id, body.referee_phone)
    await db.commit()
    return ReferralResponse.model_validate(referral)


@router.get("/status", response_model=ReferralStatusResponse)
async def referral_status(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ReferralStatusResponse:
    """Get the caller's referral stats: code, invited count, converted count, reward status."""
    svc = ReferralService(db)
    data = await svc.get_status(user_id)
    await db.commit()
    return ReferralStatusResponse(
        referral_code=data["referral_code"],
        total_invited=data["total_invited"],
        converted=data["converted"],
        pending=data["pending"],
        reward_granted=data["reward_granted"],
        referrals=[ReferralResponse.model_validate(r) for r in data["referrals"]],
    )
