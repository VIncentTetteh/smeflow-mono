"""Business endpoints: create, update profile, members, MoMo accounts."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import RequireRole, get_current_business_id, get_current_user_id
from apps.api.core.exceptions import NotFoundError
from apps.api.modules.business.repository import BusinessRepository
from apps.api.modules.business.schemas import (
    BusinessCreate,
    BusinessDetailResponse,
    BusinessResponse,
    BusinessTemplateResponse,
    BusinessUpdate,
    MemberInvite,
    MemberResponse,
    MemberUpdate,
    MoMoAccountAdd,
    MoMoAccountResponse,
    MoMoAccountUpdate,
    MoMoAccountVerify,
)
from apps.api.modules.business.service import BusinessService
from apps.api.modules.business.dva_service import DVAService
from apps.api.modules.kyc.service import KYCService

router = APIRouter()


class SuspensionAppealCreate(BaseModel):
    reason: str
    evidence_url: str | None = None


GHANA_BUSINESS_TEMPLATES = [
    BusinessTemplateResponse(
        slug="retail_shop",
        label="Retail shop",
        type="shop",
        default_unit="piece",
        recommended_features=["sales", "stock", "receipts", "momo_tracking"],
    ),
    BusinessTemplateResponse(
        slug="pharmacy",
        label="Pharmacy",
        type="pharmacy",
        default_unit="pack",
        recommended_features=["batch_stock", "low_stock_alerts", "receipts", "tax_summary"],
    ),
    BusinessTemplateResponse(
        slug="provision_store",
        label="Provision store",
        type="shop",
        default_unit="piece",
        recommended_features=["sales", "stock", "customer_credit", "supplier_restock"],
    ),
    BusinessTemplateResponse(
        slug="market_trader",
        label="Market trader",
        type="market_stall",
        default_unit="bowl",
        recommended_features=["offline_sales", "momo_tracking", "customer_credit"],
    ),
    BusinessTemplateResponse(
        slug="services",
        label="Services",
        type="service",
        default_unit="job",
        recommended_features=["invoices", "receipts", "whatsapp_reminders"],
    ),
    BusinessTemplateResponse(
        slug="wholesaler",
        label="Wholesaler",
        type="shop",
        default_unit="carton",
        recommended_features=["bulk_sales", "customer_credit", "supplier_restock"],
    ),
    BusinessTemplateResponse(
        slug="agro_inputs",
        label="Agro-inputs",
        type="agriculture",
        default_unit="bag",
        recommended_features=["stock", "seasonal_restock", "customer_credit"],
    ),
]


@router.get("/templates", response_model=dict)
async def list_business_templates() -> dict:
    """Return Ghana-specific setup templates and onboarding metadata fields."""
    return {
        "items": [template.model_dump() for template in GHANA_BUSINESS_TEMPLATES],
        "onboarding_fields": [
            "region",
            "city",
            "market",
            "business_category",
            "preferred_language",
            "momo_provider",
            "tax_vat_status",
        ],
        "languages": [
            {"code": "en", "label": "English"},
            {"code": "tw", "label": "Twi"},
            {"code": "ee", "label": "Ewe"},
            {"code": "gaa", "label": "Ga"},
            {"code": "pcm", "label": "Pidgin"},
        ],
        "momo_providers": ["mtn", "vodafone", "airteltigo"],
        "tax_vat_statuses": ["unknown", "not_registered", "registered", "exempt"],
    }


@router.post("", response_model=dict, status_code=201)
async def create_business(
    body: BusinessCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a new business profile. Returns business + a new scoped access token."""
    service = BusinessService(db)
    business, token = await service.create_business(owner_id=user_id, data=body)
    return {
        "business": BusinessResponse.model_validate(business),
        "access_token": token,
        "message": "Business created. Use the new access_token for subsequent requests.",
    }


