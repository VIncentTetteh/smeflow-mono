"""
USSD state machine.

Each handle_* coroutine receives the session and user input, mutates session
state, persists it, and returns a USSD response string:
  "CON <text>"  — continue (show menu, wait for input)
  "END <text>"  — terminate session
"""

from __future__ import annotations

import uuid as _uuid
from decimal import Decimal, InvalidOperation

import structlog

from apps.api.modules.ussd.session import USSDSession
from libs.i18n import t

logger = structlog.get_logger()

REGISTER_TYPES = {
    "1": "market_stall",
    "2": "shop",
    "3": "artisan",
    "4": "restaurant",
    "5": "service",
    "6": "other",
}


async def handle_registration(session: USSDSession, user_input: str, db) -> str:
    """Minimal USSD registration flow for unknown phone numbers."""
    lang = session.language
    state = session.state
    if state == "MAIN_MENU":
        session.transition("REGISTER_NAME")
        await session.save()
        return t("ussd.register.enter_name", lang)

    if state == "REGISTER_NAME":
        name = user_input.strip()
        if not name:
            return t("ussd.register.enter_name", lang)
        session.transition("REGISTER_TYPE", business_name=name[:255])
        await session.save()
        return t("ussd.register.select_type", lang)

    if state == "REGISTER_TYPE":
        business_type = REGISTER_TYPES.get(user_input.strip())
        if not business_type:
            return t("ussd.register.select_type", lang)
        session.transition("REGISTER_ADDRESS", business_type=business_type)
        await session.save()
        return t("ussd.register.enter_location", lang)

    if state == "REGISTER_ADDRESS":
        from apps.api.modules.auth.repository import UserRepository
        from apps.api.modules.business.schemas import BusinessCreate
        from apps.api.modules.business.service import BusinessService

        address = user_input.strip() or None
        user_repo = UserRepository(db)
        user = await user_repo.get_by_phone(session.phone)
        if not user:
            user = await user_repo.create(phone=session.phone)

        business_data = BusinessCreate(
            name=session.data["business_name"],
            type=session.data["business_type"],
            address=address,
            onboarding_channel="ussd",
        )
        business, _token = await BusinessService(db).create_business(user.id, business_data)
        await db.commit()

        session.business_id = str(business.id)
        session.user_id = str(user.id)
        session.clear_flow_data()
        await session.save()
        main_menu_body = t("ussd.main_menu", lang).removeprefix("CON ")
        return t("ussd.register.complete", lang) + main_menu_body

    session.clear_flow_data()
    await session.save()
    return t("ussd.register.enter_name", lang)


async def handle(session: USSDSession, user_input: str, db) -> str:
    """Route to the appropriate state handler and return USSD response string."""
    user_input = user_input.strip()
    lang = session.language

    state = session.state
    try:
        if state == "MAIN_MENU":
            response = await _main_menu(session, user_input, db)
        elif state == "RECORD_SALE_ITEM":
            response = await _record_sale_item(session, user_input, db)
        elif state == "RECORD_SALE_QTY":
            response = await _record_sale_qty(session, user_input)
        elif state == "RECORD_SALE_PRICE":
            response = await _record_sale_price(session, user_input)
        elif state == "RECORD_SALE_CONFIRM":
            response = await _record_sale_confirm(session, user_input, db)
        elif state == "CHECK_STOCK_ITEM":
            response = await _check_stock_item(session, user_input, db)
        elif state == "SEND_INVOICE_PHONE":
            response = await _send_invoice_phone(session, user_input)
        elif state == "SEND_INVOICE_AMOUNT":
            response = await _send_invoice_amount(session, user_input, db)
        else:
            session.clear_flow_data()
            response = t("ussd.main_menu", lang)
    except Exception as exc:
        logger.error("ussd.state_machine_error", state=state, error=str(exc))
        session.clear_flow_data()
        response = t("ussd.error", lang)

    await session.save()
    return response


# ── Main menu ─────────────────────────────────────────────────────────────────


async def _main_menu(session: USSDSession, choice: str, db) -> str:
    lang = session.language
    if not choice:
        return t("ussd.main_menu", lang)

    if choice == "1":
        session.transition("RECORD_SALE_ITEM")
        return t("ussd.sale.enter_item", lang)

    if choice == "2":
        session.transition("CHECK_STOCK_ITEM")
        return t("ussd.stock.enter_item", lang)

    if choice == "3":
        return await _today_summary(session, db)

    if choice == "4":
        session.transition("SEND_INVOICE_PHONE")
        return await _send_invoice_phone(session, "")

    if choice == "5":
        return await _outstanding_balances(session, db)

    if choice == "6":
        return await _credit_score(session, db)

    return t("ussd.invalid_choice", lang)


# ── Record Sale flow ──────────────────────────────────────────────────────────


