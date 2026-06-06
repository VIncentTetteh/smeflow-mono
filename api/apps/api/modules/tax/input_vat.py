"""Input VAT record model and router.

Businesses that purchase from VAT-registered suppliers can claim input VAT
against their output VAT liability. This module records those purchases so
TaxService.generate_monthly_return() can compute the correct net VAT payable.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Numeric, String, func, select
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.core.database import Base, get_db
from apps.api.core.dependencies import RequireRole, get_current_business_id, get_current_user_id

router = APIRouter()


class InputVATRecord(Base):
    """Records VAT paid on purchases from VAT-registered suppliers."""

    __tablename__ = "input_vat_records"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    supplier_tin: Mapped[str | None] = mapped_column(String(20))
    invoice_ref: Mapped[str | None] = mapped_column(String(100))
    purchase_date: Mapped[date] = mapped_column(nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500))
    recorded_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class InputVATCreate(BaseModel):
    supplier_name: str = Field(..., min_length=1, max_length=255)
    supplier_tin: str | None = None
    invoice_ref: str | None = None
    purchase_date: date
    subtotal: Decimal = Field(..., gt=0)
    vat_amount: Decimal = Field(..., ge=0)
    notes: str | None = None

    @property
    def total(self) -> Decimal:
        return self.subtotal + self.vat_amount


class InputVATResponse(BaseModel):
    id: UUID
    supplier_name: str
    supplier_tin: str | None
    invoice_ref: str | None
    purchase_date: date
    subtotal: Decimal
    vat_amount: Decimal
    total: Decimal
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/input-vat", status_code=201, response_model=InputVATResponse)
async def record_input_vat(
    body: InputVATCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> InputVATResponse:
    """Record VAT paid on a supplier purchase invoice.

    This amount will be deducted from output VAT in the monthly tax return,
    reducing the net VAT payable to GRA.
    """
    record = InputVATRecord(
        business_id=business_id,
        supplier_name=body.supplier_name,
        supplier_tin=body.supplier_tin,
        invoice_ref=body.invoice_ref,
        purchase_date=body.purchase_date,
        subtotal=body.subtotal,
        vat_amount=body.vat_amount,
        total=body.subtotal + body.vat_amount,
        notes=body.notes,
        recorded_by=user_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return InputVATResponse.model_validate(record)


@router.get("/input-vat")
async def list_input_vat(
    year: int,
    month: int,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List input VAT records for a given month and compute total claimable."""
    import calendar

    period_start = date(year, month, 1)
    period_end = date(year, month, calendar.monthrange(year, month)[1])

    result = await db.execute(
        select(InputVATRecord)
        .where(
            InputVATRecord.business_id == business_id,
            InputVATRecord.purchase_date >= period_start,
            InputVATRecord.purchase_date <= period_end,
        )
        .order_by(InputVATRecord.purchase_date)
    )
    records = result.scalars().all()
    total_claimable = sum(r.vat_amount for r in records)

    return {
        "period": f"{year}-{month:02d}",
        "total_input_vat_claimable": float(total_claimable),
        "record_count": len(records),
        "records": [
            {
                "id": str(r.id),
                "supplier_name": r.supplier_name,
                "supplier_tin": r.supplier_tin,
                "invoice_ref": r.invoice_ref,
                "purchase_date": r.purchase_date.isoformat(),
                "subtotal": float(r.subtotal),
                "vat_amount": float(r.vat_amount),
                "total": float(r.total),
            }
            for r in records
        ],
    }
