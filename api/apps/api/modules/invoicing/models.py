"""Invoicing ORM models: Invoice, InvoiceItem."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("business_id", "invoice_number", name="uq_invoice_number"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    sale_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("sales.id"))
    original_invoice_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("invoices.id"), nullable=True
    )
    invoice_number: Mapped[str] = mapped_column(String(50), nullable=False)
    type: Mapped[str] = mapped_column(
        String(20), default="invoice"
    )  # invoice, receipt, credit_note, debit_note
    status: Mapped[str] = mapped_column(
        String(20), default="issued"
    )  # draft, issued, paid, cancelled

    # Supplier (GRA required)
    supplier_tin: Mapped[str | None] = mapped_column(String(20))
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    supplier_address: Mapped[str | None] = mapped_column(Text)

    # Customer
    customer_tin: Mapped[str | None] = mapped_column(String(20))
    customer_name: Mapped[str | None] = mapped_column(String(255))
    customer_phone: Mapped[str | None] = mapped_column(String(20))
    customer_email: Mapped[str | None] = mapped_column(String(255))
    customer_address: Mapped[str | None] = mapped_column(Text)

    # Amounts (GRA breakdown)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    nhil_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    getfund_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    covid_levy: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    # GRA e-VAT compliance
    qr_payload: Mapped[str | None] = mapped_column(Text)
    qr_image_url: Mapped[str | None] = mapped_column(Text)
    digital_signature: Mapped[str | None] = mapped_column(Text)
    verification_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    gra_submission_id: Mapped[str | None] = mapped_column(String(100))
    gra_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # GhQR payment
    ghqr_payload: Mapped[str | None] = mapped_column(Text)
    ghqr_image_url: Mapped[str | None] = mapped_column(Text)

    # PDF
    pdf_url: Mapped[str | None] = mapped_column(Text)

    # Paystack payment link — generated when invoice is issued, embedded in PDF/SMS
    paystack_payment_url: Mapped[str | None] = mapped_column(Text)

    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    balance_due: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    line_items: Mapped[list["InvoiceItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )

    @property
    def effective_status(self) -> str:
        if self.status in {"paid", "cancelled"}:
            return self.status
        if self.due_date and datetime.now(timezone.utc).date() > self.due_date.date():
            return "overdue"
        return "due" if self.status == "issued" else self.status
    original_invoice: Mapped["Invoice | None"] = relationship(
        remote_side=[id], foreign_keys=[original_invoice_id]
    )


class InvoiceItem(Base):
    __tablename__ = "invoice_items"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    invoice_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(30))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))

    invoice: Mapped["Invoice"] = relationship(back_populates="line_items")
