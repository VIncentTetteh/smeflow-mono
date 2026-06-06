"""
Chat intent handlers.

Each handler receives:
  - intent: Intent  (parsed intent + entities)
  - business_id: UUID
  - user_id: UUID
  - db: AsyncSession

And returns a ChatResponse-compatible dict: {"reply": str, "actions_taken": list[str]}
"""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.modules.chat.intent_parser import Intent
from libs.i18n import t
from libs.translation import app_language_label, normalize_app_language

logger = structlog.get_logger()

_LANG_DISPLAY = {
    "en": "English",
    "tw": "Twi / Akan",
    "ak": "Twi / Akan",
    "ew": "Ewe",
    "ee": "Ewe",
    "gaa": "Ga",
    "ha": "Hausa",
    "pid": "English",
}


async def handle_record_sale(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Record a sale from natural language.
    Requires entities: item_name, qty, unit_price.
    Falls back to a prompt asking for missing info.
    """
    e = intent.entities
    item_name = e.get("item_name")
    qty = e.get("qty")
    unit_price = e.get("unit_price")

    if not all([item_name, qty, unit_price]):
        missing = [
            k for k, v in {"item": item_name, "quantity": qty, "price": unit_price}.items() if not v
        ]
        return {
            "reply": f"I need a bit more info to record the sale. Please tell me the {', '.join(missing)}. "
            f"Example: *I sold 3 bags of rice at GH₵ 50*",
            "actions_taken": [],
        }

    try:
        import uuid

        from sqlalchemy import select

        from apps.api.modules.inventory.models import Item
        from apps.api.modules.sales.schemas import SaleCreate, SaleItemInput
        from apps.api.modules.sales.service import SalesService

        # Try to match item by name (fuzzy — ilike)
        result = await db.execute(
            select(Item)
            .where(
                Item.business_id == business_id,
                Item.name.ilike(f"%{item_name}%"),
                Item.deleted_at.is_(None),
            )
            .limit(1)
        )
        item = result.scalar_one_or_none()
        if not item:
            return {
                "reply": (
                    f"I couldn't find *{item_name}* in your inventory, so I did not record the sale. "
                    "Please add the item to inventory first, then try again."
                ),
                "actions_taken": ["sale.item_not_found"],
            }

        item_id = item.id
        description = item.name

        sale_data = SaleCreate(
            items=[
                SaleItemInput(
                    item_id=item_id,
                    description=description,
                    qty=Decimal(str(qty)),
                    unit_price=Decimal(str(unit_price)),
                )
            ],
            payment_method="cash",
            customer_phone=e.get("customer_phone"),
            idempotency_key=str(uuid.uuid4()),
        )

        svc = SalesService(db)
        response = await svc.record_sale(business_id, user_id, sale_data)
        await db.commit()

        total_str = f"GH₵ {response.total:.2f}"
        return {
            "reply": f"✅ Sale recorded! {qty} x {description} @ GH₵ {unit_price:.2f} = *{total_str}*",
            "actions_taken": ["sale.recorded"],
        }
    except Exception as exc:
        logger.error("chat.handler.record_sale.failed", error=str(exc))
        return {
            "reply": f"Sorry, I couldn't record that sale. {exc!s}",
            "actions_taken": [],
        }


async def handle_check_stock(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
) -> dict[str, Any]:
    """Return current stock level(s)."""
    from sqlalchemy import select

    from apps.api.modules.inventory.models import Item

    item_name = intent.entities.get("item_name")

    if item_name:
        result = await db.execute(
            select(Item)
            .where(
                Item.business_id == business_id,
                Item.name.ilike(f"%{item_name}%"),
                Item.deleted_at.is_(None),
            )
            .limit(5)
        )
        items = result.scalars().all()
        if not items:
            return {
                "reply": f"I couldn't find any item matching *{item_name}* in your inventory.",
                "actions_taken": [],
            }
        lines = [f"• *{i.name}*: {i.current_stock} {i.unit}" for i in items]
        return {
            "reply": "Here's the stock:\n" + "\n".join(lines),
            "actions_taken": ["stock.checked"],
        }

    # No item name — show low stock items
    result = await db.execute(
        select(Item)
        .where(
            Item.business_id == business_id,
            Item.current_stock <= Item.low_stock_threshold,
            Item.deleted_at.is_(None),
        )
        .limit(10)
    )
    low = result.scalars().all()
    if not low:
        return {
            "reply": "All your items have sufficient stock. 👍",
            "actions_taken": ["stock.checked"],
        }
    lines = [
        f"• *{i.name}*: {i.current_stock} {i.unit} (threshold: {i.low_stock_threshold})"
        for i in low
    ]
    return {
        "reply": "⚠️ Low stock items:\n" + "\n".join(lines),
        "actions_taken": ["stock.checked"],
    }


async def handle_get_report(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
) -> dict[str, Any]:
    """Return a sales summary for today (or the requested period)."""
    from datetime import date, timedelta

    from apps.api.modules.sales.service import SalesService

    svc = SalesService(db)
    period = intent.entities.get("period", "today")
    today = date.today()

    if period in ("today", None):
        data = await svc.get_daily_summary(business_id, str(today))
        label = "Today"
    elif period == "yesterday":
        data = await svc.get_daily_summary(business_id, str(today - timedelta(days=1)))
        label = "Yesterday"
    elif period in ("this week", "this_week"):
        start = today - timedelta(days=today.weekday())
        data = await svc.get_period_summary(business_id, str(start), str(today))
        label = "This week"
    elif period in ("last week", "last_week"):
        end = today - timedelta(days=today.weekday() + 1)
        start = end - timedelta(days=6)
        data = await svc.get_period_summary(business_id, str(start), str(end))
        label = "Last week"
    elif period in ("this month", "this_month"):
        start = today.replace(day=1)
        data = await svc.get_period_summary(business_id, str(start), str(today))
        label = "This month"
    elif period in ("last month", "last_month"):
        first_this = today.replace(day=1)
        last_last = first_this - timedelta(days=1)
        start = last_last.replace(day=1)
        data = await svc.get_period_summary(business_id, str(start), str(last_last))
        label = "Last month"
    else:
        data = await svc.get_daily_summary(business_id, str(today))
        label = "Today"

    total = data.get("total_revenue", Decimal("0"))
    count = data.get("total_sales", 0)
    cash = data.get("cash_revenue", Decimal("0"))
    momo = data.get("momo_revenue", Decimal("0"))
    credit = data.get("credit_revenue", Decimal("0"))

    reply = (
        f"📊 *{label}'s Summary*\n"
        f"• Sales: {count}\n"
        f"• Revenue: GH₵ {total:.2f}\n"
        f"  - Cash: GH₵ {cash:.2f}\n"
        f"  - MoMo: GH₵ {momo:.2f}\n"
        f"  - Credit: GH₵ {credit:.2f}"
    )
    return {"reply": reply, "actions_taken": ["report.fetched"]}


async def handle_list_receivables(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
) -> dict[str, Any]:
    """List customers with outstanding balances."""
    from sqlalchemy import func, select

    from apps.api.modules.sales.models import Customer, Receivable

    outstanding = Receivable.amount - Receivable.amount_paid
    result = await db.execute(
        select(
            Customer.name,
            Customer.phone,
            func.sum(outstanding).label("total_owed"),
        )
        .join(Receivable, Receivable.customer_id == Customer.id)
        .where(
            Customer.business_id == business_id,
            outstanding > 0,
        )
        .group_by(Customer.id)
        .order_by(func.sum(outstanding).desc())
        .limit(10)
    )
    rows = result.all()
    if not rows:
        return {
            "reply": "🎉 No outstanding credit balances. Everyone is paid up!",
            "actions_taken": [],
        }

    lines = []
    for row in rows:
        name = row.name or "Unknown"
        phone = f" ({row.phone})" if row.phone else ""
        lines.append(f"• *{name}*{phone}: GH₵ {row.total_owed:.2f}")

    return {
        "reply": "💰 *Outstanding Balances*\n" + "\n".join(lines),
        "actions_taken": ["receivables.listed"],
    }


async def handle_restock_alert(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
) -> dict[str, Any]:
    """Handle restock/predictive alert queries."""
    try:
        from apps.api.modules.analytics.service import AnalyticsService

        svc = AnalyticsService(db)

        # Get predictive restock alerts for 7 days ahead
        alerts = await svc.predictive_restock_alerts(business_id, days_ahead=7)

        if not alerts:
            return {
                "reply": "✅ Good news! No items need restocking in the next 7 days based on your sales trends.",
                "actions_taken": [],
            }

        lines = []
        for alert in alerts[:10]:  # Top 10 urgent items
            name = alert["name"]
            urgency_emoji = {
                "critical": "🔴",
                "high": "🟠",
                "medium": "🟡",
                "low": "🟢",
            }.get(alert["urgency"], "⚪")

            days = alert["days_to_threshold"]
            if days == 0:
                timeline = "URGENT - NOW"
            else:
                timeline = f"in {days} day(s)"

            lines.append(
                f"{urgency_emoji} {name}: {timeline} "
                f"(current: {alert['current_stock']} {alert['unit']}, "
                f"avg {alert['avg_daily_sales']:.1f}/day)"
            )

        if len(alerts) > 10:
            lines.append(f"...and {len(alerts) - 10} more items")

        return {
            "reply": "⚠️ *Restock Forecast (7 days)*\n\n" + "\n".join(lines),
            "actions_taken": ["restock.forecast"],
        }
    except Exception as exc:
        logger.error("chat.handler.restock_alert.failed", error=str(exc))
        return {
            "reply": f"Sorry, I couldn't fetch restock alerts. {exc!s}",
            "actions_taken": [],
        }


_CREDIT_INSIGHT_SYSTEM = """You are a friendly financial advisor for Ghanaian small business owners.
Explain this credit score simply and give practical improvement advice.
Respond in {language}. Keep it under 120 words. Use an encouraging tone.

Score: {score}/100 (Band {band})
Max loan eligible: GHS {max_loan}

Factor scores (0-100, higher is better):
{factor_lines}

Top 2 weakest factors: {weak_factors}

Give:
1. One sentence on what the score means for them today
2. What the top 2 weak factors mean in plain terms
3. One specific action they can take this week to improve each weak factor"""


async def handle_credit_score(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
    language: str = "en",
) -> dict[str, Any]:
    """Return credit score with Grok-powered plain-language insights."""
    from sqlalchemy import select

    from apps.api.modules.credit.models import CreditScore

    result = await db.execute(
        select(CreditScore)
        .where(CreditScore.business_id == business_id)
        .order_by(CreditScore.computed_at.desc())
        .limit(1)
    )
    score = result.scalar_one_or_none()

    if not score:
        return {
            "reply": t("chat.credit_none", language),
            "actions_taken": [],
        }

    # Try Grok-powered insights; fall back to plain template on failure
    try:
        from apps.api.core.config import get_settings

        settings = get_settings()
        if settings.GROQ_API_KEY:
            component_scores: dict = (score.factors or {}).get("component_scores", {})
            if component_scores:
                sorted_factors = sorted(component_scores.items(), key=lambda x: float(x[1]))
                weak_factors = [k.replace("_", " ") for k, _ in sorted_factors[:2]]
                factor_lines = "\n".join(
                    f"- {k.replace('_', ' ')}: {v:.0f}" for k, v in sorted_factors
                )
                prompt = _CREDIT_INSIGHT_SYSTEM.format(
                    language=_LANG_DISPLAY.get(language, "English"),
                    score=score.score,
                    band=score.band,
                    max_loan=f"{score.max_loan_amount:.2f}" if score.max_loan_amount else "0.00",
                    factor_lines=factor_lines,
                    weak_factors=", ".join(weak_factors),
                )
                from openai import AsyncOpenAI

                client = AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL)
                response = await client.chat.completions.create(
                    model=settings.GROQ_CHAT_MODEL,
                    max_tokens=250,
                    messages=[{"role": "user", "content": prompt}],
                )
                reply = (response.choices[0].message.content or "").strip()
                if reply:
                    return {"reply": reply, "actions_taken": ["credit_score.fetched"]}
    except Exception as exc:
        logger.warning("chat.credit_insight_failed", error=str(exc))

    return {
        "reply": t(
            "chat.credit_score",
            language,
            score=score.score,
            band=score.band,
            max_loan=f"{score.max_loan_amount:.2f}" if score.max_loan_amount else "0.00",
        ),
        "actions_taken": ["credit_score.fetched"],
    }


async def handle_help(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
    language: str = "en",
) -> dict[str, Any]:
    return {
        "reply": t("chat.help", language),
        "actions_taken": [],
    }


async def handle_set_language(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
    language: str = "en",
) -> dict[str, Any]:
    """Persist the user's language preference and confirm in the new language."""
    from sqlalchemy import update

    from apps.api.modules.auth.models import User

    new_lang = normalize_app_language(intent.entities.get("language", "en"))

    await db.execute(update(User).where(User.id == user_id).values(language_pref=new_lang))
    await db.commit()

    display = app_language_label(new_lang)
    return {
        "reply": f"Language changed to {display}.",
        "actions_taken": [f"language.set.{new_lang}"],
        "language": new_lang,
    }


async def handle_best_selling(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
    language: str = "en",
) -> dict[str, Any]:
    """Return top-selling items ranked by total quantity sold."""
    from datetime import date, timedelta

    from sqlalchemy import func, select

    from apps.api.modules.sales.models import Sale, SaleItem

    period = intent.entities.get("period", "this_month")
    limit = int(intent.entities.get("limit") or 5)
    today = date.today()

    if period in ("today",):
        start = today
        label = "today"
    elif period in ("this_week", "week"):
        start = today - timedelta(days=today.weekday())
        label = "this week"
    else:
        start = today.replace(day=1)
        label = "this month"

    rows = (
        await db.execute(
            select(
                SaleItem.description,
                func.sum(SaleItem.qty).label("total_qty"),
                func.sum(SaleItem.line_total).label("total_revenue"),
            )
            .join(Sale, Sale.id == SaleItem.sale_id)
            .where(
                Sale.business_id == business_id,
                func.date(Sale.created_at) >= start,
            )
            .group_by(SaleItem.description)
            .order_by(func.sum(SaleItem.qty).desc())
            .limit(limit)
        )
    ).all()

    if not rows:
        return {
            "reply": f"No sales recorded {label} yet. Start recording sales to see your top items.",
            "actions_taken": ["best_selling.empty"],
        }

    lines = [f"🏆 *Top items {label}:*"]
    for i, row in enumerate(rows, 1):
        lines.append(
            f"{i}. {row.description} — {row.total_qty:.0f} sold, GH₵ {row.total_revenue:.2f}"
        )

    return {"reply": "\n".join(lines), "actions_taken": ["best_selling.fetched"]}


_GENERAL_SYSTEM = (
    "You are Yɛ, a friendly business assistant built into the SMEFlow app for Ghanaian small "
    "businesses. Answer questions about sales, inventory, pricing, tax, and general business "
    "advice relevant to Ghana. Keep answers concise (3-5 sentences max) and practical. "
    "You understand English, Twi/Akan, Ewe, Ga, and Hausa. "
    "Respond in {language}."
)


async def handle_unknown(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
    language: str = "en",
) -> dict[str, Any]:
    """Fall back to a general LLM business Q&A for unrecognised messages."""
    from apps.api.core.config import get_settings

    settings = get_settings()
    message = intent.raw_message or ""

    if not settings.GROQ_API_KEY or not message.strip():
        return {"reply": t("chat.unknown", language), "actions_taken": []}

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL)
        lang_display = _LANG_DISPLAY.get(language, "English")
        response = await client.chat.completions.create(
            model=settings.GROQ_CHAT_MODEL,
            max_tokens=300,
            messages=[
                {"role": "system", "content": _GENERAL_SYSTEM.format(language=lang_display)},
                {"role": "user", "content": message},
            ],
        )
        reply = (response.choices[0].message.content or "").strip()
        return {"reply": reply or t("chat.unknown", language), "actions_taken": []}
    except Exception as exc:
        logger.warning("chat.general_llm_failed", error=str(exc))
        return {"reply": t("chat.unknown", language), "actions_taken": []}


# ── Dispatch table ─────────────────────────────────────────────────────────────

HANDLERS: dict[str, Callable[..., Any]] = {
    "record_sale": handle_record_sale,
    "check_stock": handle_check_stock,
    "get_report": handle_get_report,
    "list_receivables": handle_list_receivables,
    "restock_alert": handle_restock_alert,
    "credit_score": handle_credit_score,
    "best_selling": handle_best_selling,
    "help": handle_help,
    "set_language": handle_set_language,
    "unknown": handle_unknown,
}


async def dispatch(
    intent: Intent,
    business_id: UUID,
    user_id: UUID,
    db: AsyncSession,
    language: str = "en",
) -> dict[str, Any]:
    handler = HANDLERS.get(intent.name)
    if handler:
        import inspect

        sig = inspect.signature(handler)
        if "language" in sig.parameters:
            return await handler(intent, business_id, user_id, db, language=language)
        return await handler(intent, business_id, user_id, db)
    return {
        "reply": t("chat.unknown", language),
        "actions_taken": [],
    }
