"""Integration tests for Phase 2 payroll APIs."""

from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select


async def _upgrade_to_starter(async_client: AsyncClient, auth_headers: dict) -> None:
    resp = await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "starter"},
        headers=auth_headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_employee_crud_and_monthly_daily_payroll_run(
    async_client: AsyncClient, auth_headers: dict
) -> None:
    await _upgrade_to_starter(async_client, auth_headers)

    monthly = await async_client.post(
        "/api/v1/payroll/employees",
        json={
            "name": "Monthly Manager",
            "pay_type": "monthly",
            "base_pay": "2000.00",
            "momo_phone": "+233244111111",
        },
        headers=auth_headers,
    )
    assert monthly.status_code == 201

    daily = await async_client.post(
        "/api/v1/payroll/employees",
        json={
            "name": "Daily Worker",
            "pay_type": "daily",
            "base_pay": "50.00",
            "momo_phone": "+233244222222",
        },
        headers=auth_headers,
    )
    assert daily.status_code == 201

    patch = await async_client.patch(
        f"/api/v1/payroll/employees/{daily.json()['id']}",
        json={"role": "Assistant"},
        headers=auth_headers,
    )
    assert patch.status_code == 200
    assert patch.json()["role"] == "Assistant"

    run = await async_client.post(
        "/api/v1/payroll/runs",
        json={
            "period_start": "2026-04-01",
            "period_end": "2026-04-30",
            "adjustments": [
                {
                    "employee_id": daily.json()["id"],
                    "days_worked": "10",
                    "other_deductions": "5.00",
                }
            ],
        },
        headers=auth_headers,
    )
    assert run.status_code == 201
    data = run.json()
    assert data["status"] == "completed"
    assert Decimal(data["total_gross"]) == Decimal("2500.00")
    assert Decimal(data["total_ssnit_employee"]) == Decimal("137.50")
    assert Decimal(data["total_ssnit_employer"]) == Decimal("325.00")
    assert Decimal(data["total_net"]) > Decimal("0")

    duplicate = await async_client.post(
        "/api/v1/payroll/runs",
        json={"period_start": "2026-04-01", "period_end": "2026-04-30"},
        headers=auth_headers,
    )
    assert duplicate.status_code == 409

    payslips = await async_client.get(
        f"/api/v1/payroll/runs/{data['id']}/payslips",
        headers=auth_headers,
    )
    assert payslips.status_code == 200
    assert len(payslips.json()) == 2
    assert all(item["pdf_url"].startswith("local://payslips/") for item in payslips.json())


@pytest.mark.asyncio
async def test_payroll_disbursement_skips_when_paystack_is_unconfigured(
    async_client: AsyncClient, auth_headers: dict, db_session
) -> None:
    from apps.api.modules.payments.models import Payment

    await _upgrade_to_starter(async_client, auth_headers)

    employee = await async_client.post(
        "/api/v1/payroll/employees",
        json={
            "name": "Payout Worker",
            "pay_type": "monthly",
            "base_pay": "1000.00",
            "momo_phone": "+233244333333",
            "momo_provider": "mtn",
        },
        headers=auth_headers,
    )
    assert employee.status_code == 201
    run = await async_client.post(
        "/api/v1/payroll/runs",
        json={"period_start": "2026-05-01", "period_end": "2026-05-31"},
        headers=auth_headers,
    )
    assert run.status_code == 201

    disburse = await async_client.post(
        f"/api/v1/payroll/runs/{run.json()['id']}/disburse",
        headers=auth_headers,
    )
    assert disburse.status_code == 200
    data = disburse.json()
    assert data["sent"] == 0
    assert data["skipped"] == ["Payout Worker"]

    result = await db_session.execute(
        select(Payment).where(
            Payment.type == "disbursement",
            Payment.status == "pending",
        )
    )
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_payroll_attendance_payslip_and_p9_reports(
    async_client: AsyncClient, auth_headers: dict
) -> None:
    """Cover payroll endpoints with no prior test coverage: list employees,
    single + bulk attendance, attendance list/summary, payslip PDF redirect,
    the pay-single-payslip conflict path, and the P9A/P9B GRA reports."""
    await _upgrade_to_starter(async_client, auth_headers)

    employee = await async_client.post(
        "/api/v1/payroll/employees",
        json={
            "name": "Report Worker",
            "pay_type": "monthly",
            "base_pay": "1500.00",
            # Intentionally no momo_phone/phone — exercises the "no MoMo number"
            # conflict path on /pay below instead of requiring a Paystack mock.
            "tier2_enrolled": True,
        },
        headers=auth_headers,
    )
    assert employee.status_code == 201
    employee_id = employee.json()["id"]

    listed = await async_client.get("/api/v1/payroll/employees", headers=auth_headers)
    assert listed.status_code == 200
    assert any(e["id"] == employee_id for e in listed.json())

    single = await async_client.post(
        f"/api/v1/payroll/employees/{employee_id}/attendance",
        json={"date": "2026-06-01", "status": "present"},
        headers=auth_headers,
    )
    assert single.status_code == 201

    bulk = await async_client.post(
        "/api/v1/payroll/attendance/bulk",
        json={
            "records": [
                {"employee_id": employee_id, "date": "2026-06-02", "status": "present"},
                {"employee_id": employee_id, "date": "2026-06-03", "status": "half_day"},
            ]
        },
        headers=auth_headers,
    )
    assert bulk.status_code == 201

    attendance_list = await async_client.get(
        f"/api/v1/payroll/employees/{employee_id}/attendance"
        "?date_from=2026-06-01&date_to=2026-06-03",
        headers=auth_headers,
    )
    assert attendance_list.status_code == 200
    assert len(attendance_list.json()) == 3

    summary = await async_client.get(
        "/api/v1/payroll/attendance/summary?period_start=2026-06-01&period_end=2026-06-03",
        headers=auth_headers,
    )
    assert summary.status_code == 200
    worker_summary = next(
        row for row in summary.json() if row["employee_id"] == employee_id
    )
    assert worker_summary["present"] == 2
    assert worker_summary["half_day"] == 1
    assert worker_summary["absent"] == 0

    run = await async_client.post(
        "/api/v1/payroll/runs",
        json={"period_start": "2026-06-01", "period_end": "2026-06-30"},
        headers=auth_headers,
    )
    assert run.status_code == 201

    payslips = await async_client.get(
        f"/api/v1/payroll/runs/{run.json()['id']}/payslips",
        headers=auth_headers,
    )
    assert payslips.status_code == 200
    payslip_id = payslips.json()[0]["id"]

    pdf = await async_client.get(
        f"/api/v1/payroll/payslips/{payslip_id}/pdf",
        headers=auth_headers,
        follow_redirects=False,
    )
    assert pdf.status_code in (302, 307)
    assert pdf.headers["location"].startswith("local://payslips/")

    pay = await async_client.post(
        f"/api/v1/payroll/payslips/{payslip_id}/pay",
        headers=auth_headers,
    )
    assert pay.status_code == 409
    assert "no MoMo number" in str(pay.json())

    p9a = await async_client.get(
        "/api/v1/payroll/reports/p9a?year=2026",
        headers=auth_headers,
    )
    assert p9a.status_code == 200

    p9b = await async_client.get(
        "/api/v1/payroll/reports/p9b?year=2026",
        headers=auth_headers,
    )
    assert p9b.status_code == 200
    # Report Worker is tier2_enrolled=True and had a June 2026 payslip, so
    # they must appear in the P9B (Tier 2 pension) report.
    assert "Report Worker" in str(p9b.json())
