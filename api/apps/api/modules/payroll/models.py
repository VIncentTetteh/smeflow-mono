"""Payroll ORM models: Employee, PayrollRun, Payslip, Attendance."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    user_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(15))
    role: Mapped[str | None] = mapped_column(String(100))
    pay_type: Mapped[str] = mapped_column(
        String(20), default="monthly"
    )  # daily, weekly, monthly, piece
    base_pay: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    momo_phone: Mapped[str | None] = mapped_column(String(15))
    momo_provider: Mapped[str | None] = mapped_column(String(20))
    paystack_recipient_code: Mapped[str | None] = mapped_column(String(100))
    # ── Tier 2 Occupational Pension (NPRA) ────────────────────────────────────
    tier2_enrolled: Mapped[bool] = mapped_column(Boolean, default=False)
    tier2_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 4), default=Decimal("0.05")
    )  # employee 5% default; can be higher with employer top-up agreement
    tier2_provider: Mapped[str | None] = mapped_column(String(100))  # e.g. "Enterprise Trustees"
    ssnit_number: Mapped[str | None] = mapped_column(String(20))  # for P9 forms
    tin: Mapped[str | None] = mapped_column(String(20))  # personal TIN for P9
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    joined_at: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    payslips: Mapped[list["Payslip"]] = relationship(back_populates="employee")
    attendance_records: Mapped[list["Attendance"]] = relationship(back_populates="employee")


class PayrollRun(Base):
    __tablename__ = "payroll_runs"
    __table_args__ = (
        UniqueConstraint("business_id", "period_start", "period_end", name="uq_payroll_run_period"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="draft"
    )  # draft, processing, completed, failed
    total_gross: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_ssnit_employee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_ssnit_employer: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_income_tax: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_deductions: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_net: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    run_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    payslips: Mapped[list["Payslip"]] = relationship(back_populates="payroll_run")


class Payslip(Base):
    __tablename__ = "payslips"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    payroll_run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payroll_runs.id"), nullable=False
    )
    employee_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("employees.id"), nullable=False
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    gross_pay: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    ssnit_employee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    ssnit_employer: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    tier2_employee: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    income_tax: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    other_deductions: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    net_pay: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    payment_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("payments.id"))
    pdf_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    payroll_run: Mapped["PayrollRun"] = relationship(back_populates="payslips")
    employee: Mapped["Employee"] = relationship(back_populates="payslips")


class Attendance(Base):
    """Daily attendance record for casual / daily-wage employees."""

    __tablename__ = "attendance_records"
    __table_args__ = (UniqueConstraint("employee_id", "date", name="uq_attendance_employee_date"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    employee_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("employees.id"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    # present | absent | half_day
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="present")
    hours_worked: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    daily_rate_override: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    notes: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    employee: Mapped["Employee"] = relationship(back_populates="attendance_records")
