"""Billing & Subscriptions router."""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.config import get_settings
from apps.api.core.database import get_db
from apps.api.core.dependencies import get_current_business_id
from apps.api.modules.billing.models import PLANS
from apps.api.modules.billing.service import BillingService

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────


class PlanInfo(BaseModel):
    name: str
    price: Decimal = Field(validation_alias="price_ghs")
    annual_price_ghs: Decimal = Decimal("0")
    features: list[str] = []
    interval: str | None = None
    billing_intervals: list[str] = []
    support_sla: str | None = None
    sale_limit: int | None = None
    staff_limit: int | None = None
    monthly_sales: int | None = None
    items: int | None = None
    item_categories: int | None = None
    customers: int | None = None
    invoices: int | None = None
    monthly_invoices: int | None = None
    employees: int | None = None
    team_members: int | None = None
    users: int | None = None
    ai_messages: int | None = None
    businesses: int | None = None
    included_businesses: int | None = None
    extra_business_price_ghs: Decimal | None = None
    field_agents: int | None = None
    languages: list[str] = []
    analytics: bool | str = False
    credit_scoring: bool = False
    tax_summary: bool = False
    gra_submission: bool = False
    export: bool = False
    invoice_pdf: bool = False
    invoice_templates: str | None = None
    recurring_invoices: bool = False
    bulk_csv_import: bool = False
    bulk_momo_payout: bool = False
    cost_margin_tracking: bool = False
    business_insights: bool = False
    api_access: bool = False


class SubscriptionResponse(BaseModel):
    id: UUID
    business_id: UUID
    plan: str
    billing_interval: str = "monthly"
    status: str
    cancel_at_period_end: bool
    momo_phone: str | None
    current_period_end: datetime | None = None

    model_config = {"from_attributes": True}


class TransactionResponse(BaseModel):
    id: UUID
    amount: Decimal
    currency: str
    status: str
    payment_method: str
    description: str | None
    paid_at: str | None
    created_at: str

    model_config = {"from_attributes": True}


class ChangePlanRequest(BaseModel):
    plan: str
    momo_phone: str | None = None
    billing_interval: str | None = None


class SubscribeRequest(BaseModel):
    plan: str
    momo_phone: str | None = None
    billing_interval: str | None = "monthly"


# ── Plans catalogue ───────────────────────────────────────────────────────────


@router.get("/plans", response_model=list[PlanInfo])
async def list_plans() -> list[PlanInfo]:
    """List all available subscription plans."""
    return [PlanInfo(name=name, **dict(details.items())) for name, details in PLANS.items()]


