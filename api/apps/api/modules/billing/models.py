"""Billing ORM models: Subscription, BillingTransaction."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base


# ── Plan definitions (authoritative constant, not a table) ────────────────────
UNLIMITED = -1


def plan_price(plan: dict, billing_interval: str | None = "monthly") -> Decimal:
    """Return the chargeable amount for a plan/interval pair."""
    if (billing_interval or "monthly") == "annual":
        return Decimal(str(plan.get("annual_price_ghs", plan["price_ghs"])))
    return Decimal(str(plan["price_ghs"]))


PLANS: dict[str, dict] = {
    "free": {
        "price_ghs": Decimal("0"),
        "annual_price_ghs": Decimal("0"),
        "interval": None,
        "billing_intervals": [],
        "support_sla": "Community",
        "features": [
            "POS cart, barcode scan, cash, MoMo, and GhQR payments",
            "50 inventory items and 50 customer records",
            "30 AI messages per month in English",
            "30-day sales and stock movement history",
        ],
        "sale_limit": UNLIMITED,
        "staff_limit": 1,
        "monthly_sales": UNLIMITED,
        "items": 50,
        "item_categories": 5,
        "customers": 50,
        "invoices": 0,
        "monthly_invoices": 0,
        "employees": 0,
        "ai_messages": 30,
        "sales_history_days": 30,
        "stock_history_days": 30,
        "businesses": 1,
        "included_businesses": 1,
        "users": 1,
        "field_agents": 0,
        "languages": ["en"],
        "analytics": False,
        "credit_scoring": False,
        "tax_summary": False,
        "gra_submission": False,
        "input_vat_tracking": False,
        "export": False,
        "invoice_pdf": False,
        "storefront": False,
        "invoice_templates": None,
        "recurring_invoices": False,
        "bulk_csv_import": False,
        "bulk_momo_payout": False,
        "cost_margin_tracking": False,
        "business_insights": False,
        "api_access": False,
    },
    "starter": {
        "price_ghs": Decimal("49"),
        "annual_price_ghs": Decimal("490"),
        "interval": "month",
        "billing_intervals": ["monthly", "annual"],
        "support_sla": "Email (48h SLA)",
        "features": [
            "500 inventory items",
            "500 customer records",
            "20 invoices per month with PDFs",
            "3 employee records with payroll",
            "300 AI messages per month in English, Twi, and Pidgin",
            "Credit score and loan offers",
        ],
        "sale_limit": UNLIMITED,
        "staff_limit": 1,
        "monthly_sales": UNLIMITED,
        "items": 500,
        "item_categories": 25,
        "customers": 500,
        "invoices": 20,
        "monthly_invoices": 20,
        "employees": 3,
        "ai_messages": 300,
        "sales_history_months": 12,
        "stock_history_months": 12,
        "businesses": 1,
        "included_businesses": 1,
        "users": 1,
        "field_agents": 0,
        "languages": ["en", "tw", "pcm"],
        "analytics": "basic",
        "credit_scoring": True,
        "tax_summary": True,
        "gra_submission": False,
        "input_vat_tracking": False,
        "export": True,
        "invoice_pdf": True,
        "storefront": True,
        "invoice_templates": "basic",
        "recurring_invoices": False,
        "bulk_csv_import": False,
        "bulk_momo_payout": False,
        "cost_margin_tracking": True,
        "business_insights": True,
        "api_access": False,
    },
    "pro": {
        "price_ghs": Decimal("149"),
        "annual_price_ghs": Decimal("1490"),
        "interval": "month",
        "billing_intervals": ["monthly", "annual"],
        "support_sla": "Priority (12h SLA) + WhatsApp",
        "features": [
            "Unlimited inventory",
            "Unlimited customers, invoices, payroll, and AI",
            "1 owner + up to 5 staff",
            "Unlimited field agents",
            "3 included businesses",
            "Advanced analytics, tax, and compliance",
        ],
        "sale_limit": None,  # unlimited
        "staff_limit": 6,
        "monthly_sales": UNLIMITED,
        "items": UNLIMITED,
        "item_categories": UNLIMITED,
        "customers": UNLIMITED,
        "invoices": UNLIMITED,
        "monthly_invoices": UNLIMITED,
        "employees": UNLIMITED,
        "ai_messages": UNLIMITED,
        "sales_history_days": UNLIMITED,
        "stock_history_days": UNLIMITED,
        "businesses": 3,
        "included_businesses": 3,
        "extra_business_price_ghs": Decimal("49"),
        "users": 6,
        "field_agents": UNLIMITED,
        "languages": ["en", "tw", "pcm"],
        "analytics": "full",
        "credit_scoring": True,
        "tax_summary": True,
        "gra_submission": True,
        "input_vat_tracking": True,
        "export": True,
        "invoice_pdf": True,
        "storefront": True,
        "invoice_templates": "custom",
        "recurring_invoices": True,
        "bulk_csv_import": True,
        "bulk_momo_payout": True,
        "cost_margin_tracking": True,
        "business_insights": True,
        "api_access": True,
    },
}


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, unique=True, index=True
    )
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    billing_interval: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # active, past_due, cancelled, trialing
    current_period_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    billing_retry_count: Mapped[int] = mapped_column(default=0)
    next_billing_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    momo_phone: Mapped[str | None] = mapped_column(String(15))  # recurring payment phone
    external_ref: Mapped[str | None] = mapped_column(String(100))  # legacy MoMo ref / Paystack ref
    # Paystack Subscriptions API fields
    paystack_subscription_code: Mapped[str | None] = mapped_column(String(100))
    paystack_plan_code: Mapped[str | None] = mapped_column(String(100))
    paystack_email_token: Mapped[str | None] = mapped_column(
        String(255)
    )  # required for cancellation
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    transactions: Mapped[list["BillingTransaction"]] = relationship(back_populates="subscription")


class BillingTransaction(Base):
    __tablename__ = "billing_transactions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    subscription_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("subscriptions.id"), nullable=False, index=True
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(5), default="GHS")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # pending, success, failed
    payment_method: Mapped[str] = mapped_column(String(20), default="momo")
    provider_ref: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    subscription: Mapped["Subscription"] = relationship(back_populates="transactions")
