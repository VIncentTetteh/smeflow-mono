"""Payment ORM model."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.core.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    invoice_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("invoices.id"))
    sale_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("sales.id"))
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # collection, disbursement
    provider: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # mtn, vodafone, airteltigo, cash, ghqr
    processor: Mapped[str | None] = mapped_column(String(30))
    channel: Mapped[str | None] = mapped_column(String(50))
    provider_detail: Mapped[str | None] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="GHS")
    phone: Mapped[str | None] = mapped_column(String(15))
    external_ref: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    internal_ref: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(
        String(20), default="pending"
    )  # pending, success, failed, reversed
    provider_status: Mapped[str | None] = mapped_column(String(50))
    provider_message: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True, index=True)
    initiated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
