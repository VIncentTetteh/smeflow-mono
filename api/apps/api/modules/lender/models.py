"""Lender partner ORM models."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.core.database import Base


class LenderPartner(Base):
    __tablename__ = "lender_partners"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    lender_id: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_email: Mapped[str | None] = mapped_column(String(255))
    portal_email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    portal_password_hash: Mapped[str | None] = mapped_column(String(255))
    must_reset_password: Mapped[bool] = mapped_column(Boolean, default=True)
    api_key_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    api_key_hint: Mapped[str | None] = mapped_column(String(10), nullable=True)
    webhook_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    webhook_secret: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Paystack settlement subaccount for automatic revenue splitting on repayments
    paystack_subaccount_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    paystack_split_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Settlement bank details (required to create Paystack subaccount)
    settlement_bank_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    settlement_account_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    platform_fee_percent: Mapped[float | None] = mapped_column(nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rotation_alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_auth_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LoanProduct(Base):
    """A pre-published loan product offered by a lender partner."""

    __tablename__ = "loan_products"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    lender_id: Mapped[str] = mapped_column(
        String(100), ForeignKey("lender_partners.lender_id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    min_amount_ghs: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    max_amount_ghs: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    interest_rate_annual: Mapped[Decimal] = mapped_column(Numeric(6, 4), nullable=False)
    min_term_days: Mapped[int] = mapped_column(nullable=False, default=30)
    max_term_days: Mapped[int] = mapped_column(nullable=False, default=365)
    min_credit_band: Mapped[str] = mapped_column(String(1), nullable=False, default="C")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class LenderLoanRevenue(Base):
    """Platform revenue earned from lender-originated disbursed loans."""

    __tablename__ = "lender_loan_revenues"
    __table_args__ = (
        UniqueConstraint("loan_request_id", name="uq_lender_loan_revenue_loan_request"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    loan_request_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("loan_requests.id"), nullable=False, index=True
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    lender_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    principal_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    fee_rate_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="earned", index=True)
    provider_ref: Mapped[str | None] = mapped_column(String(100))
    earned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