# ── Current subscription ──────────────────────────────────────────────────────


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_subscription(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionResponse:
    """Get the current subscription for this business."""
    svc = BillingService(db)
    sub = await svc.get_subscription(business_id)
    return SubscriptionResponse.model_validate(sub)


@router.get("/plan")
async def get_current_plan(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Current plan plus Phase 3 usage counters and feature limits."""
    data = await BillingService(db).plan_usage(business_id)
    sub = data.pop("subscription")
    return {
        "subscription": SubscriptionResponse.model_validate(sub).model_dump(),
        **data,
    }


@router.post("/subscription/change", response_model=SubscriptionResponse)
async def change_plan(
    body: ChangePlanRequest,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionResponse:
    """Upgrade or downgrade the subscription plan."""
    from fastapi import HTTPException

    svc = BillingService(db)
    try:
        sub = await svc.change_plan(
            business_id,
            body.plan,
            body.momo_phone,
            body.billing_interval,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return SubscriptionResponse.model_validate(sub)


@router.post("/subscribe")
async def subscribe(
    body: SubscribeRequest,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Initiate a subscription payment for a plan upgrade.

    When Paystack is configured (the default), returns a `payment_url` pointing
    to a hosted Paystack payment page. The mobile app should open this URL in a
    webview. On payment completion, the Paystack webhook activates the subscription
    automatically — no further action required from the client.
    """
    from fastapi import HTTPException

    svc = BillingService(db)
    try:
        txn, payment_url = await svc.initiate_subscription(
            business_id,
            body.plan,
            body.momo_phone,
            body.billing_interval,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return {
        "transaction_id": str(txn.id),
        "provider_ref": txn.provider_ref,
        "amount": txn.amount,
        "currency": txn.currency,
        "status": txn.status,
        "plan": body.plan,
        "billing_interval": body.billing_interval or "monthly",
        "payment_url": payment_url,
        "message": (
            "Open the payment_url in a webview to complete your subscription."
            if payment_url
            else "Check your phone to complete the transaction."
        ),
    }


@router.post("/subscribe/verify")
async def verify_subscription_payment(
    body: dict,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Verify a pending subscription payment directly with Paystack.

    The mobile app calls this after returning from the Paystack checkout browser,
    passing the `provider_ref` returned by POST /subscribe. This handles the case
    where the Paystack webhook hasn't fired yet (dev environments, webhook delivery
    lag, etc.). Idempotent — safe to call multiple times.
    """
    from fastapi import HTTPException
    from sqlalchemy import select

    from apps.api.modules.billing.models import BillingTransaction

    provider_ref = body.get("provider_ref") or body.get("reference")
    if not provider_ref:
        raise HTTPException(status_code=400, detail="provider_ref is required")

    settings = get_settings()
    if not settings.PAYSTACK_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payment provider not configured")

    # Check if already activated (idempotent fast-path)
    txn = (
        await db.execute(
            select(BillingTransaction).where(
                BillingTransaction.provider_ref == provider_ref,
                BillingTransaction.business_id == business_id,
            )
        )
    ).scalar_one_or_none()

    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if txn.status == "success":
        sub = await BillingService(db).get_subscription(business_id)
        return {
            "activated": True,
            "plan": sub.plan,
            "billing_interval": sub.billing_interval,
            "status": sub.status,
        }

    # Verify with Paystack
    from libs.payment_clients.paystack import PaystackClient

    client = PaystackClient()
    try:
        ps_status = await client.check_status(provider_ref)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Paystack verification failed: {exc}") from exc

    if ps_status == "success":
        activated = await BillingService(db).handle_webhook_success(provider_ref)
        await db.commit()
        sub = await BillingService(db).get_subscription(business_id)
        return {
            "activated": activated,
            "plan": sub.plan,
            "billing_interval": sub.billing_interval,
            "status": sub.status,
        }

    return {"activated": False, "paystack_status": ps_status}


@router.post("/subscription/cancel", response_model=SubscriptionResponse)
async def cancel_subscription(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionResponse:
    """Schedule cancellation at the end of the current billing period."""
    svc = BillingService(db)
    sub = await svc.cancel(business_id)
    await db.commit()
    return SubscriptionResponse.model_validate(sub)


# ── Billing history ───────────────────────────────────────────────────────────


@router.get("/transactions")
async def billing_history(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Paginated billing transaction history."""
    svc = BillingService(db)
    txns, total = await svc.list_transactions(business_id, limit, offset)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(t.id),
                "amount": t.amount,
                "currency": t.currency,
                "status": t.status,
                "payment_method": t.payment_method,
                "description": t.description,
                "paid_at": t.paid_at.isoformat() if t.paid_at else None,
                "created_at": t.created_at.isoformat(),
            }
            for t in txns
        ],
    }


@router.get("/invoices")
async def billing_invoices(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Billing history alias named as invoices in the Phase 3 plan."""
    return await billing_history(limit, offset, business_id, db)


@router.post("/webhook/paystack", status_code=200, include_in_schema=False)
async def paystack_webhook(
    request: Request,
    x_paystack_signature: str = Header(..., alias="x-paystack-signature"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Handle Paystack webhook events for subscription lifecycle management.

    Paystack signs every webhook request with HMAC-SHA512 using the account's
    webhook secret key.  We verify the signature before processing to reject
    any unauthenticated requests.
    """
    settings = get_settings()
    body_bytes = await request.body()

    expected_sig = hmac.new(
        settings.PAYSTACK_SECRET_KEY.encode(),
        body_bytes,
        hashlib.sha512,
    ).hexdigest()

    if not hmac.compare_digest(expected_sig, x_paystack_signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    payload: dict = await request.json()
    service = BillingService(db)
    await service.handle_paystack_webhook(payload)
    await db.commit()
    return {"status": "ok"}


@router.post("/callback", include_in_schema=False)
async def billing_callback(body: dict, db: AsyncSession = Depends(get_db)) -> dict:
    """MoMo subscription callback handler for billing provider webhooks."""
    provider_ref = (
        body.get("provider_ref")
        or body.get("external_ref")
        or body.get("reference")
        or body.get("transaction_id")
    )
    status = str(body.get("status", "")).lower()
    if not provider_ref:
        from fastapi import HTTPException

        raise HTTPException(400, "Missing provider reference")
    processed = False
    if status in ("success", "successful", "completed", "paid"):
        processed = await BillingService(db).handle_webhook_success(str(provider_ref))
        await db.commit()
    return {"processed": processed, "provider_ref": str(provider_ref)}
