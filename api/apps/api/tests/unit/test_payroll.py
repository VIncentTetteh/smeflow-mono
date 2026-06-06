"""Unit tests for Ghana payroll calculations."""

from decimal import Decimal

from apps.api.modules.payroll.tax_calculator import calculate_paye, calculate_payroll_lines


def test_paye_uses_progressive_bands_after_allowable_deductions() -> None:
    assert calculate_paye(Decimal("490.00")) == Decimal("0.00")
    assert calculate_paye(Decimal("600.00")) == Decimal("5.50")
    assert calculate_paye(Decimal("730.00")) == Decimal("18.50")


def test_payroll_lines_calculate_ssnit_paye_and_net() -> None:
    lines = calculate_payroll_lines(Decimal("1000.00"), Decimal("20.00"))

    assert lines["ssnit_employee"] == Decimal("55.00")
    assert lines["ssnit_employer"] == Decimal("130.00")
    assert lines["income_tax"] > Decimal("0")
    assert lines["net_pay"] == Decimal("1000.00") - lines["total_deductions"]
