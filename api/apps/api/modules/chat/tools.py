"""RAG tool layer — read tools over the logged-in business's own data.

Each tool wraps an existing, business_id-scoped service method. `build_registry`
returns name->async-callable closures that inject business_id/db, so the LLM
never supplies identity. Tools return plain dicts/lists (JSON-serializable via
`default=str` in the agent). Period handling is centralised in `resolve_period`.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Callable
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

PERIODS = [
    "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
    "last_7_days", "last_30_days", "last_90_days",
]


def resolve_period(period: str | None, from_date: str | None, to_date: str | None) -> tuple[str, str]:
    """Return (from_date, to_date) ISO strings from a named period or explicit dates."""
    if from_date and to_date:
        return from_date, to_date
    today = date.today()
    p = (period or "this_month").lower()
    if p == "today":
        return today.isoformat(), today.isoformat()
    if p == "yesterday":
        y = today - timedelta(days=1)
        return y.isoformat(), y.isoformat()
    if p == "this_week":
        start = today - timedelta(days=today.weekday())
        return start.isoformat(), today.isoformat()
    if p == "last_week":
        start = today - timedelta(days=today.weekday() + 7)
        return start.isoformat(), (start + timedelta(days=6)).isoformat()
    if p == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return last_prev.replace(day=1).isoformat(), last_prev.isoformat()
    if p == "last_7_days":
        return (today - timedelta(days=7)).isoformat(), today.isoformat()
    if p == "last_90_days":
        return (today - timedelta(days=90)).isoformat(), today.isoformat()
    if p == "last_30_days":
        return (today - timedelta(days=30)).isoformat(), today.isoformat()
    # this_month (default)
    return today.replace(day=1).isoformat(), today.isoformat()


_PERIOD_PARAM = {
    "period": {"type": "string", "enum": PERIODS, "description": "Named time window."},
    "from_date": {"type": "string", "description": "ISO start date YYYY-MM-DD (optional, overrides period)."},
    "to_date": {"type": "string", "description": "ISO end date YYYY-MM-DD (optional, overrides period)."},
}


def _tool(name: str, description: str, properties: dict | None = None, required: list | None = None) -> dict:
    """Anthropic tool schema (name/description/input_schema)."""
    return {
        "name": name,
        "description": description,
        "input_schema": {
            "type": "object",
            "properties": properties or {},
            "required": required or [],
        },
    }


TOOL_SCHEMAS: list[dict] = [
    _tool("get_sales_summary", "Total sales, revenue and cash/MoMo/credit split for a period. Use for 'how much did I sell/make'.", _PERIOD_PARAM),
    _tool("get_profit_and_loss", "Revenue, cost of goods, gross profit and margin for a period. Use for 'am I making profit', 'my margin'.", _PERIOD_PARAM),
    _tool("get_cash_flow", "Cash in, MoMo in, total inflow and outstanding credit for a period.", _PERIOD_PARAM),
    _tool("get_top_items", "Best-selling items by revenue for a period. Use for 'best seller', 'top products'.", {**_PERIOD_PARAM, "limit": {"type": "integer", "description": "Max items (default 5)."}}),
    _tool("get_revenue_trend", "Daily revenue series for a period, for trends.", _PERIOD_PARAM),
    _tool("get_top_customers", "Top customers by spend for a period (name, spend, outstanding).", {**_PERIOD_PARAM, "limit": {"type": "integer"}}),
    _tool("list_receivables", "Who owes the business money and how much (credit customers). Use for 'who owes me', 'my debts'."),
    _tool("list_inventory", "List/search inventory items with stock and price. Use for 'what do I have', stock questions.", {"search": {"type": "string", "description": "Optional name filter."}, "low_stock_only": {"type": "boolean"}, "limit": {"type": "integer"}}),
    _tool("get_item_stock", "Stock and price for a single item by name.", {"name": {"type": "string"}}, ["name"]),
    _tool("get_low_stock", "Items at or below their low-stock threshold. Use for 'what is running low'."),
    _tool("get_restock_suggestions", "Predictive restock alerts (items likely to run out soon)."),
    _tool("get_credit_score", "The business's current credit score, band and max loan amount."),
    _tool(
        "propose_record_sale",
        "PROPOSE recording a cash sale of an item (does NOT save — the owner must confirm). Use when the owner says they sold something.",
        {"item_name": {"type": "string"}, "qty": {"type": "number"}, "unit_price": {"type": "number", "description": "Optional; defaults to the item's price."}},
        ["item_name", "qty"],
    ),
    _tool(
        "propose_adjust_stock",
        "PROPOSE a stock adjustment (does NOT save — owner must confirm). qty_change positive to add, negative to remove.",
        {"item_name": {"type": "string"}, "qty_change": {"type": "number"}, "reason": {"type": "string", "enum": ["purchase", "damage", "adjustment", "transfer", "return"]}},
        ["item_name", "qty_change"],
    ),
]

PROPOSAL_TYPES = {"record_sale", "adjust_stock"}


def build_registry(business_id: UUID, user_id: UUID | None, db: AsyncSession) -> dict[str, Callable[..., Any]]:
    from apps.api.core.redis import get_redis
    from apps.api.modules.analytics.service import AnalyticsService
    from apps.api.modules.credit.service import CreditService
    from apps.api.modules.inventory.service import InventoryService
    from apps.api.modules.sales.service import SalesService

    def analytics() -> AnalyticsService:
        try:
            return AnalyticsService(db, get_redis())
        except Exception:
            return AnalyticsService(db)

    async def get_sales_summary(period=None, from_date=None, to_date=None):
        f, t = resolve_period(period, from_date, to_date)
        if f == t:
            return await SalesService(db).get_daily_summary(business_id, f)
        return await SalesService(db).get_period_summary(business_id, f, t)

    async def get_profit_and_loss(period=None, from_date=None, to_date=None):
        f, t = resolve_period(period, from_date, to_date)
        return await analytics().pnl_summary(business_id, f, t)

    async def get_cash_flow(period=None, from_date=None, to_date=None):
        f, t = resolve_period(period, from_date, to_date)
        return await analytics().cash_flow(business_id, f, t)

    async def get_top_items(period=None, from_date=None, to_date=None, limit=5):
        f, t = resolve_period(period, from_date, to_date)
        return await analytics().top_items(business_id, f, t, limit=min(int(limit or 5), 15))

    async def get_revenue_trend(period=None, from_date=None, to_date=None):
        f, t = resolve_period(period, from_date, to_date)
        return await analytics().revenue_by_day(business_id, f, t)

    async def get_top_customers(period=None, from_date=None, to_date=None, limit=5):
        f, t = resolve_period(period, from_date, to_date)
        return await analytics().customer_summary(business_id, f, t, limit=min(int(limit or 5), 15))

    async def list_receivables():
        from apps.api.modules.sales.models import Customer, Receivable

        outstanding = Receivable.amount - Receivable.amount_paid
        rows = await db.execute(
            select(Customer.name, Customer.phone, func.sum(outstanding).label("owed"))
            .join(Receivable, Receivable.customer_id == Customer.id)
            .where(Customer.business_id == business_id, outstanding > 0)
            .group_by(Customer.id, Customer.name, Customer.phone)
            .order_by(func.sum(outstanding).desc())
            .limit(15)
        )
        items = [{"customer": r.name or "Unknown", "phone": r.phone, "owed": float(r.owed or 0)} for r in rows]
        return {"customers": items, "total_owed": round(sum(i["owed"] for i in items), 2)}

    async def list_inventory(search=None, low_stock_only=False, limit=10):
        items, total = await InventoryService(db).get_items(
            business_id, search=search, low_stock_only=bool(low_stock_only), limit=min(int(limit or 10), 25)
        )
        return {
            "total": total,
            "items": [
                {"name": it.name, "unit": it.unit, "price": float(it.sell_price), "stock": float(it.current_stock)}
                for it in items
            ],
        }

    async def get_item_stock(name: str):
        items, _ = await InventoryService(db).get_items(business_id, search=name, limit=5)
        if not items:
            return {"found": False, "name": name}
        it = items[0]
        return {"found": True, "name": it.name, "unit": it.unit, "price": float(it.sell_price), "stock": float(it.current_stock), "low_stock_threshold": float(it.low_stock_threshold)}

    async def get_low_stock():
        return {"items": await analytics().low_stock_items(business_id)}

    async def get_restock_suggestions():
        return {"suggestions": await analytics().predictive_restock_alerts(business_id)}

    async def get_credit_score():
        score = await CreditService(db).current_score(business_id)
        if not score:
            return {"available": False}
        return {
            "available": True,
            "score": getattr(score, "score", None),
            "band": getattr(score, "band", None) or getattr(score, "score_band", None),
            "max_loan_amount": float(getattr(score, "max_loan_amount", 0) or 0),
        }

    async def _resolve_item(name: str):
        from apps.api.modules.inventory.models import Item

        row = await db.execute(
            select(Item).where(
                Item.business_id == business_id,
                Item.name.ilike(f"%{name}%"),
                Item.deleted_at.is_(None),
            ).limit(1)
        )
        return row.scalar_one_or_none()

    async def propose_record_sale(item_name: str, qty: float, unit_price: float | None = None):
        it = await _resolve_item(item_name)
        if not it:
            return {"error": "item_not_in_inventory", "item_name": item_name}
        price = float(unit_price) if unit_price else float(it.sell_price)
        total = round(price * float(qty), 2)
        return {
            "proposal_type": "record_sale",
            "item_id": str(it.id),
            "item_name": it.name,
            "qty": float(qty),
            "unit_price": price,
            "total": total,
        }

    async def propose_adjust_stock(item_name: str, qty_change: float, reason: str = "adjustment"):
        it = await _resolve_item(item_name)
        if not it:
            return {"error": "item_not_in_inventory", "item_name": item_name}
        projected = float(it.current_stock) + float(qty_change)
        if projected < 0:
            return {"error": "would_go_negative", "item_name": it.name, "current_stock": float(it.current_stock)}
        return {
            "proposal_type": "adjust_stock",
            "item_id": str(it.id),
            "item_name": it.name,
            "qty_change": float(qty_change),
            "reason": reason if reason in {"purchase", "damage", "adjustment", "transfer", "return"} else "adjustment",
            "current_stock": float(it.current_stock),
            "projected_stock": projected,
        }

    return {
        "get_sales_summary": get_sales_summary,
        "get_profit_and_loss": get_profit_and_loss,
        "get_cash_flow": get_cash_flow,
        "get_top_items": get_top_items,
        "get_revenue_trend": get_revenue_trend,
        "get_top_customers": get_top_customers,
        "list_receivables": list_receivables,
        "list_inventory": list_inventory,
        "get_item_stock": get_item_stock,
        "get_low_stock": get_low_stock,
        "get_restock_suggestions": get_restock_suggestions,
        "get_credit_score": get_credit_score,
        "propose_record_sale": propose_record_sale,
        "propose_adjust_stock": propose_adjust_stock,
    }


async def commit_action(proposal: dict, business_id: UUID, user_id: UUID | None, db: AsyncSession) -> dict:
    """Execute a confirmed write proposal. Re-resolves via scoped services (trusts
    only item_id/qty/price from the proposal). Returns a summary."""
    from uuid import uuid4

    ptype = proposal.get("proposal_type")
    if ptype == "record_sale":
        from apps.api.modules.sales.schemas import SaleCreate, SaleItemInput
        from apps.api.modules.sales.service import SalesService

        data = SaleCreate(
            items=[SaleItemInput(
                item_id=UUID(str(proposal["item_id"])),
                qty=proposal["qty"],
                unit_price=proposal["unit_price"],
            )],
            payment_method="cash",
            idempotency_key=str(uuid4()),
        )
        res = await SalesService(db).record_sale(business_id, user_id, data)
        await db.commit()
        return {"ok": True, "action": "sale.recorded", "total": float(getattr(res, "total", 0) or 0)}

    if ptype == "adjust_stock":
        from apps.api.modules.inventory.schemas import StockAdjustment
        from apps.api.modules.inventory.service import InventoryService

        data = StockAdjustment(
            item_id=UUID(str(proposal["item_id"])),
            qty_change=proposal["qty_change"],
            reason=proposal.get("reason", "adjustment"),
        )
        await InventoryService(db).adjust_stock(business_id, user_id, data)
        await db.commit()
        return {"ok": True, "action": "stock.adjusted"}

    return {"ok": False, "error": "unknown_proposal"}
