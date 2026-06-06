"""
Merchant Settlement ORM models.

MerchantSettlement  — a single settlement request/payout record.
MerchantLedgerEntry — append-only ledger of every credit, fee, and debit
                      for a merchant's settlement wallet.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base

__all__ = ["MerchantLedgerEntry", "MerchantSettlement"]


class MerchantSettlement(Base):
    """
    One settlement event — either merchant-requested, auto (Beat task), or admin-forced.

    Status machine:
      pending → approved → processing → completed
                         ↘ cancelled
                                      ↘ failed → (retry) → processing → completed
    """

    __tablename__ = "merchant_settlements"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # null = auto-settlement Beat task
    requested_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # null = auto-approved
    approved_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Gross amount the merchant expects to receive
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    # Platform fee deducted
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    # Net amount actually transferred (amount - fee_amount)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    destination_phone: Mapped[str | None] = mapped_column(String(20))
    destination_provider: Mapped[str | None] = mapped_column(String(20))
    # Returned by Paystack POST /transfer
    paystack_transfer_code: Mapped[str | None] = mapped_column(String(100), index=True)
    # Deterministic: settle-{business_id[:12]}-{YYYYMMDD} — Paystack deduplicates by this
    paystack_reference: Mapped[str | None] = mapped_column(String(100), unique=True)
    # pending | approved | processing | completed | failed | cancelled
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    # manual | auto | admin
    mode: Mapped[str] = mapped_column(String(20), default="manual")
    failure_reason: Mapped[str | None] = mapped_column(String(500))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ledger_entries: Mapped[list["MerchantLedgerEntry"]] = relationship(
        back_populates="settlement"
    )


class MerchantLedgerEntry(Base):
    """
    Append-only ledger entry for a merchant's settlement wallet.

    Types:
      credit    — payment collected from customer (positive)
      fee       — platform fee deducted (negative)
      debit     — settlement transfer sent to merchant (negative)
      reversal  — a previously confirmed payment was reversed (negative)
      adjustment — manual admin correction (positive or negative)
    """

    __tablename__ = "merchant_ledger_entries"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Source collection payment (for credit + fee entries)
    payment_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Linked settlement (for debit entries)
    settlement_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("merchant_settlements.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # credit | fee | debit | reversal | adjustment
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Signed: positive = credit, negative = debit/fee
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    # Running balance snapshot — allows ledger reconstruction without summing all rows
    balance_after: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    settlement: Mapped["MerchantSettlement | None"] = relationship(
        back_populates="ledger_entries"
    )
