"""KYC verification endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import RequireRole, get_current_business_id, get_current_user_id
from apps.api.core.exceptions import NotFoundError
from apps.api.modules.kyc.schemas import KYCResponse, KYCReview, KYCStatusPollResponse, KYCSubmit
from apps.api.modules.kyc.service import KYCService

router = APIRouter()


@router.get("/me", response_model=KYCResponse)
async def get_kyc(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> KYCResponse:
    verification = await KYCService(db).get(business_id)
    if not verification:
        raise NotFoundError("KYC verification")
    return KYCResponse.model_validate(verification)


@router.get("/status", response_model=KYCStatusPollResponse)
async def poll_kyc_status(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> KYCStatusPollResponse:
    """Lightweight polling endpoint for mobile KYC status checks."""
    verification = await KYCService(db).get(business_id)
    if not verification:
        return KYCStatusPollResponse(status="not_submitted")
    return KYCStatusPollResponse(
        status=verification.status,  # type: ignore[arg-type]
        failure_reason=verification.failure_reason,
        verified_at=verification.reviewed_at,
    )


@router.post("/submit", response_model=KYCResponse, status_code=201)
async def submit_kyc(
    body: KYCSubmit,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> KYCResponse:
    verification = await KYCService(db).submit(business_id, user_id, body)
    return KYCResponse.model_validate(verification)


@router.post("/review/{business_id}", response_model=KYCResponse)
async def review_kyc(
    business_id: UUID,
    body: KYCReview,
    _role: str = Depends(RequireRole("platform_admin")),
    db: AsyncSession = Depends(get_db),
) -> KYCResponse:
    verification = await KYCService(db).review(business_id, body)
    return KYCResponse.model_validate(verification)
