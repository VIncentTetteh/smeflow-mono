"""Ghana payroll statutory calculations."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")

PAYE_BANDS_CURRENT = [
    (Decimal("490.00"), Decimal("0.00")),
    (Decimal("110.00"), Decimal("0.05")),
    (Decimal("130.00"), Decimal("0.10")),
    (Decimal("3166.67"), Decimal("0.175")),
    (Decimal("16000.00"), Decimal("0.25")),
    (Decimal("30520.00"), Decimal("0.30")),
    (None, Decimal("0.35")),
]
PAYE_VERSION = "GRA-PAYE-2024-current"
SSNIT_EMPLOYEE_RATE = Decimal("0.055")  # Tier 1 — 5.5% employee
SSNIT_EMPLOYER_RATE = Decimal("0.13")  # Tier 1+2 — 13% employer total
TIER2_DEFAULT_RATE = Decimal("0.05")  # Tier 2 — 5% occupational pension (default)


def money(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def calculate_paye(chargeable_income: Decimal) -> Decimal:
    """Calculate monthly PAYE from chargeable income using current GRA bands."""
    remaining = max(chargeable_income, Decimal("0"))
    tax = Decimal("0")
    for band_size, rate in PAYE_BANDS_CURRENT:
        if remaining <= 0:
            break
        taxable = remaining if band_size is None else min(band_size, remaining)
        tax += taxable * rate
        remaining -= taxable
    return money(tax)


def calculate_payroll_lines(
    gross_pay: Decimal,
    other_deductions: Decimal = Decimal("0"),
    tier2_enrolled: bool = False,
    tier2_rate: Decimal = TIER2_DEFAULT_RATE,
) -> dict[str, Decimal]:
    """Return SSNIT, Tier 2 pension, PAYE, deduction, and net pay amounts for one employee.

    Ghana statutory deduction order:
      1. Tier 1 SSNIT employee contribution (5.5%) — deducted from gross
      2. Tier 2 occupational pension employee contribution (5% of gross, if enrolled)
      3. Taxable income = gross - Tier 1 SSNIT employee (GRA allows this deduction only)
      4. PAYE on taxable income
    """
    gross = money(gross_pay)
    other = money(other_deductions)

    ssnit_employee = money(gross * SSNIT_EMPLOYEE_RATE)
    ssnit_employer = money(gross * SSNIT_EMPLOYER_RATE)
    tier2_employee = money(gross * money(tier2_rate)) if tier2_enrolled else Decimal("0")

    taxable_income = max(gross - ssnit_employee, Decimal("0"))
    income_tax = calculate_paye(taxable_income)

    total_deductions = money(ssnit_employee + tier2_employee + income_tax + other)
    net_pay = money(max(gross - total_deductions, Decimal("0")))
    return {
        "gross_pay": gross,
        "ssnit_employee": ssnit_employee,
        "ssnit_employer": ssnit_employer,
        "tier2_employee": tier2_employee,
        "income_tax": income_tax,
        "other_deductions": other,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
    }


def build_p9a_row(
    employee_name: str,
    ssnit_number: str | None,
    tin: str | None,
    month: int,
    gross: Decimal,
    ssnit_employee: Decimal,
    income_tax: Decimal,
    net_pay: Decimal,
) -> dict:
    """Return a single-month P9A (PAYE) data row in GRA format."""
    return {
        "employee_name": employee_name,
        "ssnit_number": ssnit_number or "",
        "tin": tin or "",
        "month": month,
        "gross_pay": str(gross),
        "ssnit_employee_contribution": str(ssnit_employee),
        "taxable_income": str(max(gross - ssnit_employee, Decimal("0"))),
        "income_tax_withheld": str(income_tax),
        "net_pay": str(net_pay),
    }


def build_p9b_row(
    employee_name: str,
    ssnit_number: str | None,
    tin: str | None,
    tier2_provider: str | None,
    month: int,
    gross: Decimal,
    tier2_employee: Decimal,
    tier2_employer: Decimal = Decimal("0"),
) -> dict:
    """Return a single-month P9B (Tier 2 pension) data row in NPRA format."""
    return {
        "employee_name": employee_name,
        "ssnit_number": ssnit_number or "",
        "tin": tin or "",
        "tier2_provider": tier2_provider or "",
        "month": month,
        "gross_pay": str(gross),
        "employee_contribution": str(tier2_employee),
        "employer_contribution": str(tier2_employer),
        "total_contribution": str(money(tier2_employee + tier2_employer)),
    }
