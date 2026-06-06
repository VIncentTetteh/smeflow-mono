"""Agent Network router."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import get_current_user_id
from apps.api.core.phone import normalize_ghana_phone
from apps.api.modules.agent_network.service import AgentNetworkService
from apps.api.modules.business.schemas import BusinessCreate, MoMoAccountAdd, MoMoAccountResponse
from apps.api.modules.business.service import BusinessService
from apps.api.modules.kyc.schemas import KYCResponse, KYCSubmit
from apps.api.modules.kyc.service import KYCService

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────


class RegisterAgentRequest(BaseModel):
    region: str | None = None
    district: str | None = None
    momo_phone: str | None = None


class AttributeRequest(BaseModel):
    business_id: UUID
    channel: str = "field"
    referral_code: str | None = None


class TriggerCommissionRequest(BaseModel):
    business_id: UUID
    trigger: str  # onboarding | first_sale | subscription_upgrade | monthly_activity


class AgentOnboardingStartRequest(BaseModel):
    phone: str
    name: str | None = None


class AgentOnboardingStartResponse(BaseModel):
    user_id: UUID
    phone: str
    is_new_user: bool


class AgentBusinessOnboardingRequest(BusinessCreate):
    trader_user_id: UUID
    referral_code: str | None = None


class AgentOnboardRequest(BusinessCreate):
    phone: str
    trader_name: str | None = None
    referral_code: str | None = None


class MarkPaidRequest(BaseModel):
    commission_ids: list[UUID]
    paid_via: str = "manual"  # momo | manual | bank


class BulkCommissionPayoutRequest(BaseModel):
    commission_ids: list[UUID]
    payout_method: str = "momo"  # momo | bank | manual


class BulkOnboardingTrader(BaseModel):
    phone: str
    name: str | None = None
    business_name: str
    business_type: str = "other"
    address: str | None = None
    referral_code: str | None = None


class BulkOnboardingRequest(BaseModel):
    traders: list[BulkOnboardingTrader]


class AgentResponse(BaseModel):
    id: UUID
    user_id: UUID
    region: str | None
    district: str | None
    momo_phone: str | None = None
    is_active: bool
    onboarded_count: int
    total_commission_earned: Decimal

    model_config = {"from_attributes": True}


class AgentApplicationResponse(BaseModel):
    id: UUID
    user_id: UUID
    region: str | None
    district: str | None
    momo_phone: str | None
    status: str

    model_config = {"from_attributes": True}


@router.get("/agents")
async def list_all_agents(
    region: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
) -> dict:
    agents, total = await AgentNetworkService(db).list_agents(
        region=region, limit=limit, offset=offset
    )
    return {
        "total": total,
        "items": [AgentResponse.model_validate(agent).model_dump(mode="json") for agent in agents],
    }


# ── Agent self-registration ───────────────────────────────────────────────────


@router.post("/register", response_model=AgentResponse, status_code=201)
async def register_agent(
    body: RegisterAgentRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> AgentResponse:
    """Register a user as an active field agent."""
    svc = AgentNetworkService(db)
    momo_phone = normalize_ghana_phone(body.momo_phone) if body.momo_phone else None
    agent = await svc.register_agent(user_id, body.region, body.district, momo_phone)
    await db.commit()
    return AgentResponse.model_validate(agent)


# ── Agent dashboard ───────────────────────────────────────────────────────────


async def _build_full_dashboard(agent_id: UUID, user_id: UUID, svc: AgentNetworkService, db: AsyncSession) -> dict:
    """Build the full dashboard payload matching AgentDashboardDto."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent

    now = datetime.now(timezone.utc)
    base = await svc.agent_dashboard(agent_id)
    period = await svc.commission_period_summary(agent_id, now.year, now.month)
    target = await svc.get_agent_target(agent_id, now.year, now.month)
    active_traders = await svc.count_traders_by_status(agent_id, "active")
    pending_onboardings = await svc.count_traders_by_status(agent_id, "registered")

    # Agent name for the mobile header
    from apps.api.modules.auth.models import User
    user_row = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()

    return {
        **base,
        "name": user_row.name if user_row else None,
        "completed": base["onboarded_count"],
        "target": target,
        "active_traders": active_traders,
        "pending_onboardings": pending_onboardings,
        "period_commission": str(period["grand_total"]),
        "commissions_due": str(period["pending_total"]),
    }


