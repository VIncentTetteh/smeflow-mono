"""Public storefront service — customer-facing catalog + pay-first checkout.

A storefront order is NOT a new entity: checkout builds a Paystack sale
payment-intent (reusing SalesService.create_paystack_sale_intent), and the
existing Paystack webhook finalizes it into a real Sale, deducts stock, and
credits the settlement wallet. This service only resolves the shop by its public
slug, exposes a safe catalog (no cost/stock leakage), and validates the cart
server-side before minting the intent.
"""

from __future__ import annotations

import re
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.exceptions import NotFoundError, SMEFlowError
from apps.api.modules.business.models import Business
from apps.api.modules.inventory.models import Item
from apps.api.modules.sales.schemas import SaleCreate, SaleItemInput
from apps.api.modules.sales.service import SalesService

SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{1,58})[a-z0-9]$")
RESERVED_SLUGS = {
    "admin", "api", "app", "store", "shop", "lender", "agent", "auth", "login",
    "www", "smeflow", "support", "help", "about", "terms", "privacy", "settings",
}


def normalize_slug(raw: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", (raw or "").strip().lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug


def validate_slug(slug: str) -> None:
    if not SLUG_RE.match(slug):
        raise SMEFlowError(
            "Link must be 3-60 characters: lowercase letters, numbers and hyphens.",
            "INVALID_SLUG",
            400,
        )
    if slug in RESERVED_SLUGS:
        raise SMEFlowError("That link is reserved. Choose another.", "RESERVED_SLUG", 400)


class StorefrontService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def resolve_enabled_business(self, slug: str) -> Business:
        result = await self.db.execute(
            select(Business).where(
                Business.storefront_slug == slug.lower(),
                Business.storefront_enabled.is_(True),
                Business.is_active.is_(True),
            )
        )
        business = result.scalar_one_or_none()
        if not business:
            raise NotFoundError("This shop is not available.")
        return business

    async def _visible_items(self, business_id: UUID) -> list[Item]:
        result = await self.db.execute(
            select(Item)
            .where(
                Item.business_id == business_id,
                Item.is_active.is_(True),
                Item.storefront_visible.is_(True),
                Item.deleted_at.is_(None),
            )
            .order_by(Item.name)
        )
        return list(result.scalars().all())

    async def get_public_shop(self, slug: str) -> dict:
        business = await self.resolve_enabled_business(slug)
        items = await self._visible_items(business.id)
        return {
            "slug": business.storefront_slug,
            "name": business.name,
            "tagline": business.storefront_tagline,
            "whatsapp": business.storefront_whatsapp,
            "region": business.region,
            "city": business.city,
            "currency": "GHS",
            "items": [
                {
                    "id": str(it.id),
                    "name": it.name,
                    "description": it.description,
                    "unit": it.unit,
                    "price": float(it.sell_price),
                    "image_url": it.image_url,
                    "in_stock": Decimal(str(it.current_stock)) > 0,
                }
                for it in items
            ],
        }

    async def checkout(
        self, slug: str, *, items: list[dict], customer_name: str | None,
        customer_phone: str,
    ) -> dict:
        """Validate the cart server-side and mint a Paystack pay-link.

        `items` is [{item_id, qty}]. Prices are ALWAYS taken from the DB, never
        the client. Returns {payment_id, payment_url, reference, total}.
        """
        business = await self.resolve_enabled_business(slug)
        visible = {str(it.id): it for it in await self._visible_items(business.id)}

        if not items:
            raise SMEFlowError("Your cart is empty.", "EMPTY_CART", 400)

        sale_items: list[SaleItemInput] = []
        total = Decimal("0")
        for line in items:
            item_id = str(line.get("item_id"))
            qty = Decimal(str(line.get("qty") or 0))
            it = visible.get(item_id)
            if not it:
                raise SMEFlowError("An item is no longer available.", "ITEM_UNAVAILABLE", 409)
            if qty <= 0:
                raise SMEFlowError("Invalid quantity.", "INVALID_QTY", 400)
            if Decimal(str(it.current_stock)) < qty:
                raise SMEFlowError(f"Not enough stock for {it.name}.", "INSUFFICIENT_STOCK", 409)
            sale_items.append(
                SaleItemInput(item_id=it.id, qty=qty, unit_price=it.sell_price)
            )
            total += it.sell_price * qty

        sale = SaleCreate(
            items=sale_items,
            payment_method="paystack",
            customer_phone=customer_phone,
            customer_name=customer_name,
            idempotency_key=str(uuid4()),
        )

        # SECURITY: the Paystack redirect target is built ONLY from trusted
        # server config + the resolved slug — never from client input — to
        # prevent an open-redirect/phishing bounce after payment.
        from apps.api.core.config import get_settings

        settings = get_settings()
        base = (settings.STOREFRONT_WEB_BASE_URL or settings.APP_BASE_URL).rstrip("/")
        callback_url = f"{base}/shop/{business.storefront_slug}/order"

        intent = await SalesService(self.db).create_paystack_sale_intent(
            business.id, None, sale, callback_url=callback_url, source="storefront"
        )
        await self.db.commit()
        return {
            "payment_id": str(intent.payment_id),
            "reference": intent.external_ref,
            "payment_url": intent.payment_url,
            "total": float(total),
        }

    async def get_order_status(self, payment_id: UUID) -> dict:
        """Public order status by payment id — minimal, no business data leak."""
        from apps.api.modules.payments.models import Payment

        result = await self.db.execute(select(Payment).where(Payment.id == payment_id))
        payment = result.scalar_one_or_none()
        if not payment or (payment.metadata_ or {}).get("source") != "storefront":
            raise NotFoundError("Order not found.")
        status_map = {"success": "paid", "pending": "pending", "failed": "failed"}
        return {
            "status": status_map.get(payment.status, "pending"),
            "total": float(payment.amount),
            "reference": payment.external_ref,
        }
