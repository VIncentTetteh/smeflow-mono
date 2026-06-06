"""Admin-configurable GRA tax levy rates.

Rates default to the values in Settings (read from env) but can be overridden
per-business by an admin via POST /admin/tax-rates.  The invoicing service reads
live rates from this module so any override takes effect on the next invoice.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Numeric, String, func, select
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.core.config import get_settings
from apps.api.core.database import Base, get_db
from apps.api.core.dependencies import RequireRole, get_current_business_id

router = APIRouter()
settings = get_settings()


class TaxRateConfig(Base):
    """Override the default GRA tax levy rates for a specific business.

    Only the fields that differ from the platform defaults need to be set.
    NULL means "use the platform default from Settings".
    """

    __tablename__ = "tax_rate_configs"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("businesses.id"),
        nullable=False,
        unique=True,
        index=True,
    )
    # Rates stored as fractions (e.g. 0.15 for 15 %).  NULL = use platform default.
    vat_rate: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    nhil_rate: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    getfund_rate: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    covid_levy_rate: Mapped[Decimal | None] = mapped_column(Numeric(7, 4))
    updated_by: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ── Rate-resolution helper ─────────────────────────────────────────────────────


class EffectiveRates(BaseModel):
    """Resolved tax rates for a business, merging DB overrides with platform defaults."""

    vat_rate: Decimal
    nhil_rate: Decimal
    getfund_rate: Decimal
    covid_levy_rate: Decimal

    @property
    def total_rate(self) -> Decimal:
        return self.vat_rate + self.nhil_rate + self.getfund_rate + self.covid_levy_rate


async def get_effective_rates(business_id: UUID, db: AsyncSession) -> EffectiveRates:
    """Return the effective tax rates for a business.

    Prefers DB override rows; falls back to platform Settings values.
    """
    result = await db.execute(select(TaxRateConfig).where(TaxRateConfig.business_id == business_id))
    cfg = result.scalar_one_or_none()

    def _pick(override: Decimal | None, default: float) -> Decimal:
        return override if override is not None else Decimal(str(default))

    return EffectiveRates(
        vat_rate=_pick(getattr(cfg, "vat_rate", None), settings.VAT_RATE),
        nhil_rate=_pick(getattr(cfg, "nhil_rate", None), settings.NHIL_RATE),
        getfund_rate=_pick(getattr(cfg, "getfund_rate", None), settings.GETFUND_RATE),
        covid_levy_rate=_pick(getattr(cfg, "covid_levy_rate", None), settings.COVID_LEVY_RATE),
    )


# ── Pydantic schemas ───────────────────────────────────────────────────────────


class TaxRateConfigIn(BaseModel):
    vat_rate: Decimal | None = Field(None, ge=0, le=1, description="0.15 for 15%")
    nhil_rate: Decimal | None = Field(None, ge=0, le=1)
    getfund_rate: Decimal | None = Field(None, ge=0, le=1)
    covid_levy_rate: Decimal | None = Field(None, ge=0, le=1)


class TaxRateConfigResponse(BaseModel):
    business_id: UUID
    vat_rate: Decimal
    nhil_rate: Decimal
    getfund_rate: Decimal
    covid_levy_rate: Decimal
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Endpoints (admin-only) ─────────────────────────────────────────────────────


@router.get("/tax-rates", response_model=TaxRateConfigResponse)
async def get_tax_rates(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> TaxRateConfigResponse:
    """Return effective tax rates for the current business (defaults + overrides)."""
    rates = await get_effective_rates(business_id, db)
    return TaxRateConfigResponse(
        business_id=business_id,
        vat_rate=rates.vat_rate,
        nhil_rate=rates.nhil_rate,
        getfund_rate=rates.getfund_rate,
        covid_levy_rate=rates.covid_levy_rate,
        updated_at=datetime.utcnow(),
    )


@router.put("/tax-rates", response_model=TaxRateConfigResponse)
async def set_tax_rates(
    body: TaxRateConfigIn,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> TaxRateConfigResponse:
    """Upsert tax rate overrides for the current business (owner only)."""
    result = await db.execute(select(TaxRateConfig).where(TaxRateConfig.business_id == business_id))
    cfg = result.scalar_one_or_none()

    if cfg is None:
        cfg = TaxRateConfig(business_id=business_id)
        db.add(cfg)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(cfg, field, value)

    await db.commit()
    await db.refresh(cfg)

    rates = await get_effective_rates(business_id, db)
    return TaxRateConfigResponse(
        business_id=business_id,
        vat_rate=rates.vat_rate,
        nhil_rate=rates.nhil_rate,
        getfund_rate=rates.getfund_rate,
        covid_levy_rate=rates.covid_levy_rate,
        updated_at=cfg.updated_at,
    )


@router.delete("/tax-rates", status_code=204)
async def reset_tax_rates(
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete business-level overrides; platform defaults take effect immediately."""
    result = await db.execute(select(TaxRateConfig).where(TaxRateConfig.business_id == business_id))
    cfg = result.scalar_one_or_none()
    if cfg:
        await db.delete(cfg)
        await db.commit()