@router.get("/me")
async def my_dashboard(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Current agent's full dashboard summary."""
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent, AgentApplication

    agent = (await db.execute(select(Agent).where(Agent.user_id == user_id))).scalar_one_or_none()
    if agent:
        svc = AgentNetworkService(db)
        return await _build_full_dashboard(agent.id, user_id, svc, db)

    application = (await db.execute(select(AgentApplication).where(AgentApplication.user_id == user_id))).scalar_one_or_none()
    if application:
        return {
            "application_status": application.status,
            "region": application.region,
            "district": application.district,
            "momo_phone": application.momo_phone,
            "onboarded_count": 0,
            "completed": 0,
            "target": 0,
            "active_traders": 0,
            "pending_onboardings": 0,
            "period_commission": "0.00",
            "commissions_due": "0.00",
        }

    return {"error": "Not registered as an agent"}


@router.get("/dashboard")
async def agent_dashboard_endpoint(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Dashboard alias — returns same full payload as /me."""
    return await my_dashboard(user_id, db)


@router.patch("/me")
async def update_agent_profile(
    body: RegisterAgentRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> AgentResponse:
    """Update agent's region, district, or MoMo phone."""
    agent_id = await _current_agent_id(user_id, db)
    updates: dict = {}
    if body.region is not None:
        updates["region"] = body.region
    if body.district is not None:
        updates["district"] = body.district
    if body.momo_phone is not None:
        updates["momo_phone"] = normalize_ghana_phone(body.momo_phone)

    svc = AgentNetworkService(db)
    agent = await svc.update_agent(agent_id, updates)
    if body.momo_phone:
        try:
            await svc.ensure_recipient_code(agent)
        except Exception:
            pass  # never block the update; payout will retry lazily
    await db.commit()
    return AgentResponse.model_validate(agent)


@router.get("/me/referral-code")
async def get_agent_referral_code(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return the agent's referral code for QR sharing."""
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent

    agent = (await db.execute(select(Agent).where(Agent.user_id == user_id))).scalar_one_or_none()
    if not agent:
        from fastapi import HTTPException
        raise HTTPException(404, "Not registered as an agent")

    # Generate deterministic short code from agent id if not yet stored
    code = f"AG-{str(agent.id).replace('-', '').upper()[:8]}"
    return {
        "referral_code": code,
        "agent_id": str(agent.id),
        "deep_link": f"https://app.smeflow.co/join?ref={code}",
        "qr_data": f"https://app.smeflow.co/join?ref={code}",
    }


async def _current_agent_id(user_id: UUID, db: AsyncSession) -> UUID:
    from fastapi import HTTPException
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent

    result = await db.execute(
        select(Agent).where(Agent.user_id == user_id, Agent.is_active.is_(True))
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "Not registered as an active agent")
    return agent.id


# ── Agent-assisted trader onboarding ──────────────────────────────────────────


@router.post("/onboarding/start", response_model=AgentOnboardingStartResponse, status_code=201)
async def start_trader_onboarding(
    body: AgentOnboardingStartRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> AgentOnboardingStartResponse:
    """Create or resume a trader user by phone for field onboarding."""
    await _current_agent_id(user_id, db)
    from sqlalchemy import select

    from apps.api.core.exceptions import ConflictError
    from apps.api.modules.agent_network.models import Agent
    from apps.api.modules.auth.repository import UserRepository

    phone = normalize_ghana_phone(body.phone)
    repo = UserRepository(db)
    user = await repo.get_by_phone(phone)
    if user:
        existing_agent = await db.scalar(select(Agent).where(Agent.user_id == user.id).limit(1))
        if existing_agent:
            raise ConflictError("Phone is already registered to an agent account")
        if body.name and not user.name:
            user = await repo.update(user, name=body.name)
        is_new = False
    else:
        user = await repo.create(phone=phone, name=body.name)
        is_new = True
    await db.commit()
    return AgentOnboardingStartResponse(user_id=user.id, phone=user.phone, is_new_user=is_new)


@router.post("/onboarding/business", status_code=201)
async def create_trader_business(
    body: AgentBusinessOnboardingRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a trader business and attribute it to the current field agent.

    Idempotent: if the trader already has an active business with the same name,
    the existing business is used rather than returning a conflict error.
    """
    agent_id = await _current_agent_id(user_id, db)
    business_service = BusinessService(db)
    token: str | None = None
    try:
        business, token = await business_service.create_business(body.trader_user_id, body)
    except Exception as exc:
        from apps.api.core.exceptions import ConflictError
        from apps.api.modules.business.repository import BusinessRepository

        if not isinstance(exc, ConflictError) or "already have a business" not in str(exc):
            raise
        existing = await BusinessRepository(db).get_by_owner_and_name(
            body.trader_user_id, body.name
        )
        if not existing:
            raise
        business = existing

    referral = await AgentNetworkService(db).get_or_attribute_onboarding(
        agent_id, business.id, "field", body.referral_code
    )
    await db.commit()
    return {
        "business_id": str(business.id),
        "trader_user_id": str(body.trader_user_id),
        "access_token": token,
        "referral_id": str(referral.id),
        "status": referral.status,
    }


@router.post("/onboard", status_code=201)
async def onboard_trader(
    body: AgentOnboardRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """One-step agent-assisted onboarding flow from the Phase 3 plan."""
    agent_id = await _current_agent_id(user_id, db)
    from apps.api.modules.auth.repository import UserRepository

    phone = normalize_ghana_phone(body.phone)
    repo = UserRepository(db)
    trader = await repo.get_by_phone(phone)
    is_new_user = trader is None
    if not trader:
        trader = await repo.create(phone=phone, name=body.trader_name)
    elif body.trader_name and not trader.name:
        trader = await repo.update(trader, name=body.trader_name)

    business_body = BusinessCreate(
        **body.model_dump(exclude={"phone", "trader_name", "referral_code"})
    )
    business, token = await BusinessService(db).create_business(trader.id, business_body)
    referral = await AgentNetworkService(db).get_or_attribute_onboarding(
        agent_id, business.id, "field", body.referral_code
    )
    await db.commit()
    return {
        "business_id": str(business.id),
        "trader_user_id": str(trader.id),
        "phone": trader.phone,
        "is_new_user": is_new_user,
        "access_token": token,
        "referral_id": str(referral.id),
        "status": referral.status,
    }


@router.post(
    "/onboarding/business/{business_id}/wallet", response_model=MoMoAccountResponse, status_code=201
)
async def add_trader_wallet(
    business_id: UUID,
    body: MoMoAccountAdd,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> MoMoAccountResponse:
    await _current_agent_id(user_id, db)
    account = await BusinessService(db).add_momo_account(business_id, body)
    await db.commit()
    return MoMoAccountResponse.model_validate(account)


@router.post("/onboarding/business/{business_id}/kyc", response_model=KYCResponse, status_code=201)
async def submit_trader_kyc(
    business_id: UUID,
    body: KYCSubmit,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> KYCResponse:
    await _current_agent_id(user_id, db)
    verification = await KYCService(db).submit(business_id, user_id, body)
    await db.commit()
    return KYCResponse.model_validate(verification)


@router.post("/onboarding/bulk", status_code=200)
async def bulk_onboard_traders(
    body: BulkOnboardingRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Bulk-onboard up to 50 traders in a single request.

    Each item requires: phone, business_name.
    Optional: name, business_type, address, referral_code.

    Returns a summary of created merchants and any per-item errors.
    """
    if len(body.traders) > 50:
        from fastapi import HTTPException

        raise HTTPException(400, "Maximum 50 traders per bulk request")

    agent_id = await _current_agent_id(user_id, db)
    svc = AgentNetworkService(db)
    result = await svc.bulk_onboard_traders(agent_id, [t.model_dump() for t in body.traders])
    await db.commit()
    return result


@router.get("/traders")
async def list_my_traders(
    status: str | None = Query(
        None, description="Filter by referral status (registered|active|churned)"
    ),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List traders onboarded by the current agent, with business details."""
    agent_id = await _current_agent_id(user_id, db)
    svc = AgentNetworkService(db)
    items, total = await svc.get_trader_list(agent_id, status, limit, offset)
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.get("/traders/{business_id}")
async def get_trader_detail(
    business_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Full detail for a single trader in this agent's pipeline."""
    from fastapi import HTTPException

    agent_id = await _current_agent_id(user_id, db)
    try:
        return await AgentNetworkService(db).get_trader_detail(agent_id, business_id)
    except Exception as exc:
        from apps.api.core.exceptions import NotFoundError
        if isinstance(exc, NotFoundError):
            raise HTTPException(404, str(exc)) from exc
        raise


@router.post("/onboarding/business/{business_id}/complete")
async def complete_trader_onboarding(
    business_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    agent_id = await _current_agent_id(user_id, db)
    referral = await AgentNetworkService(db).get_or_attribute_onboarding(
        agent_id, business_id, "field"
    )
    referral.status = "active"
    from datetime import datetime, timezone

    referral.activated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"business_id": str(business_id), "status": referral.status}


# ── Merchant onboarding attribution ──────────────────────────────────────────


@router.post("/attribute")
async def attribute_onboarding(
    body: AttributeRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Attribute a merchant onboarding to the current agent."""
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent

    result = await db.execute(select(Agent).where(Agent.user_id == user_id))
    agent = result.scalar_one_or_none()
    if not agent:
        from fastapi import HTTPException

        raise HTTPException(404, "Not registered as an agent")

    svc = AgentNetworkService(db)
    referral = await svc.attribute_onboarding(
        agent.id, body.business_id, body.channel, body.referral_code
    )
    await db.commit()
    return {
        "referral_id": str(referral.id),
        "agent_id": str(referral.agent_id),
        "business_id": str(referral.business_id),
        "channel": referral.channel,
        "status": referral.status,
    }


# ── Commission management ─────────────────────────────────────────────────────


@router.post("/commissions/trigger")
async def trigger_commission(
    body: TriggerCommissionRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Manually trigger a commission event (internal use / webhook)."""
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent

    result = await db.execute(select(Agent).where(Agent.user_id == user_id))
    agent = result.scalar_one_or_none()
    if not agent:
        from fastapi import HTTPException

        raise HTTPException(404, "Not registered as an agent")

    svc = AgentNetworkService(db)
    commission = await svc.trigger_commission(agent.id, body.business_id, body.trigger)
    await db.commit()
    if not commission:
        return {"message": f"Unknown trigger '{body.trigger}'"}
    return {
        "commission_id": str(commission.id),
        "trigger": commission.trigger,
        "amount": commission.amount,
        "status": commission.status,
    }


@router.get("/commissions")
async def list_commissions(
    status: str | None = Query(None),
    from_date: str | None = Query(None, description="ISO date YYYY-MM-DD — filter commissions from this date"),
    to_date: str | None = Query(None, description="ISO date YYYY-MM-DD — filter commissions up to this date"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List commissions for the current agent with optional status and date-range filters."""
    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent, AgentCommission

    result = await db.execute(select(Agent).where(Agent.user_id == user_id))
    agent = result.scalar_one_or_none()
    if not agent:
        from fastapi import HTTPException
        raise HTTPException(404, "Not registered as an agent")

    # Build query with optional date range
    query = select(AgentCommission).where(AgentCommission.agent_id == agent.id)
    count_q = select(__import__("sqlalchemy", fromlist=["func"]).func.count(AgentCommission.id)).where(AgentCommission.agent_id == agent.id)
    if status:
        query = query.where(AgentCommission.status == status)
        count_q = count_q.where(AgentCommission.status == status)
    if from_date:
        from datetime import date
        fd = date.fromisoformat(from_date)
        query = query.where(__import__("sqlalchemy", fromlist=["func"]).func.date(AgentCommission.created_at) >= fd)
        count_q = count_q.where(__import__("sqlalchemy", fromlist=["func"]).func.date(AgentCommission.created_at) >= fd)
    if to_date:
        from datetime import date
        td = date.fromisoformat(to_date)
        query = query.where(__import__("sqlalchemy", fromlist=["func"]).func.date(AgentCommission.created_at) <= td)
        count_q = count_q.where(__import__("sqlalchemy", fromlist=["func"]).func.date(AgentCommission.created_at) <= td)

    total = (await db.execute(count_q)).scalar_one()
    commissions = (await db.execute(query.order_by(AgentCommission.created_at.desc()).limit(limit).offset(offset))).scalars().all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(c.id),
                "business_id": str(c.business_id),
                "trigger": c.trigger,
                "amount": str(c.amount),
                "status": c.status,
                "available_at": c.available_at.isoformat() if c.available_at else None,
                "paid_at": c.paid_at.isoformat() if c.paid_at else None,
                "paid_via": c.paid_via,
                "created_at": c.created_at.isoformat(),
            }
            for c in commissions
        ],
    }


# ── Commission dashboard ──────────────────────────────────────────────────────


@router.get("/commissions/summary")
async def commission_period_summary(
    period: str | None = Query(None, description="day | week | month (convenience alias)"),
    year: int | None = Query(None, ge=2020, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Return commission summary for the agent.

    Accepts either:
    - ``period=month`` (day|week|month) — uses current calendar month/year.
    - ``year=YYYY&month=MM`` — explicit calendar month.

    Always returns ``{onboarded, earned, pending}`` for the agent dashboard,
    plus the detailed ``by_trigger`` breakdown.
    """
    from datetime import datetime, timezone

    from sqlalchemy import select

    from apps.api.modules.agent_network.models import Agent

    agent_id = await _current_agent_id(user_id, db)

    # Resolve year/month from period string if explicit values not supplied
    now = datetime.now(timezone.utc)
    if year is None or month is None:
        year = now.year
        month = now.month

    svc = AgentNetworkService(db)
    detail = await svc.commission_period_summary(agent_id, year, month)

    # Also grab all-time onboarded count from the Agent row
    agent = (await db.execute(select(Agent).where(Agent.id == agent_id))).scalar_one_or_none()
    onboarded = agent.onboarded_count if agent else 0

    return {
        "onboarded": onboarded,
        "earned": float(detail["grand_total"]),
        "pending": float(detail["pending_total"]),
        # keep the detailed breakdown for callers that want it
        "period": detail["period"],
        "by_trigger": detail["by_trigger"],
    }


@router.post("/commissions/mark-paid")
async def mark_commissions_paid(
    request: Request,
    body: MarkPaidRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Mark a list of pending commissions as paid.

    **Restricted to platform_admin only.**  The endpoint validates the bearer
    token carries role=platform_admin and that the admin account exists in the
    DB.  Regular agent tokens are rejected.

    body.paid_via: how the payout was made — 'momo' | 'manual' | 'bank'
    """
    from apps.api.modules.admin.router import _require_platform_admin

    admin_id = await _require_platform_admin(request, db)
    svc = AgentNetworkService(db)
    updated = await svc.mark_commissions_paid_by_admin(
        body.commission_ids, admin_id=admin_id, paid_via=body.paid_via
    )
    await db.commit()
    return {"updated": updated, "paid_by": str(admin_id), "paid_via": body.paid_via}


@router.post("/commissions/bulk-payout")
async def bulk_commission_payout(
    body: BulkCommissionPayoutRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Bulk payout commissions for the current agent.
    Phase 4: Enhanced bulk operations.
    """
    agent_id = await _current_agent_id(user_id, db)
    svc = AgentNetworkService(db)
    result = await svc.bulk_commission_payout(agent_id, body.commission_ids, body.payout_method)
    await db.commit()
    return result


@router.get("/bulk-onboarding/template")
async def get_bulk_onboarding_template(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get template for bulk trader onboarding. Phase 4 feature."""
    await _current_agent_id(user_id, db)  # Ensure agent access
    svc = AgentNetworkService(db)
    return await svc.get_bulk_onboarding_template()