async def _record_sale_item(session: USSDSession, item_name: str, db) -> str:
    lang = session.language
    if not item_name:
        return t("ussd.sale.enter_item", lang)

    # Try to look up the item in inventory
    from sqlalchemy import select

    from apps.api.modules.inventory.models import Item

    result = await db.execute(
        select(Item)
        .where(
            Item.business_id == _uuid.UUID(session.business_id),
            Item.name.ilike(f"%{item_name}%"),
            Item.deleted_at.is_(None),
        )
        .limit(1)
    )
    item = result.scalar_one_or_none()

    session.transition(
        "RECORD_SALE_QTY",
        item_name=item.name if item else item_name,
        item_id=str(item.id) if item else None,
        item_sell_price=str(item.sell_price) if item else None,
    )
    if item:
        return f"CON {item.name} (GH₵{item.sell_price}/unit)\n{t('ussd.sale.enter_qty', lang).removeprefix('CON ')}"
    return f"CON {item_name}\n{t('ussd.sale.enter_qty', lang).removeprefix('CON ')}"


async def _record_sale_qty(session: USSDSession, qty_str: str) -> str:
    lang = session.language
    try:
        qty = Decimal(qty_str)
        if qty <= 0:
            raise ValueError
    except (InvalidOperation, ValueError):
        return t("ussd.invalid_choice", lang)

    session.transition("RECORD_SALE_PRICE", qty=qty_str)

    # If we know the sell price, suggest it
    suggested = session.data.get("item_sell_price")
    prompt = t("ussd.sale.enter_price", lang)
    if suggested:
        return f"{prompt} ({suggested})"
    return prompt


async def _record_sale_price(session: USSDSession, price_str: str) -> str:
    lang = session.language
    try:
        price = Decimal(price_str)
        if price <= 0:
            raise ValueError
    except (InvalidOperation, ValueError):
        return t("ussd.sale.enter_price", lang)

    qty = Decimal(session.data["qty"])
    total = (qty * price).quantize(Decimal("0.01"))
    item_name = session.data["item_name"]

    session.transition("RECORD_SALE_CONFIRM", unit_price=price_str, total=str(total))
    return t("ussd.sale.confirm", lang, qty=qty, item=item_name, price=price, total=total)


async def _record_sale_confirm(session: USSDSession, choice: str, db) -> str:
    lang = session.language
    if choice == "2":
        session.clear_flow_data()
        return t("ussd.sale.cancelled", lang)

    if choice != "1":
        return t("ussd.invalid_choice", lang)

    import uuid as _uuid

    from apps.api.modules.sales.schemas import SaleCreate, SaleItemInput
    from apps.api.modules.sales.service import SalesService

    data = session.data
    item_id = data.get("item_id")
    sale_data = SaleCreate(
        items=[
            SaleItemInput(
                item_id=_uuid.UUID(item_id) if item_id else None,
                description=data["item_name"],
                qty=Decimal(data["qty"]),
                unit_price=Decimal(data["unit_price"]),
            )
        ],
        payment_method="cash",
        idempotency_key=str(_uuid.uuid4()),
    )

    svc = SalesService(db)
    result = await svc.record_sale(
        business_id=_uuid.UUID(session.business_id),
        user_id=_uuid.UUID(session.user_id),
        data=sale_data,
    )
    await db.commit()

    session.clear_flow_data()
    return t(
        "ussd.sale.recorded",
        lang,
        qty=data["qty"],
        item=data["item_name"],
        total=f"{result.total:.2f}",
    )


# ── Send Invoice flow ─────────────────────────────────────────────────────────


async def _send_invoice_phone(session: USSDSession, phone_str: str) -> str:
    """Collect recipient phone for quick invoice."""
    import re

    lang = session.language
    if not phone_str:
        return t("ussd.invoice.enter_phone", lang)

    digits = re.sub(r"\D", "", phone_str)
    if len(digits) not in (9, 10, 12):
        return t("ussd.invoice.invalid_phone", lang)

    # Normalise to E.164
    if digits.startswith("0"):
        phone_e164 = f"+233{digits[1:]}"
    elif digits.startswith("233"):
        phone_e164 = f"+{digits}"
    else:
        phone_e164 = f"+233{digits}"

    session.transition("SEND_INVOICE_AMOUNT", customer_phone=phone_e164)
    return t("ussd.invoice.enter_amount", lang)


