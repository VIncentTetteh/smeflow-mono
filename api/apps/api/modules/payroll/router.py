"""Payroll endpoints."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import RequireRole, get_current_business_id, get_current_user_id
from apps.api.core.exceptions import NotFoundError
from apps.api.modules.payroll.schemas import (
    AttendanceCreate,
    AttendanceResponse,
    AttendanceSummaryItem,
    BulkAttendanceCreate,
    EmployeeCreate,
    EmployeeResponse,
    EmployeeUpdate,
    PayrollDisbursementResponse,
    PayrollRunCreate,
    PayrollRunResponse,
    PayslipPayResponse,
    PayslipResponse,
)
from apps.api.modules.payroll.service import PayrollService

router = APIRouter()


@router.post("/employees", response_model=EmployeeResponse, status_code=201)
async def create_employee(
    body: EmployeeCreate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> EmployeeResponse:
    employee = await PayrollService(db).create_employee(business_id, body)
    return EmployeeResponse.model_validate(employee)


@router.get("/employees", response_model=list[EmployeeResponse])
async def list_employees(
    active_only: bool = False,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[EmployeeResponse]:
    employees = await PayrollService(db).list_employees(business_id, active_only)
    return [EmployeeResponse.model_validate(employee) for employee in employees]


@router.patch("/employees/{employee_id}", response_model=EmployeeResponse)
async def update_employee(
    employee_id: UUID,
    body: EmployeeUpdate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> EmployeeResponse:
    employee = await PayrollService(db).update_employee(business_id, employee_id, body)
    return EmployeeResponse.model_validate(employee)


@router.post("/runs", response_model=PayrollRunResponse, status_code=201)
async def run_payroll(
    body: PayrollRunCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> PayrollRunResponse:
    run = await PayrollService(db).run_payroll(business_id, user_id, body)
    return PayrollRunResponse.model_validate(run)


@router.get("/runs", response_model=list[PayrollRunResponse])
async def list_runs(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[PayrollRunResponse]:
    runs = await PayrollService(db).list_runs(business_id)
    return [PayrollRunResponse.model_validate(run) for run in runs]


@router.get("/runs/{run_id}/payslips", response_model=list[PayslipResponse])
async def list_run_payslips(
    run_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[PayslipResponse]:
    payslips = await PayrollService(db).list_payslips_for_run(business_id, run_id)
    return [PayslipResponse.model_validate(payslip) for payslip in payslips]


@router.get("/payslips/{payslip_id}/pdf")
async def get_payslip_pdf(
    payslip_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    payslip = await PayrollService(db).get_payslip(business_id, payslip_id)
    if not payslip.pdf_url:
        raise NotFoundError("Payslip PDF", str(payslip_id))
    return RedirectResponse(payslip.pdf_url)


@router.post("/payslips/{payslip_id}/pay", response_model=PayslipPayResponse)
async def pay_single_employee(
    payslip_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> PayslipPayResponse:
    result = await PayrollService(db).pay_single_payslip(business_id, payslip_id)
    return PayslipPayResponse(**result)


@router.post("/runs/{run_id}/disburse", response_model=PayrollDisbursementResponse)
async def disburse_payroll(
    run_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> PayrollDisbursementResponse:
    result = await PayrollService(db).execute_payroll_via_paystack(business_id, run_id)
    return PayrollDisbursementResponse(**result)


# ── Attendance endpoints ──────────────────────────────────────────────────────


@router.post(
    "/employees/{employee_id}/attendance",
    response_model=AttendanceResponse,
    status_code=201,
)
async def record_attendance(
    employee_id: UUID,
    body: AttendanceCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager", "staff")),
    db: AsyncSession = Depends(get_db),
) -> AttendanceResponse:
    """Record or update a single day's attendance for an employee (upsert)."""
    record = await PayrollService(db).record_attendance(business_id, employee_id, user_id, body)
    await db.commit()
    return AttendanceResponse.model_validate(record)


@router.post("/attendance/bulk", status_code=201)
async def bulk_record_attendance(
    body: BulkAttendanceCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager", "staff")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upsert attendance for up to 200 employee-day pairs in one call."""
    result = await PayrollService(db).bulk_record_attendance(business_id, user_id, body)
    await db.commit()
    return result


@router.get("/employees/{employee_id}/attendance", response_model=list[AttendanceResponse])
async def list_attendance(
    employee_id: UUID,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[AttendanceResponse]:
    """List attendance records for an employee, optionally filtered by date range."""
    records = await PayrollService(db).list_attendance(
        business_id, employee_id, date_from, date_to, limit, offset
    )
    return [AttendanceResponse.model_validate(r) for r in records]


@router.get("/reports/p9a")
async def generate_p9a(
    year: int = Query(..., description="Tax year (e.g. 2025)"),
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Generate a P9A (PAYE) summary for GRA covering all employees for the given year.

    Returns month-by-month rows per employee — ready for upload to GRA e-Services portal.
    """
    return await PayrollService(db).generate_p9a(business_id, year)


@router.get("/reports/p9b")
async def generate_p9b(
    year: int = Query(..., description="Tax year (e.g. 2025)"),
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Generate a P9B (Tier 2 Occupational Pension) summary for NPRA-enrolled employees.

    Only employees with tier2_enrolled=True are included.
    """
    return await PayrollService(db).generate_p9b(business_id, year)


@router.get("/attendance/summary", response_model=list[AttendanceSummaryItem])
async def attendance_summary(
    period_start: date = Query(...),
    period_end: date = Query(...),
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> list[AttendanceSummaryItem]:
    """Return present/half_day/absent counts per employee for a period."""
    rows = await PayrollService(db).attendance_summary(business_id, period_start, period_end)
    return [AttendanceSummaryItem(**row) for row in rows]
