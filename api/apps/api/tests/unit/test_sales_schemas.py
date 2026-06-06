from datetime import date, timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError

from apps.api.modules.sales.schemas import SaleCreate


def sale_payload(payment_method: str, **overrides):
    return {
        "items": [{"description": "Walk-in item", "qty": "1", "unit_price": "10.00"}],
        "payment_method": payment_method,
        "idempotency_key": str(uuid4()),
        **overrides,
    }


@pytest.mark.parametrize("method", ["cash", "paystack", "ghqr"])
def test_immediate_payment_methods_accept_walk_in_customer(method):
    assert SaleCreate(**sale_payload(method)).customer_phone is None


def test_credit_requires_name_and_valid_ghana_phone():
    with pytest.raises(ValidationError):
        SaleCreate(**sale_payload("credit", customer_phone="0244333444"))
    with pytest.raises(ValidationError):
        SaleCreate(**sale_payload("credit", customer_name="Ama", customer_phone="020"))

    sale = SaleCreate(
        **sale_payload(
            "credit",
            customer_name="Ama",
            customer_phone="0244333444",
            credit_due_date=(date.today() + timedelta(days=7)).isoformat(),
        )
    )
    assert sale.customer_phone == "+233244333444"


def test_credit_requires_future_due_date():
    with pytest.raises(ValidationError, match="credit_due_date is required"):
        SaleCreate(**sale_payload("credit", customer_name="Ama", customer_phone="0244333444"))
    with pytest.raises(ValidationError, match="at least the next calendar day"):
        SaleCreate(
            **sale_payload(
                "credit",
                customer_name="Ama",
                customer_phone="0244333444",
                credit_due_date=date.today().isoformat(),
            )
        )


def test_new_direct_momo_is_rejected():
    with pytest.raises(ValidationError, match="Direct MoMo RequestToPay is deprecated"):
        SaleCreate(**sale_payload("momo", customer_phone="0244333444"))