@router.get("/me", response_model=BusinessDetailResponse)
async def get_my_business(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> BusinessDetailResponse:
    """Return the current business profile."""
    repo = BusinessRepository(db)
    business = await repo.get_by_id(business_id)
    if not business:
        raise NotFoundError("Business")
    return BusinessDetailResponse.model_validate(business)


@router.get("/dashboard-summary")
async def get_dashboard_summary(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Combined home-dashboard payload — replaces 7 parallel mobile API calls with one.

    Returns: daily_summary, merchant_alerts (top 3), credit_score, tax_summary.
    All sub-queries run in parallel. Individual failures return null for that section
    rather than failing the whole response, so the home screen always loads.
    """
    import asyncio
    from datetime import date

    from apps.api.modules.analytics.service import AnalyticsService
    from apps.api.modules.credit.service import CreditService
    from apps.api.modules.notifications.service import NotificationService
    from apps.api.modules.sales.service import SalesService
    from apps.api.modules.tax.service import TaxService

    today = date.today().isoformat()

    async def _daily():
        try:
            return await SalesService(db).get_daily_summary(business_id, today)
        except Exception:
            return None

    async def _alerts():
        try:
            return await NotificationService(db).get_merchant_alerts(
                business_id, view="attention", limit=3
            )
        except Exception:
            return {"items": [], "unread_count": 0}

    async def _credit():
        try:
            return await CreditService(db).get_credit_score(business_id)
        except Exception:
            return None

    async def _tax():
        try:
            return await TaxService(db).get_workspace_summary(business_id)
        except Exception:
            return None

    async def _low_stock():
        try:
            items = await AnalyticsService(db).low_stock_items(business_id)
            return items[:5]
        except Exception:
            return []

    daily, alerts, credit, tax, low_stock = await asyncio.gather(
        _daily(), _alerts(), _credit(), _tax(), _low_stock()
    )

    return {
        "daily_summary": daily,
        "alerts": alerts,
        "credit_score": credit,
        "tax_summary": tax,
        "low_stock_preview": low_stock,
        "generated_at": date.today().isoformat(),
    }


@router.post("/support/appeal", status_code=201)
async def submit_suspension_appeal(
    body: SuspensionAppealCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from apps.api.modules.admin.models import SuspensionAppeal

    appeal = SuspensionAppeal(
        business_id=business_id,
        submitted_by=user_id,
        reason=body.reason,
        evidence_url=body.evidence_url,
    )
    db.add(appeal)
    await db.commit()
    return {"appeal_id": str(appeal.id), "status": appeal.status}


@router.patch("/me", response_model=BusinessDetailResponse)
async def update_my_business(
    body: BusinessUpdate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> BusinessDetailResponse:
    """Update business profile (owner or manager only)."""
    service = BusinessService(db)
    business = await service.update_business(business_id, user_id, body)
    return BusinessDetailResponse.model_validate(business)


@router.post("/dva/provision")
async def provision_dedicated_account(
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Retry dedicated virtual account provisioning after business KYC is verified."""
    verification = await KYCService(db).get(business_id)
    if not verification or verification.status != "verified":
        raise HTTPException(
            status_code=409,
            detail="Business KYC must be verified before a dedicated account can be provisioned.",
        )

    account = await DVAService(db).provision_for_business(business_id)
    await db.commit()
    if not account:
        return {
            "status": "pending",
            "provisioned": False,
            "message": "Dedicated account provisioning is pending. Confirm Paystack is configured and try again.",
        }
    return {
        "status": "provisioned",
        "provisioned": True,
        "account": account,
    }


# ── Members ───────────────────────────────────────────────────────────────────
@router.get("/members", response_model=list[MemberResponse])
async def list_members(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[MemberResponse]:
    repo = BusinessRepository(db)
    members = await repo.get_members(business_id)
    result = []
    for m in members:
        result.append(
            MemberResponse(
                id=m.id,
                user_id=m.user_id,
                role=m.role,
                is_active=m.is_active,
                joined_at=m.joined_at,
                user_name=m.user.name if m.user else None,
                user_phone=m.user.phone if m.user else None,
            )
        )
    return result


@router.post("/members/invite", response_model=MemberResponse, status_code=201)
async def invite_member(
    body: MemberInvite,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> MemberResponse:
    """Invite a staff member by phone number."""
    service = BusinessService(db)
    member = await service.invite_member(business_id, body.phone, body.role)
    return MemberResponse(
        id=member.id,
        user_id=member.user_id,
        role=member.role,
        is_active=member.is_active,
        joined_at=member.joined_at,
    )


@router.patch("/members/{member_id}", response_model=MemberResponse)
async def update_member(
    member_id: UUID,
    body: MemberUpdate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> MemberResponse:
    """Update a member's role or active status."""
    service = BusinessService(db)
    member = await service.update_member(business_id, member_id, body)
    return MemberResponse(
        id=member.id,
        user_id=member.user_id,
        role=member.role,
        is_active=member.is_active,
        joined_at=member.joined_at,
        user_name=member.user.name if member.user else None,
        user_phone=member.user.phone if member.user else None,
    )


@router.delete("/members/{member_id}", status_code=204)
async def deactivate_member(
    member_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Deactivate a member without deleting their user account."""
    service = BusinessService(db)
    await service.deactivate_member(business_id, member_id)


# ── MoMo Accounts ─────────────────────────────────────────────────────────────
@router.get("/momo-accounts", response_model=list[MoMoAccountResponse])
async def list_momo_accounts(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[MoMoAccountResponse]:
    repo = BusinessRepository(db)
    business = await repo.get_by_id(business_id)
    if not business:
        raise NotFoundError("Business")
    return [MoMoAccountResponse.model_validate(a) for a in business.momo_accounts]


@router.post("/momo-accounts", response_model=MoMoAccountResponse, status_code=201)
async def add_momo_account(
    body: MoMoAccountAdd,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> MoMoAccountResponse:
    """Link a mobile money account (MTN, Vodafone, AirtelTigo)."""
    service = BusinessService(db)
    account = await service.add_momo_account(business_id, body)
    return MoMoAccountResponse.model_validate(account)


@router.patch("/momo-accounts/{account_id}", response_model=MoMoAccountResponse)
async def update_momo_account(
    account_id: UUID,
    body: MoMoAccountUpdate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> MoMoAccountResponse:
    service = BusinessService(db)
    account = await service.update_momo_account(business_id, account_id, body)
    return MoMoAccountResponse.model_validate(account)


@router.delete("/momo-accounts/{account_id}", status_code=204)
async def delete_momo_account(
    account_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> None:
    service = BusinessService(db)
    await service.delete_momo_account(business_id, account_id)


@router.post("/momo-accounts/{account_id}/set-primary", response_model=MoMoAccountResponse)
async def set_primary_momo_account(
    account_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> MoMoAccountResponse:
    service = BusinessService(db)
    account = await service.set_primary_momo_account(business_id, account_id)
    return MoMoAccountResponse.model_validate(account)


@router.post("/momo-accounts/{account_id}/verify", response_model=MoMoAccountResponse)
async def verify_momo_account(
    account_id: UUID,
    body: MoMoAccountVerify,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> MoMoAccountResponse:
    service = BusinessService(db)
    account = await service.verify_momo_account(business_id, account_id, body)
    return MoMoAccountResponse.model_validate(account)
