"""Supplier and Purchase Order ORM models."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base


class Supplier(Base):
    """A supplier or vendor that the business purchases stock from."""

    __tablename__ = "suppliers"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    tin: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    purchase_orders: Mapped[list["PurchaseOrder"]] = relationship(back_populates="supplier")


class PurchaseOrder(Base):
    """A purchase order raised against a supplier to restock inventory."""

    __tablename__ = "purchase_orders"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    supplier_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("suppliers.id")
    )
    po_number: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20), default="draft"
    )  # draft, ordered, partially_received, received, cancelled
    order_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expected_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    supplier: Mapped["Supplier | None"] = relationship(back_populates="purchase_orders")
    line_items: Mapped[list["PurchaseOrderItem"]] = relationship(back_populates="purchase_order")


class PurchaseOrderItem(Base):
    """One line item in a purchase order."""

    __tablename__ = "purchase_order_items"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    purchase_order_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("purchase_orders.id"), nullable=False, index=True
    )
    item_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("items.id"))
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    qty_ordered: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    qty_received: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0"))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    purchase_order: Mapped["PurchaseOrder"] = relationship(back_populates="line_items")
