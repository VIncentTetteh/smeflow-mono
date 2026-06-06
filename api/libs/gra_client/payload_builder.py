"""
Build the JSON payload expected by the GRA e-VAT API v1.

GRA e-VAT reference: https://api.gra.gov.gh/v1 (Ghana Revenue Authority)

The payload structure follows the GRA Digital Services Portal specification
for VAT Standard Rate returns (VFRS and SVR form types).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal


def build_vat_return_payload(
    *,
    tin: str,
    business_name: str,
    period_start: date,
    period_end: date,
    vat_output: Decimal,
    vat_input: Decimal,
    nhil: Decimal,
    getfund: Decimal,
    covid_levy: Decimal,
    total_tax: Decimal,
    form_type: str = "SVR",  # SVR = Standard VAT Return
    currency: str = "GHS",
) -> dict:
    """
    Build a GRA-compliant VAT return filing payload.

    Args:
        tin:            Taxpayer Identification Number (GRA TIN).
        business_name:  Registered business name.
        period_start:   First day of the return period.
        period_end:     Last day of the return period.
        vat_output:     Output VAT collected on sales.
        vat_input:      Input VAT claimable from purchases.
        nhil:           National Health Insurance Levy amount.
        getfund:        Ghana Education Trust Fund levy amount.
        covid_levy:     COVID-19 Health Recovery Levy amount.
        total_tax:      Net tax payable (output - input + levies).
        form_type:      GRA form code (SVR for standard rate).
        currency:       ISO 4217 currency code, default GHS.

    Returns:
        Dict ready to POST to ``/returns/vat``.
    """
    vat_net = (vat_output - vat_input).max(Decimal("0"))

    return {
        "formType": form_type,
        "currency": currency,
        "taxpayer": {
            "tin": tin,
            "name": business_name,
        },
        "period": {
            "from": period_start.isoformat(),
            "to": period_end.isoformat(),
            "type": "monthly" if (period_end - period_start).days <= 31 else "quarterly",
        },
        "vatReturn": {
            "outputTax": _fmt(vat_output),
            "inputTax": _fmt(vat_input),
            "netVat": _fmt(vat_net),
            "nhil": _fmt(nhil),
            "getfund": _fmt(getfund),
            "covidLevy": _fmt(covid_levy),
            "totalTaxPayable": _fmt(total_tax),
        },
        "declaration": {
            "declarantName": business_name,
            "declarationDate": date.today().isoformat(),
            "accurate": True,
        },
    }


def _fmt(value: Decimal) -> str:
    """Format a Decimal to 2 d.p. string for JSON serialisation."""
    return str(value.quantize(Decimal("0.01")))
