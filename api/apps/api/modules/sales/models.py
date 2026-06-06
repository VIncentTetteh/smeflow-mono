"""Sales ORM models: Customer, Sale, SaleItem, Receivable."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        # Partial unique index: only one customer row per (business, phone) when phone is set.
        # Allows unlimited anonymous customers (phone IS NULL) for the same business.
        Index(
            "uq_customer_phone",
            "business_id",
            "phone",
            unique=True,
            postgresql_where="phone IS NOT NULL",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    name: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(15), index=True)
    tin: Mapped[str | None] = mapped_column(String(20))
    reminder_consent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reminder_channel: Mapped[str | None] = mapped_column(String(20))
    reminder_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_consent_source: Mapped[str | None] = mapped_column(String(80))
    reminder_opt_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sales: Mapped[list["Sale"]] = relationship(back_populates="customer")


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        # Phase 5: Performance indexes for analytics queries
        Index("idx_sale_business_created", "business_id", "created_at"),
        Index("idx_sale_business_status_created", "business_id", "status", "created_at"),
        Index("idx_sale_business_payment_method", "business_id", "payment_method"),
        Index("idx_sale_customer_created", "customer_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    customer_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customers.id")
    )
    recorded_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(
        String(20), default="completed"
    )  # completed, partial, credit, voided
    payment_method: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # cash, momo, credit, mixed
    subtotal: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    balance_due: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True, index=True)
    client_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list["SaleItem"]] = relationship(
        back_populates="sale", cascade="all, delete-orphan"
    )
    customer: Mapped["Customer | None"] = relationship(back_populates="sales")
    receivable: Mapped["Receivable | None"] = relationship(back_populates="sale", uselist=False)

    @property
    def credit_due_date(self) -> datetime | None:
        return self.receivable.due_date if self.receivable else None


class SaleItem(Base):
    __tablename__ = "sale_items"
    __table_args__ = (
        # Phase 5: Performance indexes for inventory and analytics
        Index("idx_sale_item_item_id", "item_id"),
        Index("idx_sale_item_sale_id", "sale_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    sale_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("sales.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("items.id"))
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    discount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    line_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    # COGS snapshot — cost_price captured from the inventory item at sale time.
    # NULL for non-inventory line items (ad-hoc / service descriptions).
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))

    sale: Mapped["Sale"] = relationship(back_populates="items")


class Receivable(Base):
    __tablename__ = "receivables"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    sale_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("sales.id"))
    customer_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customers.id")
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    balance_due: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    status: Mapped[str] = mapped_column(
        String(20), default="outstanding"
    )  # outstanding, partial, settled, written_off
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reminder_key: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sale: Mapped["Sale | None"] = relationship(back_populates="receivable")
