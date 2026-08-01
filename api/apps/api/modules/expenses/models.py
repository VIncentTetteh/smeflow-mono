"""Expense ORM model."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.core.database import Base

SOURCE_MANUAL = "manual"
SOURCE_PAYROLL = "payroll"


class Expense(Base):
    """
    Money spent running the business.

    `category` is validated against expenses.categories.CATEGORY_KEYS rather than
    being a foreign key — the category set is a fixed constant, not per-business data.

    Rows with source != 'manual' are system-generated (e.g. a disbursed payroll run)
    and are immutable through the API.
    """

    __tablename__ = "expenses"
    __table_args__ = (
        Index(
            "ix_expenses_business_date",
            "business_id",
            "expense_date",
            postgresql_where="deleted_at IS NULL",
        ),
        # Makes system-generated postings idempotent: a retried payroll disbursement
        # cannot create a second wages expense for the same run.
        Index(
            "uq_expenses_source",
            "business_id",
            "source",
            "source_id",
            unique=True,
            postgresql_where="source_id IS NOT NULL",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    # VAT-inclusive amount actually paid.
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    # Informational only — deliberately NOT posted to input_vat_records, which the
    # Tax screen owns. Unifying the two entry points is tracked as a follow-up.
    vat_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False, default="cash")
    vendor_name: Mapped[str | None] = mapped_column(String(255))
    reference: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default=SOURCE_MANUAL)
    source_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    recorded_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