async def _send_invoice_amount(session: USSDSession, amount_str: str, db) -> str:
    """Create a GRA-compliant standalone invoice and queue WhatsApp delivery."""
    import uuid as _uuid
    from decimal import Decimal, InvalidOperation

    lang = session.language
    try:
        amount = Decimal(amount_str)
        if amount <= 0:
            raise ValueError
    except (InvalidOperation, ValueError):
        return t("ussd.invoice.invalid_amount", lang)

    customer_phone = session.data.get("customer_phone", "")

    try:
        from sqlalchemy import select

        from apps.api.modules.business.models import Business
        from apps.api.modules.invoicing.service import InvoicingService
        from apps.api.workers.dispatch import enqueue_task

        biz_result = await db.execute(
            select(Business).where(Business.id == _uuid.UUID(session.business_id))
        )
        business = biz_result.scalar_one_or_none()
        supplier_name = business.name if business else "Business"
        supplier_tin = business.tin if business else None
        supplier_address = business.address if business else None

        svc = InvoicingService(db)
        invoice = await svc.generate_standalone(
            business_id=_uuid.UUID(session.business_id),
            supplier_name=supplier_name,
            supplier_tin=supplier_tin,
            supplier_address=supplier_address,
            customer_name=None,
            customer_tin=None,
            customer_phone=customer_phone,
            customer_address=None,
            line_items=[
                {
                    "description": "Quick Invoice",
                    "qty": Decimal("1"),
                    "unit_price": amount,
                }
            ],
            invoice_type="invoice",
        )
        await db.commit()

        # Queue WhatsApp notification to customer
        try:
            from apps.api.workers.tasks.notification_tasks import send_notification

            enqueue_task(
                send_notification,
                session.business_id,
                "invoice.created_ussd",
                {
                    "invoice_number": invoice.invoice_number,
                    "amount": str(invoice.total),
                    "customer_phone": customer_phone,
                },
            )
        except Exception:
            logger.warning(
                "ussd.notification_failed"
            )  # notification failure must not block the USSD response

        session.clear_flow_data()
        return t(
            "ussd.invoice.created",
            lang,
            number=invoice.invoice_number,
            total=f"{invoice.total:.2f}",
            phone=customer_phone,
        )
    except Exception as exc:
        logger.error("ussd.invoice_create_failed", error=str(exc))
        session.clear_flow_data()
        return t("ussd.invoice.failed", lang)


# ── Check Stock flow ──────────────────────────────────────────────────────────


async def _check_stock_item(session: USSDSession, item_name: str, db) -> str:
    lang = session.language
    if not item_name:
        return t("ussd.stock.enter_item", lang)

    from sqlalchemy import select

    from apps.api.modules.inventory.models import Item

    result = await db.execute(
        select(Item)
        .where(
            Item.business_id == _uuid.UUID(session.business_id),
            Item.name.ilike(f"%{item_name}%"),
            Item.deleted_at.is_(None),
        )
        .limit(5)
    )
    items = result.scalars().all()
    session.clear_flow_data()

    if not items:
        return t("ussd.stock.not_found", lang)

    # Return first match with i18n template; extra matches appended as plain text
    first = items[0]
    response = t(
        "ussd.stock.result", lang, item=first.name, qty=first.current_stock, unit=first.unit
    )
    if len(items) > 1:
        extra = "\n".join(f"{i.name}: {i.current_stock} {i.unit}" for i in items[1:])
        response = response.removeprefix("END ") + f"\n{extra}"
        response = f"END {response}"
    return response


# ── Today's Summary ───────────────────────────────────────────────────────────


async def _today_summary(session: USSDSession, db) -> str:
    import uuid as _uuid
    from datetime import date

    from apps.api.modules.sales.service import SalesService

    lang = session.language
    svc = SalesService(db)
    data = await svc.get_daily_summary(_uuid.UUID(session.business_id), str(date.today()))
    session.clear_flow_data()
    return t(
        "ussd.summary.result",
        lang,
        revenue=f"{data['total_revenue']:.2f}",
        count=data["total_sales"],
        cash=f"{data['cash_revenue']:.2f}",
        momo=f"{data['momo_revenue']:.2f}",
    )


# ── Outstanding Balances ──────────────────────────────────────────────────────


async def _outstanding_balances(session: USSDSession, db) -> str:
    from sqlalchemy import func, select

    from apps.api.modules.sales.models import Customer, Receivable

    result = await db.execute(
        select(
            Customer.name,
            func.sum(Receivable.balance_due).label("owed"),
        )
        .join(Receivable, Receivable.customer_id == Customer.id)
        .where(
            Customer.business_id == _uuid.UUID(session.business_id),
            Receivable.balance_due > 0,
        )
        .group_by(Customer.id)
        .order_by(func.sum(Receivable.balance_due).desc())
        .limit(5)
    )
    rows = result.all()
    session.clear_flow_data()

    lang = session.language
    total = sum(r.owed for r in rows) if rows else 0
    if not rows:
        return t("ussd.receivables.result", lang, total="0.00", count=0)

    lines = [f"{r.name or 'Unknown'}: GH₵{r.owed:.2f}" for r in rows]
    return (
        t("ussd.receivables.result", lang, total=f"{total:.2f}", count=len(rows))
        + "\n"
        + "\n".join(lines)
    )


# ── Credit Score ──────────────────────────────────────────────────────────────


async def _credit_score(session: USSDSession, db) -> str:
    from sqlalchemy import select

    from apps.api.modules.credit.models import CreditScore

    result = await db.execute(
        select(CreditScore)
        .where(CreditScore.business_id == _uuid.UUID(session.business_id))
        .order_by(CreditScore.computed_at.desc())
        .limit(1)
    )
    score = result.scalar_one_or_none()
    lang = session.language
    session.clear_flow_data()

    if not score:
        return t("ussd.credit.none", lang)

    return t(
        "ussd.credit.result",
        lang,
        score=score.score,
        band=score.band,
        max_loan=f"{score.max_loan_amount:.2f}",
    )
