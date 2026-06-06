"""Inventory ORM models: ItemCategory, Item, StockTransaction."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base


class ItemCategory(Base):
    __tablename__ = "item_categories"
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_category_name"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    items: Mapped[list["Item"]] = relationship(back_populates="category")


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        UniqueConstraint("business_id", "sku", name="uq_item_sku"),
        Index("ix_items_business_active", "business_id", postgresql_where="deleted_at IS NULL"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    category_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("item_categories.id")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(100))
    unit: Mapped[str] = mapped_column(String(30), nullable=False)
    cost_price: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0")
    )
    sell_price: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    current_stock: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("0"))
    low_stock_threshold: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=Decimal("5"))
    barcode: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    category: Mapped["ItemCategory | None"] = relationship(back_populates="items")
    stock_transactions: Mapped[list["StockTransaction"]] = relationship(back_populates="item")


class StockTransaction(Base):
    __tablename__ = "stock_transactions"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    item_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("items.id"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # purchase, sale, damage, adjustment, transfer
    qty_change: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    qty_before: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    qty_after: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    reference_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    reference_type: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    client_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    item: Mapped["Item"] = relationship(back_populates="stock_transactions")


class StockReservation(Base):
    __tablename__ = "stock_reservations"
    __table_args__ = (
        Index("idx_stock_reservation_item_status", "item_id", "status", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    payment_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payments.id"), nullable=False, index=True
    )
    item_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("items.id"), nullable=False, index=True
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
