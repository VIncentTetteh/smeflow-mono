"""Tax endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import (
    RequireFeature,
    RequireRole,
    get_current_business_id,
    require_kyc_verified,
)
from apps.api.modules.tax.schemas import (
    GenerateTaxReturnRequest,
    TaxCalendarEntry,
    TaxFileResponse,
    TaxReturnResponse,
    TaxSummaryResponse,
)
from apps.api.modules.tax.service import TaxService

router = APIRouter()
_require_tax_summary = RequireFeature("tax_summary")
_require_gra_submission = RequireFeature("gra_submission")


@router.get("/summary", response_model=TaxSummaryResponse)
async def tax_summary(
    business_id: UUID = Depends(get_current_business_id),
    period: str = Query("monthly"),
    year: int = Query(...),
    month: int | None = Query(None),
    _feat: None = Depends(_require_tax_summary),
    db: AsyncSession = Depends(get_db),
) -> TaxSummaryResponse:
    if month is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month is required",
        )
    svc = TaxService(db)
    data = await svc.get_summary(business_id, period, year, month)
    return TaxSummaryResponse(**data)


@router.get("/returns", response_model=list[TaxReturnResponse])
async def list_returns(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[TaxReturnResponse]:
    returns = await TaxService(db).list_returns(business_id)
    return [TaxReturnResponse.model_validate(item) for item in returns]


@router.post("/returns/generate", response_model=TaxReturnResponse, status_code=201)
async def generate_return(
    body: GenerateTaxReturnRequest,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    db: AsyncSession = Depends(get_db),
) -> TaxReturnResponse:
    # force_refresh=True so the user always gets fresh figures from current data
    tr = await TaxService(db).generate_monthly_return(
        business_id, body.year, body.month, force_refresh=True
    )
    return TaxReturnResponse.model_validate(tr)


@router.post("/returns/{return_id}/file", response_model=TaxFileResponse)
async def file_return(
    return_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    _feat: None = Depends(_require_gra_submission),
    db: AsyncSession = Depends(get_db),
) -> TaxFileResponse:
    tax_return = await TaxService(db).file_return(business_id, return_id)
    gra_ref = tax_return.gra_ref
    is_dry_run = bool(gra_ref and gra_ref.startswith("DRY-RUN-"))
    return TaxFileResponse(
        id=tax_return.id,
        status=tax_return.status,
        gra_ref=gra_ref,
        export_url=tax_return.export_url or f"local://tax-returns/{tax_return.id}.json",
        is_dry_run=is_dry_run,
    )


@router.get("/returns/{return_id}/export")
async def export_return(
    return_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _kyc: None = Depends(require_kyc_verified),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await TaxService(db).export_return(business_id, return_id)


@router.get("/calendar", response_model=list[TaxCalendarEntry])
async def tax_calendar(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[TaxCalendarEntry]:
    _ = business_id
    svc = TaxService(db)
    return [TaxCalendarEntry(**entry) for entry in svc.calendar(year, month)]
