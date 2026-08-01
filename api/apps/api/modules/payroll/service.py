"""Payroll service for employees, payroll runs, payslips, and disbursement intents."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.api.core.audit import audit
from apps.api.core.exceptions import ConflictError, LimitExceededError, NotFoundError
from apps.api.modules.payments.models import Payment
from apps.api.modules.payroll.models import Attendance, Employee, PayrollRun, Payslip
from apps.api.modules.payroll.schemas import (
    AttendanceCreate,
    BulkAttendanceCreate,
    EmployeeCreate,
    EmployeeUpdate,
    PayrollRunCreate,
)
from apps.api.modules.payroll.tax_calculator import (
    build_p9a_row,
    build_p9b_row,
    calculate_payroll_lines,
    money,
)
from apps.api.workers.dispatch import enqueue_task

logger = structlog.get_logger()


class PayrollService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_employee(self, business_id: UUID, data: EmployeeCreate) -> Employee:
        from sqlalchemy import func

        from apps.api.modules.billing.models import PLANS
        from apps.api.modules.billing.service import BillingService

        billing = BillingService(self.db)
        emp_count = await self.db.scalar(
            select(func.count(Employee.id)).where(
                Employee.business_id == business_id,
                Employee.is_active.is_(True),
            )
        )
        if not await billing.check_limit(business_id, "employees", emp_count or 0):
            sub = await billing.get_subscription(business_id)
            limit = PLANS.get(sub.plan, PLANS["free"]).get("employees", 0)
            raise LimitExceededError("employees", limit)

        employee = Employee(business_id=business_id, **data.model_dump())
        self.db.add(employee)
        await self.db.flush([employee])
        return employee

    async def list_employees(self, business_id: UUID, active_only: bool = False) -> list[Employee]:
        stmt = select(Employee).where(Employee.business_id == business_id).order_by(Employee.name)
        if active_only:
            stmt = stmt.where(Employee.is_active.is_(True))
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def update_employee(
        self, business_id: UUID, employee_id: UUID, data: EmployeeUpdate
    ) -> Employee:
        employee = await self._get_employee(business_id, employee_id)
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(employee, key, value)
        await self.db.flush([employee])
        await self.db.refresh(employee)
        return employee

    async def run_payroll(
        self, business_id: UUID, user_id: UUID, data: PayrollRunCreate
    ) -> PayrollRun:
        existing = await self.db.execute(
            select(PayrollRun).where(
                PayrollRun.business_id == business_id,
                PayrollRun.period_start == data.period_start,
                PayrollRun.period_end == data.period_end,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError("Payroll run already exists for this period")

        employees = await self.list_employees(business_id, active_only=True)
        if not employees:
            raise ConflictError("No active employees for payroll run")

        adjustments = {adj.employee_id: adj for adj in data.adjustments}

        # Pre-load attendance effective days for daily-wage employees
        daily_employee_ids = [e.id for e in employees if e.pay_type == "daily"]
        (
            self._attendance_days_sync,
            self._attendance_override_gross_sync,
        ) = await self._load_attendance_days(
            business_id, data.period_start, data.period_end, daily_employee_ids
        )
        run = PayrollRun(
            business_id=business_id,
            period_start=data.period_start,
            period_end=data.period_end,
            status="completed",
            run_by=user_id,
            completed_at=datetime.now(timezone.utc),
        )
        self.db.add(run)
        await self.db.flush([run])

        totals = {
            "gross_pay": Decimal("0"),
            "ssnit_employee": Decimal("0"),
            "ssnit_employer": Decimal("0"),
            "income_tax": Decimal("0"),
            "total_deductions": Decimal("0"),
            "net_pay": Decimal("0"),
        }

        for employee in employees:
            adjustment = adjustments.get(employee.id)
            gross = self._gross_for_employee(employee, data, adjustment)
            other_deductions = adjustment.other_deductions if adjustment else Decimal("0")
            lines = calculate_payroll_lines(
                gross,
                other_deductions,
                tier2_enrolled=bool(employee.tier2_enrolled),
                tier2_rate=Decimal(str(employee.tier2_rate or "0.05")),
            )
            payslip = Payslip(
                payroll_run_id=run.id,
                employee_id=employee.id,
                business_id=business_id,
                gross_pay=lines["gross_pay"],
                ssnit_employee=lines["ssnit_employee"],
                ssnit_employer=lines["ssnit_employer"],
                tier2_employee=lines["tier2_employee"],
                income_tax=lines["income_tax"],
                other_deductions=lines["other_deductions"],
                net_pay=lines["net_pay"],
                pdf_url=f"local://payslips/{run.id}/{employee.id}.pdf",
            )
            self.db.add(payslip)
            for key in totals:
                totals[key] += lines[key]

        run.total_gross = money(totals["gross_pay"])
        run.total_ssnit_employee = money(totals["ssnit_employee"])
        run.total_ssnit_employer = money(totals["ssnit_employer"])
        run.total_income_tax = money(totals["income_tax"])
        run.total_deductions = money(totals["total_deductions"])
        run.total_net = money(totals["net_pay"])

        await self.db.flush()
        await audit(
            self.db,
            "payroll.run_complete",
            "PayrollRun",
            run.id,
            user_id,
            business_id,
            after={"period_start": str(data.period_start), "total_net": str(run.total_net)},
        )
        self._queue_payroll_notification(business_id, run, len(employees))
        logger.info("payroll.run.completed", business_id=str(business_id), run_id=str(run.id))
        return run

    async def list_runs(self, business_id: UUID) -> list[PayrollRun]:
        result = await self.db.execute(
            select(PayrollRun)
            .where(PayrollRun.business_id == business_id)
            .order_by(PayrollRun.period_start.desc())
        )
        return list(result.scalars().all())

    async def list_payslips_for_run(self, business_id: UUID, run_id: UUID) -> list[Payslip]:
        await self._get_run(business_id, run_id)
        result = await self.db.execute(
            select(Payslip).where(
                Payslip.business_id == business_id, Payslip.payroll_run_id == run_id
            )
        )
        return list(result.scalars().all())

    async def get_payslip(self, business_id: UUID, payslip_id: UUID) -> Payslip:
        result = await self.db.execute(
            select(Payslip).where(Payslip.id == payslip_id, Payslip.business_id == business_id)
        )
        payslip = result.scalar_one_or_none()
        if not payslip:
            raise NotFoundError("Payslip", str(payslip_id))
        return payslip

    async def execute_payroll_via_paystack(self, business_id: UUID, run_id: UUID) -> dict:
        """
        Disburse net pay to all employees in a payroll run via Paystack Bulk Transfer.

        Flow per employee:
          1. Ensure a Paystack transfer recipient code exists (create if missing).
          2. Batch employees into groups of 100.
          3. Fire POST /transfer/bulk for each batch.
          4. Update Payment records with provider references.
          5. Mark run as 'disbursed' on full or partial success.

        Returns a summary dict with counts and errors.
        """
        from libs.payment_clients.paystack import PaystackClient

        run = await self._get_run(business_id, run_id)

        if run.status == "disbursed":
            result = await self.db.execute(
                select(Payslip).where(
                    Payslip.business_id == business_id, Payslip.payroll_run_id == run_id
                )
            )
            already = list(result.scalars().all())
            return {
                "run_id": str(run.id),
                "total_employees": len(already),
                "sent": 0,
                "skipped": [],
                "batch_errors": ["Run already disbursed"],
            }

        result = await self.db.execute(
            select(Payslip)
            .where(Payslip.business_id == business_id, Payslip.payroll_run_id == run_id)
            .options(selectinload(Payslip.employee))
        )
        payslips = [p for p in result.scalars().all() if p.net_pay > 0]

        skipped: list[str] = []
        transfers: list[dict] = []
        payslip_map: dict[str, Payslip] = {}

        # Build transfer list, creating/caching recipient codes
        for payslip in payslips:
            # Skip already-disbursed payslips to prevent duplicate Paystack calls
            if payslip.payment_id:
                continue

            employee = payslip.employee
            phone = employee.momo_phone or employee.phone
            if not phone:
                skipped.append(employee.name or str(employee.id))
                continue

            provider = employee.momo_provider or "mtn"
            if not employee.paystack_recipient_code:
                try:
                    # Use the employee's actual provider for the correct bank code
                    recipient = await PaystackClient(provider)._get_or_create_recipient(phone)
                    employee.paystack_recipient_code = recipient
                    await self.db.flush([employee])
                except Exception as exc:
                    logger.warning(
                        "payroll.recipient_create_failed",
                        employee_id=str(employee.id),
                        error=str(exc),
                    )
                    skipped.append(employee.name or str(employee.id))
                    continue

            ref = f"payroll-{run.id}-{payslip.id}"
            transfers.append(
                {
                    "amount_ghs": payslip.net_pay,
                    "recipient_code": employee.paystack_recipient_code,
                    "reference": ref,
                    "reason": f"Salary: {employee.name}",
                }
            )
            payslip_map[ref] = payslip

        # Create Payment records for all pending transfers
        for transfer in transfers:
            ref = transfer["reference"]
            payslip = payslip_map[ref]
            employee = payslip.employee
            phone = employee.momo_phone or employee.phone
            payment = Payment(
                business_id=business_id,
                type="disbursement",
                provider=employee.momo_provider or "mtn",
                amount=payslip.net_pay,
                phone=phone,
                internal_ref=ref,
                status="pending",
                metadata_={"payroll_run_id": str(run.id), "payslip_id": str(payslip.id)},
                idempotency_key=f"payroll:{run.id}:{payslip.id}",
            )
            self.db.add(payment)
            await self.db.flush([payment])
            payslip.payment_id = payment.id
        await self.db.flush()

        # Batch transfers (max 100 per Paystack bulk limit)
        total_sent = 0
        errors: list[str] = []
        client = PaystackClient()
        for i in range(0, len(transfers), 100):
            batch = transfers[i : i + 100]
            try:
                await client.bulk_transfer(batch)
                total_sent += len(batch)
                logger.info(
                    "payroll.bulk_transfer_sent",
                    run_id=str(run.id),
                    batch=i // 100 + 1,
                    count=len(batch),
                )
            except Exception as exc:
                err_msg = str(exc)
                errors.append(f"batch {i // 100 + 1}: {err_msg}")
                logger.error(
                    "payroll.bulk_transfer_failed",
                    run_id=str(run.id),
                    batch=i // 100 + 1,
                    error=err_msg,
                )

        # Mark run as disbursed only when at least one transfer was actually sent.
        # An empty batch (all payslips skipped) must NOT set "disbursed" so the
        # UI keeps the Disburse button visible and the owner can fix missing phones.
        if total_sent > 0:
            run.status = "disbursed"
            await self.db.flush([run])
            await self._post_wages_expense(business_id, run)

        return {
            "run_id": str(run.id),
            "total_employees": len(payslips),
            "sent": total_sent,
            "skipped": skipped,
            "batch_errors": errors,
        }

    async def pay_single_payslip(self, business_id: UUID, payslip_id: UUID) -> dict:
        """
        Pay (or repay) a single employee's net salary for a specific payslip.

        Creates a new Payment record and fires a Paystack transfer. A unique
        timestamp-based reference suffix allows repayment of already-paid payslips
        without tripping Paystack's idempotency guard.
        """
        from datetime import timezone as _tz

        from libs.payment_clients.paystack import PaystackClient

        result = await self.db.execute(
            select(Payslip)
            .where(Payslip.id == payslip_id, Payslip.business_id == business_id)
            .options(selectinload(Payslip.employee))
        )
        payslip = result.scalar_one_or_none()
        if not payslip:
            raise NotFoundError("Payslip", str(payslip_id))

        employee = payslip.employee
        phone = employee.momo_phone or employee.phone
        if not phone:
            raise ConflictError(
                f"Employee '{employee.name}' has no MoMo number — add one before paying"
            )

        if payslip.net_pay <= 0:
            raise ConflictError("Payslip net pay is zero; nothing to disburse")

        provider = employee.momo_provider or "mtn"
        # Use a timestamp suffix so repayments get a distinct Paystack reference
        ts = int(datetime.now(_tz.utc).timestamp())
        ref = f"payroll-pay-{payslip.id}-{ts}"

        if not employee.paystack_recipient_code:
            try:
                recipient = await PaystackClient(provider)._get_or_create_recipient(phone)
                employee.paystack_recipient_code = recipient
                await self.db.flush([employee])
            except Exception as exc:
                logger.error(
                    "payroll.single_pay.recipient_failed",
                    payslip_id=str(payslip_id),
                    error=str(exc),
                )
                raise ConflictError(str(exc)) from exc

        client = PaystackClient(provider)
        try:
            resp = await client.disburse(
                amount=payslip.net_pay,
                phone=phone,
                reference=ref,
                description=f"Payroll: {employee.name}",
            )
        except Exception as exc:
            logger.error(
                "payroll.single_pay.transfer_failed",
                payslip_id=str(payslip_id),
                error=str(exc),
            )
            raise ConflictError(str(exc)) from exc

        payment = Payment(
            business_id=business_id,
            type="disbursement",
            provider=provider,
            amount=payslip.net_pay,
            phone=phone,
            internal_ref=ref,
            external_ref=resp.external_ref,
            status=resp.status,
            provider_message=resp.provider_message or "",
            metadata_={"payslip_id": str(payslip.id)},
            idempotency_key=ref,
        )
        self.db.add(payment)
        await self.db.flush([payment])
        payslip.payment_id = payment.id
        await self.db.flush([payslip])

        logger.info(
            "payroll.single_pay.success",
            payslip_id=str(payslip_id),
            payment_id=str(payment.id),
            reference=ref,
        )
        return {
            "payslip_id": str(payslip_id),
            "status": resp.status,
            "payment_id": str(payment.id),
            "provider_reference": resp.external_ref,
            "message": resp.provider_message or "",
        }

    async def create_disbursement_intents(
        self, business_id: UUID, run_id: UUID
    ) -> tuple[int, Decimal, str, list[str]]:
        run = await self._get_run(business_id, run_id)
        result = await self.db.execute(
            select(Payslip)
            .where(Payslip.business_id == business_id, Payslip.payroll_run_id == run_id)
            .options(selectinload(Payslip.employee))
        )
        payslips = list(result.scalars().all())
        created = 0
        skipped: list[str] = []
        total = Decimal("0")
        for payslip in payslips:
            if payslip.payment_id or payslip.net_pay <= 0:
                continue
            employee = payslip.employee
            phone = employee.momo_phone or employee.phone
            if not phone:
                skipped.append(employee.name or str(employee.id))
                continue
            payment = Payment(
                business_id=business_id,
                type="disbursement",
                provider=employee.momo_provider or "mtn",
                amount=payslip.net_pay,
                phone=phone,
                internal_ref=f"payroll-{run.id}-{payslip.id}",
                status="pending",
                provider_message="Payroll disbursement export only; provider call not executed",
                metadata_={"payroll_run_id": str(run.id), "payslip_id": str(payslip.id)},
                idempotency_key=f"payroll:{run.id}:{payslip.id}",
            )
            self.db.add(payment)
            await self.db.flush([payment])
            payslip.payment_id = payment.id
            created += 1
            total += payslip.net_pay
        await self.db.flush()
        return created, money(total), f"local://payroll-disbursements/{run.id}.json", skipped

    async def _post_wages_expense(self, business_id: UUID, run: PayrollRun) -> None:
        """
        Record the disbursed run as a wages expense so it reaches net profit.

        Posts the full employer cost (gross pay + employer SSNIT), not net pay —
        employee SSNIT and PAYE are withheld from staff but still cost the business.
        Idempotent on (source='payroll', source_id=run.id), so a retried disbursement
        updates the existing row instead of adding a second one.
        """
        from apps.api.modules.expenses.service import ExpenseService

        amount = money(
            (run.total_gross or Decimal("0")) + (run.total_ssnit_employer or Decimal("0"))
        )
        if amount <= 0:
            return

        await ExpenseService(self.db).upsert_system_expense(
            business_id,
            source="payroll",
            source_id=run.id,
            category="wages_salaries",
            amount=amount,
            expense_date=run.period_end,
            payment_method="momo",
            notes=f"Payroll {run.period_start} to {run.period_end} (gross pay + employer SSNIT)",
        )

    async def _get_employee(self, business_id: UUID, employee_id: UUID) -> Employee:
        result = await self.db.execute(
            select(Employee).where(Employee.id == employee_id, Employee.business_id == business_id)
        )
        employee = result.scalar_one_or_none()
        if not employee:
            raise NotFoundError("Employee", str(employee_id))
        return employee

    async def _get_run(self, business_id: UUID, run_id: UUID) -> PayrollRun:
        result = await self.db.execute(
            select(PayrollRun).where(PayrollRun.id == run_id, PayrollRun.business_id == business_id)
        )
        run = result.scalar_one_or_none()
        if not run:
            raise NotFoundError("PayrollRun", str(run_id))
        return run

    def _gross_for_employee(
        self, employee: Employee, data: PayrollRunCreate, adjustment: object | None
    ) -> Decimal:
        gross_override = getattr(adjustment, "gross_override", None)
        if gross_override is not None:
            return Decimal(str(gross_override))
        if employee.pay_type == "daily":
            days_worked = getattr(adjustment, "days_worked", None)
            if days_worked is None:
                # Use attendance effective days (present + 0.5*half_day).
                # _attendance_days_sync may contain a weighted sum already;
                # if no attendance was recorded we fall back to calendar days.
                days_worked = self._attendance_days_sync.get(employee.id)
                if days_worked is None:
                    days_worked = Decimal(str((data.period_end - data.period_start).days + 1))

            # Per-day override gross (attendance table may record different daily rates)
            override_gross = self._attendance_override_gross_sync.get(employee.id)
            if override_gross is not None:
                # Override gross is pre-computed from daily_rate_override x days
                return override_gross

            return Decimal(str(employee.base_pay)) * Decimal(str(days_worked))
        return Decimal(str(employee.base_pay))

    async def _load_attendance_days(
        self,
        business_id: UUID,
        period_start: date,
        period_end: date,
        employee_ids: list[UUID],
    ) -> tuple[dict[UUID, Decimal], dict[UUID, Decimal]]:
        """Pre-load attendance effective days (and per-day override gross) for daily employees.

        Returns:
            days_map: employee_id → effective days worked (present + 0.5*half_day)
            override_gross_map: employee_id → pre-computed gross when daily_rate_override is set
              on any of their attendance records
        """
        from sqlalchemy import case
        from sqlalchemy import func as sqlfunc

        if not employee_ids:
            return {}, {}

        # 1. Effective-day counts
        day_counts = await self.db.execute(
            select(
                Attendance.employee_id,
                sqlfunc.count(case((Attendance.status == "present", 1))).label("present"),
                sqlfunc.count(case((Attendance.status == "half_day", 1))).label("half_day"),
            )
            .where(
                Attendance.employee_id.in_(employee_ids),
                Attendance.business_id == business_id,
                Attendance.date >= period_start,
                Attendance.date <= period_end,
            )
            .group_by(Attendance.employee_id)
        )
        days_map: dict[UUID, Decimal] = {}
        for row in day_counts.all():
            effective = Decimal(str(row.present)) + Decimal(str(row.half_day)) * Decimal("0.5")
            if effective > 0:
                days_map[row.employee_id] = effective

        # 2. Attendance records that have a daily_rate_override set
        overrides_result = await self.db.execute(
            select(
                Attendance.employee_id,
                Attendance.status,
                Attendance.daily_rate_override,
            ).where(
                Attendance.employee_id.in_(employee_ids),
                Attendance.business_id == business_id,
                Attendance.date >= period_start,
                Attendance.date <= period_end,
                Attendance.daily_rate_override.is_not(None),
            )
        )
        override_gross_map: dict[UUID, Decimal] = {}
        for override_row in overrides_result.all():
            multiplier = Decimal("1") if override_row.status == "present" else Decimal("0.5")
            contrib = multiplier * Decimal(str(override_row.daily_rate_override))
            override_gross_map[override_row.employee_id] = (
                override_gross_map.get(override_row.employee_id, Decimal("0")) + contrib
            )

        return days_map, override_gross_map

    # ── Attendance ────────────────────────────────────────────────────────────

    async def record_attendance(
        self, business_id: UUID, employee_id: UUID, user_id: UUID, data: AttendanceCreate
    ) -> Attendance:
        """Upsert a single attendance record (idempotent on employee+date)."""
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        await self._get_employee(business_id, employee_id)
        stmt = (
            pg_insert(Attendance)
            .values(
                business_id=business_id,
                employee_id=employee_id,
                date=data.date,
                status=data.status,
                hours_worked=data.hours_worked,
                daily_rate_override=data.daily_rate_override,
                notes=data.notes,
                recorded_by=user_id,
            )
            .on_conflict_do_update(
                constraint="uq_attendance_employee_date",
                set_={
                    "status": data.status,
                    "hours_worked": data.hours_worked,
                    "daily_rate_override": data.daily_rate_override,
                    "notes": data.notes,
                    "recorded_by": user_id,
                },
            )
            .returning(Attendance)
        )
        result = await self.db.execute(stmt)
        record = result.scalar_one()
        await self.db.flush()
        return record

    async def bulk_record_attendance(
        self, business_id: UUID, user_id: UUID, data: BulkAttendanceCreate
    ) -> dict:
        """Upsert multiple attendance records in one call (max 200)."""
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        employee_ids = {r.employee_id for r in data.records}
        # Verify all employees belong to this business
        result = await self.db.execute(
            select(Employee.id).where(
                Employee.id.in_(employee_ids), Employee.business_id == business_id
            )
        )
        valid_ids = {row[0] for row in result.all()}
        invalid = employee_ids - valid_ids
        if invalid:
            raise NotFoundError(
                "Employee", f"{len(invalid)} employee(s) not found in this business"
            )

        created = 0
        for rec in data.records:
            if rec.employee_id not in valid_ids:
                continue
            stmt = (
                pg_insert(Attendance)
                .values(
                    business_id=business_id,
                    employee_id=rec.employee_id,
                    date=rec.date,
                    status=rec.status,
                    hours_worked=rec.hours_worked,
                    daily_rate_override=rec.daily_rate_override,
                    recorded_by=user_id,
                )
                .on_conflict_do_update(
                    constraint="uq_attendance_employee_date",
                    set_={
                        "status": rec.status,
                        "hours_worked": rec.hours_worked,
                        "daily_rate_override": rec.daily_rate_override,
                        "recorded_by": user_id,
                    },
                )
            )
            await self.db.execute(stmt)
            created += 1
        await self.db.flush()
        return {"processed": created, "errors": []}

    async def list_attendance(
        self,
        business_id: UUID,
        employee_id: UUID,
        date_from: date | None = None,
        date_to: date | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Attendance]:
        stmt = select(Attendance).where(
            Attendance.business_id == business_id,
            Attendance.employee_id == employee_id,
        )
        if date_from:
            stmt = stmt.where(Attendance.date >= date_from)
        if date_to:
            stmt = stmt.where(Attendance.date <= date_to)
        stmt = stmt.order_by(Attendance.date.desc()).limit(limit).offset(offset)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def attendance_summary(
        self,
        business_id: UUID,
        period_start: date,
        period_end: date,
    ) -> list[dict]:
        """Return per-employee attendance counts for a period."""
        from sqlalchemy import case
        from sqlalchemy import func as sqlfunc

        employees = await self.list_employees(business_id, active_only=True)
        summary = []
        for emp in employees:
            result = await self.db.execute(
                select(
                    sqlfunc.count(case((Attendance.status == "present", 1))).label("present"),
                    sqlfunc.count(case((Attendance.status == "half_day", 1))).label("half_day"),
                    sqlfunc.count(case((Attendance.status == "absent", 1))).label("absent"),
                ).where(
                    Attendance.employee_id == emp.id,
                    Attendance.business_id == business_id,
                    Attendance.date >= period_start,
                    Attendance.date <= period_end,
                )
            )
            row = result.one()
            effective = Decimal(str(row.present)) + Decimal(str(row.half_day)) * Decimal("0.5")
            summary.append(
                {
                    "employee_id": emp.id,
                    "employee_name": emp.name,
                    "present": row.present,
                    "half_day": row.half_day,
                    "absent": row.absent,
                    "total_days": row.present + row.half_day + row.absent,
                    "effective_days": effective,
                }
            )
        return summary

    async def generate_p9a(self, business_id: UUID, year: int) -> dict:
        """Build P9A (PAYE) report for all employees for the given calendar year."""
        from apps.api.modules.business.models import Business

        biz_result = await self.db.execute(select(Business).where(Business.id == business_id))
        business = biz_result.scalar_one_or_none()

        # Fetch all payslips for the year, joined with employee
        payslips_result = await self.db.execute(
            select(Payslip, Employee, PayrollRun)
            .join(Employee, Payslip.employee_id == Employee.id)
            .join(PayrollRun, Payslip.payroll_run_id == PayrollRun.id)
            .where(
                Payslip.business_id == business_id,
                PayrollRun.period_start >= date(year, 1, 1),
                PayrollRun.period_start <= date(year, 12, 31),
            )
            .order_by(Employee.name, PayrollRun.period_start)
        )
        rows = payslips_result.all()

        employee_rows: dict[str, list[dict]] = {}
        for payslip, employee, run in rows:
            month = (
                run.period_start.month
                if run.period_start
                else (payslip.created_at.month if payslip.created_at else 1)
            )
            row = build_p9a_row(
                employee_name=employee.name,
                ssnit_number=employee.ssnit_number,
                tin=employee.tin,
                month=month,
                gross=payslip.gross_pay,
                ssnit_employee=payslip.ssnit_employee,
                income_tax=payslip.income_tax,
                net_pay=payslip.net_pay,
            )
            key = str(employee.id)
            if key not in employee_rows:
                employee_rows[key] = []
            employee_rows[key].append(row)

        return {
            "form": "P9A",
            "year": year,
            "employer_tin": getattr(business, "tin", "") if business else "",
            "employer_name": business.name if business else str(business_id),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "employees": [
                {
                    "employee_name": rows_list[0]["employee_name"],
                    "ssnit_number": rows_list[0]["ssnit_number"],
                    "tin": rows_list[0]["tin"],
                    "monthly_rows": rows_list,
                    "annual_totals": {
                        "gross": str(sum(Decimal(r["gross_pay"]) for r in rows_list)),
                        "ssnit": str(
                            sum(Decimal(r["ssnit_employee_contribution"]) for r in rows_list)
                        ),
                        "paye": str(sum(Decimal(r["income_tax_withheld"]) for r in rows_list)),
                        "net": str(sum(Decimal(r["net_pay"]) for r in rows_list)),
                    },
                }
                for rows_list in employee_rows.values()
            ],
        }

    async def generate_p9b(self, business_id: UUID, year: int) -> dict:
        """Build P9B (Tier 2 Occupational Pension) report for enrolled employees."""
        from apps.api.modules.business.models import Business

        biz_result = await self.db.execute(select(Business).where(Business.id == business_id))
        business = biz_result.scalar_one_or_none()

        payslips_result = await self.db.execute(
            select(Payslip, Employee)
            .join(Employee, Payslip.employee_id == Employee.id)
            .join(PayrollRun, Payslip.payroll_run_id == PayrollRun.id)
            .where(
                Payslip.business_id == business_id,
                Employee.tier2_enrolled.is_(True),
                PayrollRun.period_start >= date(year, 1, 1),
                PayrollRun.period_start <= date(year, 12, 31),
            )
            .order_by(Employee.name, PayrollRun.period_start)
        )
        rows = payslips_result.all()

        employee_rows: dict[str, list[dict]] = {}
        for payslip, employee in rows:
            month = payslip.created_at.month if payslip.created_at else 1
            row = build_p9b_row(
                employee_name=employee.name,
                ssnit_number=employee.ssnit_number,
                tin=employee.tin,
                tier2_provider=employee.tier2_provider,
                month=month,
                gross=payslip.gross_pay,
                tier2_employee=payslip.tier2_employee,
            )
            key = str(employee.id)
            if key not in employee_rows:
                employee_rows[key] = []
            employee_rows[key].append(row)

        return {
            "form": "P9B",
            "year": year,
            "employer_tin": getattr(business, "tin", "") if business else "",
            "employer_name": business.name if business else str(business_id),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "employees": [
                {
                    "employee_name": rows_list[0]["employee_name"],
                    "ssnit_number": rows_list[0]["ssnit_number"],
                    "tin": rows_list[0]["tin"],
                    "tier2_provider": rows_list[0]["tier2_provider"],
                    "monthly_rows": rows_list,
                    "annual_totals": {
                        "gross": str(sum(Decimal(r["gross_pay"]) for r in rows_list)),
                        "employee_contribution": str(
                            sum(Decimal(r["employee_contribution"]) for r in rows_list)
                        ),
                    },
                }
                for rows_list in employee_rows.values()
            ],
        }

    def _queue_payroll_notification(self, business_id: UUID, run: PayrollRun, count: int) -> None:
        try:
            from apps.api.workers.tasks.notification_tasks import send_notification

            enqueue_task(
                send_notification,
                str(business_id),
                "payroll.run_complete",
                {
                    "period": f"{run.period_start} to {run.period_end}",
                    "count": count,
                    "total_net": str(run.total_net),
                },
            )
        except Exception as exc:
            logger.warning("payroll.notification_failed", error=str(exc))
