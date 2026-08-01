#!/usr/bin/env python3
"""Seed a rich demo dataset for SMEflow (for demos / manual QA).

Creates one fully-populated business — owner + team, inventory, customers, a
month of sales (so analytics/P&L/cash-flow light up), employees for payroll —
plus two loan providers with loan products.

Usage (run from the api/ directory, or inside the api container):
    python -m scripts.seed_demo            # create demo data (no-op if it exists)
    python -m scripts.seed_demo --reset    # delete existing demo data, then recreate

All demo records use stable markers so --reset removes exactly what this script
created and nothing else:
    - users:   phone starts with +23320000000, or email ends @demo.smeflow.app
    - business: name = "Ama's Provisions"
    - lenders:  lender_id starts with "demo-"
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, select

from sqlalchemy import text

from apps.api.core.database import AsyncSessionLocal
from apps.api.modules.auth.models import User
from apps.api.modules.business.models import Business, BusinessMember, MoMoAccount
from apps.api.modules.inventory.models import Item, ItemCategory, StockTransaction
from apps.api.modules.inventory.supplier_models import (
    PurchaseOrder,
    PurchaseOrderItem,
    Supplier,
)
from apps.api.modules.invoicing.models import Invoice, InvoiceItem
from apps.api.modules.lender.models import LenderPartner, LoanProduct
from apps.api.modules.payments.models import Payment
from apps.api.modules.lender.service import LenderService
from apps.api.modules.payroll.models import Employee, PayrollRun, Payslip
from apps.api.modules.payroll.schemas import PayrollRunCreate
from apps.api.modules.payroll.service import PayrollService
from apps.api.modules.sales.models import Customer, Receivable, Sale, SaleItem

DEMO_BUSINESS_NAME = "Ama's Provisions"
DEMO_PHONE_PREFIX = "+23320000000"  # owner/manager/staff use +233200000001..09
DEMO_EMAIL_DOMAIN = "@demo.smeflow.app"
DEMO_LENDER_PREFIX = "demo-"

random.seed(42)  # deterministic demo data


# ── Catalog ─────────────────────────────────────────────────────────────────────
CATEGORIES = ["Beverages", "Groceries", "Household", "Snacks"]

# (name, category, unit, cost_price, sell_price, stock, low_stock_threshold)
ITEMS = [
    ("Voltic Water 750ml", "Beverages", "bottle", "2.00", "3.50", 120, 24),
    ("Coca-Cola 350ml", "Beverages", "bottle", "3.50", "5.00", 8, 24),  # low stock
    ("Kalyppo Juice", "Beverages", "pack", "2.20", "3.50", 60, 20),
    ("Milo Sachet", "Beverages", "sachet", "1.50", "2.50", 200, 40),
    ("Rice (Perfumed) 5kg", "Groceries", "bag", "60.00", "78.00", 30, 6),
    ("Cooking Oil 1L", "Groceries", "bottle", "22.00", "30.00", 45, 10),
    ("Sugar 1kg", "Groceries", "bag", "12.00", "17.00", 5, 10),  # low stock
    ("Gari 1 olonka", "Groceries", "olonka", "18.00", "25.00", 40, 8),
    ("Tomato Paste tin", "Groceries", "tin", "4.00", "6.00", 90, 20),
    ("Key Soap bar", "Household", "bar", "3.00", "5.00", 150, 30),
    ("Toilet Roll (4-pack)", "Household", "pack", "9.00", "14.00", 70, 15),
    ("Detergent 900g", "Household", "pack", "16.00", "23.00", 25, 6),
    ("Biscuits (Digestive)", "Snacks", "pack", "5.00", "8.00", 3, 12),  # low stock
    ("Groundnut (roasted)", "Snacks", "cup", "2.00", "4.00", 80, 15),
]

CUSTOMERS = [
    ("Adjoa Boateng", "+233241000101", True),
    ("Kofi Owusu", "+233241000102", True),
    ("Yaa Asantewaa", "+233241000103", False),
    ("Kwesi Appiah", "+233241000104", True),
    ("Abena Serwaa", "+233241000105", False),
    ("Fiifi Mensah", "+233241000106", True),
    ("Esi Cudjoe", "+233241000107", False),
    ("Nana Yaw", "+233241000108", True),
    ("Ama Ofori", "+233241000109", True),
    ("Kojo Antwi", "+233241000110", False),
    ("Akua Donkor", "+233241000111", True),
    ("Yaw Darko", "+233241000112", True),
    ("Afia Pokua", "+233241000113", False),
    ("Kwabena Osei", "+233241000114", True),
    ("Adwoa Badu", "+233241000115", True),
    ("Kojo Bonsu", "+233241000116", False),
]

# (name, phone, role, base_pay, ssnit)
EMPLOYEES = [
    ("Kwame Nkrumah", "+233245000201", "Shop Assistant", "900.00", "C1234567890"),
    ("Efua Sutherland", "+233245000202", "Cashier", "1100.00", "C1234567891"),
    ("Yaw Boakye", "+233245000203", "Stock Keeper", "1000.00", "C1234567892"),
    ("Adwoa Smith", "+233245000204", "Sales Lead", "1500.00", "C1234567893"),
]

TEAM = [
    # (name, phone, email, role)
    ("Ama Mensah", "+233200000001", "ama" + DEMO_EMAIL_DOMAIN, "owner"),
    ("Kwabena Manager", "+233200000002", "kwabena" + DEMO_EMAIL_DOMAIN, "manager"),
    ("Akosua Staff", "+233200000003", "akosua" + DEMO_EMAIL_DOMAIN, "staff"),
]

SUPPLIERS = [
    # (name, phone, email, address)
    ("Accra Wholesale Ltd", "+233302000301", "sales@accrawholesale.gh", "Industrial Area, Accra"),
    ("Kumasi Distributors", "+233322000302", "orders@kumasidist.gh", "Adum, Kumasi"),
    ("Tema Beverages Co", "+233303000303", "supply@temabev.gh", "Tema Harbour"),
]

LENDERS = [
    # (lender_id, name, contact_email)
    ("demo-adansi", "Adansi Rural Bank", "credit" + DEMO_EMAIL_DOMAIN),
    ("demo-fido", "Fido Microfinance", "partners" + DEMO_EMAIL_DOMAIN),
]

LOAN_PRODUCTS = {
    "demo-adansi": [
        ("Market Trader Boost", "Short-term working capital for market traders.",
         "500", "5000", "0.36", 30, 180, "C"),
        ("SME Growth Loan", "Larger facility for growing shops.",
         "5000", "50000", "0.30", 90, 365, "B"),
    ],
    "demo-fido": [
        ("Quick Cash", "Fast micro-loan disbursed to MoMo.",
         "200", "2000", "0.42", 14, 90, "C"),
    ],
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _demo_exists(db) -> bool:
    existing = await db.execute(select(Business).where(Business.name == DEMO_BUSINESS_NAME))
    return existing.scalar_one_or_none() is not None


async def reset_demo(db) -> None:
    """Delete everything this script creates (business-scoped + demo users/lenders)."""
    biz = (
        await db.execute(select(Business).where(Business.name == DEMO_BUSINESS_NAME))
    ).scalar_one_or_none()

    if biz:
        bid = biz.id
        # 1. Child rows that have no business_id column (must go before their parents).
        sale_ids = (
            await db.execute(select(Sale.id).where(Sale.business_id == bid))
        ).scalars().all()
        if sale_ids:
            await db.execute(delete(SaleItem).where(SaleItem.sale_id.in_(sale_ids)))
        inv_ids = (
            await db.execute(select(Invoice.id).where(Invoice.business_id == bid))
        ).scalars().all()
        if inv_ids:
            await db.execute(delete(InvoiceItem).where(InvoiceItem.invoice_id.in_(inv_ids)))
        po_ids = (
            await db.execute(select(PurchaseOrder.id).where(PurchaseOrder.business_id == bid))
        ).scalars().all()
        if po_ids:
            await db.execute(
                delete(PurchaseOrderItem).where(PurchaseOrderItem.purchase_order_id.in_(po_ids))
            )
        run_ids = (
            await db.execute(select(PayrollRun.id).where(PayrollRun.business_id == bid))
        ).scalars().all()
        if run_ids:
            await db.execute(delete(Payslip).where(Payslip.payroll_run_id.in_(run_ids)))
        await db.commit()

        # 2. Sweep EVERY table that has a business_id column (covers auto-created
        #    rows too: subscriptions, credit scores, notifications, tax, etc.).
        #    Savepoint per delete + retry rounds so FK order sorts itself out.
        tables = (
            await db.execute(
                text(
                    "SELECT table_name FROM information_schema.columns "
                    "WHERE column_name = 'business_id' AND table_schema = 'public'"
                )
            )
        ).scalars().all()
        remaining = set(tables)
        for _ in range(len(remaining) + 2):
            if not remaining:
                break
            progressed = False
            for t in list(remaining):
                try:
                    async with db.begin_nested():
                        await db.execute(
                            text(f'DELETE FROM "{t}" WHERE business_id = :bid'), {"bid": str(bid)}
                        )
                    remaining.discard(t)
                    progressed = True
                except Exception:
                    pass  # still FK-blocked by another business-scoped table; retry next round
            if not progressed:
                break
        await db.commit()

        # 3. The business row itself.
        async with db.begin_nested():
            await db.execute(delete(Business).where(Business.id == bid))
        await db.commit()

    # Demo users (owner/team) by phone prefix / email domain
    await db.execute(
        delete(User).where(
            (User.phone.like(DEMO_PHONE_PREFIX + "%")) | (User.email.like("%" + DEMO_EMAIL_DOMAIN))
        )
    )
    # Demo lenders + their loan products
    await db.execute(delete(LoanProduct).where(LoanProduct.lender_id.like(DEMO_LENDER_PREFIX + "%")))
    await db.execute(delete(LenderPartner).where(LenderPartner.lender_id.like(DEMO_LENDER_PREFIX + "%")))
    await db.commit()
    print("✓ Existing demo data removed")


async def seed(db) -> None:
    # ── Team users ──────────────────────────────────────────────────────────────
    users: dict[str, User] = {}
    for name, phone, email, role in TEAM:
        u = User(
            phone=phone,
            email=email,
            name=name,
            kyc_status="verified",
            kyc_verified_at=_now(),
            is_active=True,
        )
        db.add(u)
        users[role] = u
    await db.flush()
    owner = users["owner"]

    # ── Business ────────────────────────────────────────────────────────────────
    biz = Business(
        owner_id=owner.id,
        name=DEMO_BUSINESS_NAME,
        type="shop",
        tin="C0012345678",
        address="Stall 42, Makola Market",
        region="Greater Accra",
        city="Accra",
        market="Makola",
        momo_provider="mtn",
        tax_vat_status="registered",
        subscription="pro",
        sub_expires_at=_now() + timedelta(days=30),
        email="shop" + DEMO_EMAIL_DOMAIN,
        is_active=True,
    )
    db.add(biz)
    await db.flush()

    for role, u in users.items():
        db.add(BusinessMember(business_id=biz.id, user_id=u.id, role=role, is_active=True))
    db.add(
        MoMoAccount(
            business_id=biz.id,
            provider="mtn",
            phone="+233200000001",
            account_name="Ama Mensah",
            is_primary=True,
            is_verified=True,
            status="verified",
            verified_at=_now(),
        )
    )

    # ── Categories + items ──────────────────────────────────────────────────────
    cats: dict[str, ItemCategory] = {}
    for cname in CATEGORIES:
        c = ItemCategory(business_id=biz.id, name=cname)
        db.add(c)
        cats[cname] = c
    await db.flush()

    items: list[Item] = []
    for name, cat, unit, cost, sell, stock, low in ITEMS:
        it = Item(
            business_id=biz.id,
            category_id=cats[cat].id,
            name=name,
            unit=unit,
            cost_price=Decimal(cost),
            sell_price=Decimal(sell),
            current_stock=Decimal(stock),
            low_stock_threshold=Decimal(low),
            sku=name.split()[0].upper()[:6] + f"-{len(items) + 1:03d}",
            is_active=True,
        )
        db.add(it)
        items.append(it)
    await db.flush()

    # Opening-stock ledger entries (so stock history isn't empty)
    for it in items:
        db.add(
            StockTransaction(
                business_id=biz.id,
                item_id=it.id,
                type="purchase",
                qty_change=it.current_stock,
                qty_before=Decimal("0"),
                qty_after=it.current_stock,
                unit_cost=it.cost_price,
                notes="Opening stock (demo)",
                recorded_by=owner.id,
            )
        )

    # ── Suppliers ───────────────────────────────────────────────────────────────
    suppliers: list[Supplier] = []
    for sname, sphone, semail, saddr in SUPPLIERS:
        s = Supplier(
            business_id=biz.id,
            name=sname,
            phone=sphone,
            email=semail,
            address=saddr,
            is_active=True,
        )
        db.add(s)
        suppliers.append(s)
    await db.flush()

    # ── Purchase orders (mix of received / ordered / draft) ─────────────────────
    po_specs = [
        ("received", 30),  # received a month ago → stock already reflected
        ("received", 12),
        ("ordered", 3),  # in-flight
        ("draft", 0),  # being prepared
    ]
    po_count = 0
    for idx, (status, days_ago) in enumerate(po_specs, start=1):
        supplier = suppliers[idx % len(suppliers)]
        order_dt = _now() - timedelta(days=days_ago)
        po_items = random.sample(items, k=random.randint(2, 4))
        subtotal = Decimal("0")
        po = PurchaseOrder(
            business_id=biz.id,
            supplier_id=supplier.id,
            po_number=f"PO-{idx:04d}",
            status=status,
            order_date=order_dt if status != "draft" else None,
            expected_date=order_dt + timedelta(days=7),
            received_at=order_dt + timedelta(days=5) if status == "received" else None,
            subtotal=Decimal("0"),
            total=Decimal("0"),
            created_by=owner.id,
            created_at=order_dt,
            updated_at=order_dt,
        )
        db.add(po)
        await db.flush()
        for it in po_items:
            qty = Decimal(random.randint(10, 50))
            line_total = (it.cost_price * qty).quantize(Decimal("0.01"))
            subtotal += line_total
            db.add(
                PurchaseOrderItem(
                    purchase_order_id=po.id,
                    item_id=it.id,
                    description=it.name,
                    qty_ordered=qty,
                    qty_received=qty if status == "received" else Decimal("0"),
                    unit_cost=it.cost_price,
                    line_total=line_total,
                )
            )
        po.subtotal = subtotal
        po.total = subtotal
        po_count += 1

    # ── Customers ───────────────────────────────────────────────────────────────
    customers: list[Customer] = []
    for cname, cphone, consent in CUSTOMERS:
        cust = Customer(
            business_id=biz.id,
            name=cname,
            phone=cphone,
            reminder_consent=consent,
            reminder_channel="sms" if consent else None,
            reminder_consent_at=_now() if consent else None,
        )
        db.add(cust)
        customers.append(cust)
    await db.flush()

    # ── Sales over the last 120 days ────────────────────────────────────────────
    n_sales = 220
    sales_window_days = 120
    methods = ["cash"] * 5 + ["momo"] * 3 + ["credit"] * 2  # weighted
    sales_created = 0
    credit_created = 0
    payments_created = 0
    invoices_created = 0
    for si in range(n_sales):
        days_ago = random.randint(0, sales_window_days - 1)
        ts = _now() - timedelta(days=days_ago, hours=random.randint(0, 10), minutes=random.randint(0, 59))
        method = random.choice(methods)
        line_items = random.sample(items, k=random.randint(1, 3))
        cust = random.choice(customers) if (method == "credit" or random.random() < 0.55) else None

        subtotal = Decimal("0")
        sale = Sale(
            business_id=biz.id,
            customer_id=cust.id if cust else None,
            recorded_by=owner.id,
            status="completed",
            payment_method=method,
            subtotal=Decimal("0"),
            tax_amount=Decimal("0"),
            discount_amount=Decimal("0"),
            total=Decimal("0"),
            amount_paid=Decimal("0"),
            balance_due=Decimal("0"),
            created_at=ts,
            updated_at=ts,
        )
        db.add(sale)
        await db.flush()

        line_snaps: list[tuple[str, Decimal, Decimal, Decimal]] = []
        for it in line_items:
            qty = Decimal(random.randint(1, 5))
            line_total = (it.sell_price * qty).quantize(Decimal("0.01"))
            subtotal += line_total
            line_snaps.append((it.name, qty, it.sell_price, line_total))
            db.add(
                SaleItem(
                    sale_id=sale.id,
                    item_id=it.id,
                    description=it.name,
                    qty=qty,
                    unit_price=it.sell_price,
                    line_total=line_total,
                    cost_price=it.cost_price,  # COGS snapshot → powers P&L margin
                )
            )

        total = subtotal
        sale.subtotal = subtotal
        sale.total = total
        if method == "credit":
            sale.status = "credit"
            sale.amount_paid = Decimal("0")
            sale.balance_due = total
            db.add(
                Receivable(
                    business_id=biz.id,
                    sale_id=sale.id,
                    customer_id=sale.customer_id,
                    amount=total,
                    amount_paid=Decimal("0"),
                    balance_due=total,
                    status="outstanding",
                    due_date=ts + timedelta(days=14),
                )
            )
            credit_created += 1
        else:
            sale.amount_paid = total
            sale.balance_due = Decimal("0")
            # Payment record for cash/momo collections
            db.add(
                Payment(
                    business_id=biz.id,
                    sale_id=sale.id,
                    type="collection",
                    provider="mtn" if method == "momo" else "cash",
                    channel=method,
                    amount=total,
                    currency="GHS",
                    phone=cust.phone if cust else "+233200000001",
                    external_ref=f"demo-pay-{si:05d}",
                    status="success",
                    initiated_at=ts,
                    confirmed_at=ts,
                    created_at=ts,
                    updated_at=ts,
                )
            )
            payments_created += 1
        sales_created += 1

        # Issue a VAT invoice for ~1 in 4 sales (15% VAT on subtotal)
        if si % 4 == 0:
            vat = (subtotal * Decimal("0.15")).quantize(Decimal("0.01"))
            inv = Invoice(
                business_id=biz.id,
                sale_id=sale.id,
                invoice_number=f"INV-{invoices_created + 1:04d}",
                type="invoice",
                status="paid" if method != "credit" else "issued",
                supplier_name=DEMO_BUSINESS_NAME,
                supplier_tin="C0012345678",
                supplier_address="Stall 42, Makola Market, Accra",
                customer_name=cust.name if cust else "Walk-in customer",
                customer_phone=cust.phone if cust else None,
                subtotal=subtotal,
                vat_amount=vat,
                total=(subtotal + vat).quantize(Decimal("0.01")),
                amount_paid=(subtotal + vat).quantize(Decimal("0.01")) if method != "credit" else Decimal("0"),
                balance_due=Decimal("0") if method != "credit" else (subtotal + vat).quantize(Decimal("0.01")),
                issued_at=ts,
                paid_at=ts if method != "credit" else None,
                due_date=ts + timedelta(days=14),
                verification_id=f"demo-inv-{si:05d}",
            )
            db.add(inv)
            await db.flush()
            for desc, qty, unit_price, lt in line_snaps:
                line_vat = (lt * Decimal("0.15")).quantize(Decimal("0.01"))
                db.add(
                    InvoiceItem(
                        invoice_id=inv.id,
                        description=desc,
                        qty=qty,
                        unit_price=unit_price,
                        line_total=lt,
                        vat_rate=Decimal("15"),
                        vat_amount=line_vat,
                    )
                )
            invoices_created += 1

    # ── Employees ───────────────────────────────────────────────────────────────
    for name, phone, role, base_pay, ssnit in EMPLOYEES:
        db.add(
            Employee(
                business_id=biz.id,
                name=name,
                phone=phone,
                role=role,
                pay_type="monthly",
                base_pay=Decimal(base_pay),
                momo_phone=phone,
                momo_provider="mtn",
                ssnit_number=ssnit,
                is_active=True,
                joined_at=date.today() - timedelta(days=random.randint(60, 400)),
            )
        )

    await db.commit()

    # ── Payroll runs (last 3 months) — real SSNIT/PAYE via the service ──────────
    payroll_svc = PayrollService(db)
    payroll_runs = 0
    today = date.today()
    for months_back in (3, 2, 1):
        # step back `months_back` months from the current month
        y, m = today.year, today.month - months_back
        while m <= 0:
            m += 12
            y -= 1
        period_start = date(y, m, 1)
        # last day of that month
        nm_y, nm_m = (y + 1, 1) if m == 12 else (y, m + 1)
        period_end = date(nm_y, nm_m, 1) - timedelta(days=1)
        try:
            await payroll_svc.run_payroll(
                biz.id,
                owner.id,
                PayrollRunCreate(period_start=period_start, period_end=period_end),
            )
            await db.commit()
            payroll_runs += 1
        except Exception:
            await db.rollback()

    # ── Lenders (loan providers) + products ─────────────────────────────────────
    lender_svc = LenderService(db)
    lender_creds: list[tuple[str, str, str]] = []
    for lender_id, lname, cemail in LENDERS:
        partner, api_key, temp_pw = await lender_svc.create_partner(
            lender_id=lender_id, name=lname, contact_email=cemail, portal_email=cemail
        )
        lender_creds.append((lname, cemail, temp_pw))
        for pname, pdesc, minamt, maxamt, rate, mind, maxd, band in LOAN_PRODUCTS.get(lender_id, []):
            db.add(
                LoanProduct(
                    lender_id=lender_id,
                    name=pname,
                    description=pdesc,
                    min_amount_ghs=Decimal(minamt),
                    max_amount_ghs=Decimal(maxamt),
                    interest_rate_annual=Decimal(rate),
                    min_term_days=mind,
                    max_term_days=maxd,
                    min_credit_band=band,
                    is_active=True,
                )
            )
    await db.commit()

    # ── Summary ─────────────────────────────────────────────────────────────────
    print("\n✓ Demo data seeded")
    print(f"  Business    : {DEMO_BUSINESS_NAME} (owner: Ama Mensah, +233200000001)")
    print(f"  Team        : {len(TEAM)} members  | Employees: {len(EMPLOYEES)}")
    print(f"  Inventory   : {len(items)} items in {len(CATEGORIES)} categories")
    print(f"  Suppliers   : {len(suppliers)}  | Purchase orders: {po_count}")
    print(f"  Customers   : {len(customers)}")
    print(f"  Sales       : {sales_created}  ({credit_created} on credit) across last {sales_window_days} days")
    print(f"  Payments    : {payments_created}  | Invoices: {invoices_created}")
    print(f"  Payroll runs: {payroll_runs} months")
    print(f"  Loan providers: {len(LENDERS)}")
    print("\n  Owner logs in via phone OTP: +233200000001 (read the code from API logs in dev)")
    print("  Lender portal temporary passwords:")
    for lname, cemail, temp_pw in lender_creds:
        print(f"    - {lname}: {cemail} / {temp_pw}")


async def main_async(reset: bool) -> None:
    async with AsyncSessionLocal() as db:
        if reset:
            await reset_demo(db)
        elif await _demo_exists(db):
            print("Demo data already present. Re-run with --reset to rebuild it.")
            return
        await seed(db)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed SMEflow demo data")
    parser.add_argument("--reset", action="store_true", help="Delete existing demo data first")
    args = parser.parse_args()
    asyncio.run(main_async(args.reset))


if __name__ == "__main__":
    main()
