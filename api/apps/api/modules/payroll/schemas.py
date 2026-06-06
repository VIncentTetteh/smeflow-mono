"""Payroll API schemas."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal  # (re-used in attendance schemas below)
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

PayType = Literal["monthly", "daily"]


class EmployeeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone: str | None = Field(None, max_length=15)
    role: str | None = Field(None, max_length=100)
    pay_type: PayType = "monthly"
    base_pay: Decimal = Field(..., gt=0)
    momo_phone: str | None = Field(None, max_length=15)
    momo_provider: str | None = Field(None, max_length=20)
    joined_at: date | None = None
    ssnit_number: str | None = Field(None, max_length=20)
    tin: str | None = Field(None, max_length=20)
    tier2_enrolled: bool = False
    tier2_rate: Decimal = Field(Decimal("0.05"), ge=0, le=1)
    tier2_provider: str | None = Field(None, max_length=100)


class EmployeeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    phone: str | None = Field(None, max_length=15)
    role: str | None = Field(None, max_length=100)
    pay_type: PayType | None = None
    base_pay: Decimal | None = Field(None, gt=0)
    momo_phone: str | None = Field(None, max_length=15)
    momo_provider: str | None = Field(None, max_length=20)
    is_active: bool | None = None
    joined_at: date | None = None
    ssnit_number: str | None = Field(None, max_length=20)
    tin: str | None = Field(None, max_length=20)
    tier2_enrolled: bool | None = None
    tier2_rate: Decimal | None = Field(None, ge=0, le=1)
    tier2_provider: str | None = Field(None, max_length=100)


class EmployeeResponse(BaseModel):
    id: UUID
    name: str
    phone: str | None
    role: str | None
    pay_type: str
    base_pay: Decimal
    momo_phone: str | None
    momo_provider: str | None
    is_active: bool
    joined_at: date | None
    created_at: datetime
    updated_at: datetime
    ssnit_number: str | None = None
    tin: str | None = None
    tier2_enrolled: bool = False
    tier2_rate: Decimal = Decimal("0.05")
    tier2_provider: str | None = None

    model_config = {"from_attributes": True}


class PayrollAdjustment(BaseModel):
    employee_id: UUID
    days_worked: Decimal | None = Field(None, ge=0)
    gross_override: Decimal | None = Field(None, ge=0)
    other_deductions: Decimal = Field(Decimal("0"), ge=0)


class PayrollRunCreate(BaseModel):
    period_start: date
    period_end: date
    adjustments: list[PayrollAdjustment] = []

    @model_validator(mode="after")
    def check_period(self) -> "PayrollRunCreate":
        if self.period_end < self.period_start:
            raise ValueError("period_end must be on or after period_start")
        if self.period_start > date.today():
            raise ValueError("period_start cannot be in the future")
        return self


class PayrollRunResponse(BaseModel):
    id: UUID
    period_start: date
    period_end: date
    status: str
    total_gross: Decimal
    total_ssnit_employee: Decimal
    total_ssnit_employer: Decimal
    total_income_tax: Decimal
    total_deductions: Decimal
    total_net: Decimal
    run_by: UUID | None
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class PayslipResponse(BaseModel):
    id: UUID
    payroll_run_id: UUID
    employee_id: UUID
    gross_pay: Decimal
    ssnit_employee: Decimal
    ssnit_employer: Decimal
    tier2_employee: Decimal = Decimal("0")
    income_tax: Decimal
    other_deductions: Decimal
    net_pay: Decimal
    payment_id: UUID | None
    pdf_url: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PayrollDisbursementResponse(BaseModel):
    run_id: str
    total_employees: int
    sent: int
    skipped: list[str] = []
    batch_errors: list[str] = []


class PayslipPayResponse(BaseModel):
    payslip_id: str
    status: str
    payment_id: str | None = None
    provider_reference: str | None = None
    message: str = ""


# ── Attendance ────────────────────────────────────────────────────────────────

AttendanceStatus = Literal["present", "absent", "half_day"]


class AttendanceCreate(BaseModel):
    date: date
    status: AttendanceStatus = "present"
    hours_worked: Decimal | None = Field(None, ge=0, le=24)
    daily_rate_override: Decimal | None = Field(None, ge=0)
    notes: str | None = Field(None, max_length=500)


class AttendanceUpdate(BaseModel):
    status: AttendanceStatus | None = None
    hours_worked: Decimal | None = Field(None, ge=0, le=24)
    daily_rate_override: Decimal | None = Field(None, ge=0)
    notes: str | None = Field(None, max_length=500)


class BulkAttendanceItem(BaseModel):
    employee_id: UUID
    date: date
    status: AttendanceStatus = "present"
    hours_worked: Decimal | None = Field(None, ge=0, le=24)
    daily_rate_override: Decimal | None = Field(None, ge=0)


class BulkAttendanceCreate(BaseModel):
    records: list[BulkAttendanceItem] = Field(..., min_length=1, max_length=200)


class AttendanceResponse(BaseModel):
    id: UUID
    business_id: UUID
    employee_id: UUID
    date: date
    status: str
    hours_worked: Decimal | None
    daily_rate_override: Decimal | None
    notes: str | None
    recorded_by: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AttendanceSummaryItem(BaseModel):
    employee_id: UUID
    employee_name: str
    present: int
    half_day: int
    absent: int
    total_days: int
    effective_days: Decimal  # present + 0.5*half_day
