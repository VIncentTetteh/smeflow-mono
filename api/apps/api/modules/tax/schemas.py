"""Tax API schemas."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class TaxReturnResponse(BaseModel):
    id: UUID
    period_type: str
    period_start: date
    period_end: date
    vat_output: Decimal
    vat_input: Decimal
    vat_payable: Decimal
    nhil_amount: Decimal
    getfund_amount: Decimal
    covid_levy: Decimal
    total_tax: Decimal
    status: str
    gra_ref: str | None
    export_url: str | None
    submitted_at: datetime | None
    payload_json: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


class GenerateTaxReturnRequest(BaseModel):
    year: int = Field(..., ge=2020, le=2100)
    month: int = Field(..., ge=1, le=12)


class TaxSummaryResponse(BaseModel):
    period: str
    vat_output: Decimal
    vat_input: Decimal
    vat_payable: Decimal
    nhil: Decimal
    getfund: Decimal
    covid_levy: Decimal
    total_tax: Decimal
    status: str
    # PAYE income tax deducted from employee payroll this period
    paye_withheld: Decimal = Decimal("0")
    # Estimated personal income tax liability for a sole proprietor (non-payroll income)
    estimated_income_tax: Decimal = Decimal("0")
    estimated_vat_payable: Decimal = Decimal("0")
    due_date: date | None = None
    filing_readiness: dict = Field(default_factory=dict)


class TaxFileResponse(BaseModel):
    id: UUID
    status: str
    gra_ref: str | None
    export_url: str
    is_dry_run: bool = False  # True when ENABLE_GRA_DIRECT_FILING=false; return was NOT sent to GRA


class TaxCalendarEntry(BaseModel):
    tax_type: str
    period: str
    due_date: date
    description: str
