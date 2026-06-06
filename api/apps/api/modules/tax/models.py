"""Tax ORM models."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.core.database import Base


class TaxReturn(Base):
    __tablename__ = "tax_returns"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    period_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # monthly, quarterly, annual
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    vat_output: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    vat_input: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    vat_payable: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    nhil_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    getfund_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    covid_levy: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_tax: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    status: Mapped[str] = mapped_column(
        String(20), default="draft"
    )  # draft, submitted, accepted, rejected
    gra_ref: Mapped[str | None] = mapped_column(String(100))
    export_url: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payload_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
