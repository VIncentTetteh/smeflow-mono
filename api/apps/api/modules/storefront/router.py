"""Public, UNauthenticated storefront API — mounted at /api/v1/public/shop.

No JWT dependency: these routes are reachable by anonymous shoppers. Safety
comes from slug resolution, server-side price/stock validation, rate limiting,
and idempotent Paystack intents (not tokens). Never expose cost_price or raw
stock here.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.middleware import limiter
from apps.api.modules.storefront.service import StorefrontService

router = APIRouter()


class CheckoutItem(BaseModel):
    item_id: UUID
    qty: float = Field(..., gt=0, le=10000)


class CheckoutRequest(BaseModel):
    items: list[CheckoutItem] = Field(..., min_length=1, max_length=50)
    customer_name: str | None = Field(None, max_length=120)
    customer_phone: str = Field(..., min_length=7, max_length=20)


@router.get("/shop/{slug}")
@limiter.limit("120/minute")
async def public_shop(request: Request, slug: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Public shop identity + visible in-stock catalog (no cost/stock leak)."""
    return await StorefrontService(db).get_public_shop(slug)


@router.post("/shop/{slug}/checkout")
@limiter.limit("20/minute")
async def public_checkout(
    request: Request,
    slug: str,
    body: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Validate the cart and return a hosted MoMo/card pay-link."""
    return await StorefrontService(db).checkout(
        slug,
        items=[{"item_id": ci.item_id, "qty": ci.qty} for ci in body.items],
        customer_name=body.customer_name,
        customer_phone=body.customer_phone,
    )


@router.get("/shop/order/{payment_id}")
@limiter.limit("120/minute")
async def public_order_status(
    request: Request, payment_id: UUID, db: AsyncSession = Depends(get_db)
) -> dict:
    """Poll order/payment status after the Paystack redirect."""
    return await StorefrontService(db).get_order_status(payment_id)
