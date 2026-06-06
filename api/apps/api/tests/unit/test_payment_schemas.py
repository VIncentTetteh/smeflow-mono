"""Tests for payment and sale amount validation — upper-bound enforcement.

Business context:
  - Single payment (MoMo collection / disbursement): max 50,000 GHS
  - Sale payment leg (split): max 50,000 GHS per leg
  - Credit payment on a sale (RecordPayment): max 50,000 GHS
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError


# ---------------------------------------------------------------------------
# PaymentRequest — MoMo collection (defined in payments/router.py)
# ---------------------------------------------------------------------------
class TestPaymentRequestAmountValidation:
    """MoMo collection requests must be positive and ≤ 50,000 GHS."""

    def test_normal_payment_accepted(self):
        """Typical SME payment is well within the limit."""
        from apps.api.modules.payments.router import PaymentRequest

        p = PaymentRequest(
            amount=Decimal("100.00"),
            phone="+233244123456",
            provider="mtn",
            idempotency_key="test-key-12345678",
        )
        assert p.amount == Decimal("100.00")

    def test_local_phone_is_normalized_for_provider_requests(self):
        from apps.api.modules.payments.router import PaymentRequest

        p = PaymentRequest(
            amount=Decimal("100.00"),
            phone="0244 123 456",
            provider="mtn",
            idempotency_key="test-key-12345678",
        )
        assert p.phone == "+233244123456"

    def test_idempotency_key_is_required_for_collection(self):
        from apps.api.modules.payments.router import PaymentRequest

        with pytest.raises(ValidationError):
            PaymentRequest(
                amount=Decimal("100.00"),
                phone="+233244123456",
                provider="mtn",
            )

    def test_maximum_boundary_accepted(self):
        """Exactly 50,000 GHS is at the boundary — must be accepted."""
        from apps.api.modules.payments.router import PaymentRequest

        p = PaymentRequest(
            amount=Decimal("50000.00"),
            phone="+233244123456",
            provider="mtn",
            idempotency_key="test-key-12345678",
        )
        assert p.amount == Decimal("50000.00")

    def test_exceeding_maximum_rejected(self):
        """50,000.01 GHS is one cent above the limit — must be rejected."""
        from apps.api.modules.payments.router import PaymentRequest

        with pytest.raises(ValidationError):
            PaymentRequest(
                amount=Decimal("50000.01"),
                phone="+233244123456",
                provider="mtn",
                idempotency_key="test-key-12345678",
            )

    def test_large_amount_rejected(self):
        """Absurdly large amounts (e.g. 999,999,999.99) must be rejected."""
        from apps.api.modules.payments.router import PaymentRequest

        with pytest.raises(ValidationError):
            PaymentRequest(
                amount=Decimal("999999999.99"),
                phone="+233244123456",
                provider="mtn",
                idempotency_key="test-key-12345678",
            )

    def test_zero_amount_rejected(self):
        from apps.api.modules.payments.router import PaymentRequest

        with pytest.raises(ValidationError):
            PaymentRequest(
                amount=Decimal("0.00"),
                phone="+233244123456",
                provider="mtn",
                idempotency_key="test-key-12345678",
            )

    def test_negative_amount_rejected(self):
        from apps.api.modules.payments.router import PaymentRequest

        with pytest.raises(ValidationError):
            PaymentRequest(
                amount=Decimal("-10.00"),
                phone="+233244123456",
                provider="mtn",
                idempotency_key="test-key-12345678",
            )


# ---------------------------------------------------------------------------
# DisbursementRequest — MoMo disbursement (defined in payments/router.py)
# ---------------------------------------------------------------------------
class TestDisbursementRequestAmountValidation:
    """MoMo disbursements must be positive and ≤ 50,000 GHS."""

    def test_normal_disbursement_accepted(self):
        from apps.api.modules.payments.router import DisbursementRequest

        d = DisbursementRequest(
            amount=Decimal("500.00"),
            phone="+233244123456",
            idempotency_key="disb-key-12345678",
        )
        assert d.amount == Decimal("500.00")

    def test_local_phone_is_normalized_for_disbursement(self):
        from apps.api.modules.payments.router import DisbursementRequest

        d = DisbursementRequest(
            amount=Decimal("500.00"),
            phone="0244 123 456",
            idempotency_key="disb-key-12345678",
        )
        assert d.phone == "+233244123456"

    def test_idempotency_key_is_required_for_disbursement(self):
        from apps.api.modules.payments.router import DisbursementRequest

        with pytest.raises(ValidationError):
            DisbursementRequest(amount=Decimal("500.00"), phone="+233244123456")

    def test_maximum_boundary_accepted(self):
        from apps.api.modules.payments.router import DisbursementRequest

        d = DisbursementRequest(
            amount=Decimal("50000.00"),
            phone="+233244123456",
            idempotency_key="disb-key-12345678",
        )
        assert d.amount == Decimal("50000.00")

    def test_exceeding_maximum_rejected(self):
        from apps.api.modules.payments.router import DisbursementRequest

        with pytest.raises(ValidationError):
            DisbursementRequest(
                amount=Decimal("50000.01"),
                phone="+233244123456",
                idempotency_key="disb-key-12345678",
            )

    def test_zero_amount_rejected(self):
        from apps.api.modules.payments.router import DisbursementRequest

        with pytest.raises(ValidationError):
            DisbursementRequest(
                amount=Decimal("0.00"),
                phone="+233244123456",
                idempotency_key="disb-key-12345678",
            )

    def test_negative_amount_rejected(self):
        from apps.api.modules.payments.router import DisbursementRequest

        with pytest.raises(ValidationError):
            DisbursementRequest(
                amount=Decimal("-1.00"),
                phone="+233244123456",
                idempotency_key="disb-key-12345678",
            )


# ---------------------------------------------------------------------------
# RecordPayment — credit/partial payment on a sale (sales/schemas.py)
# ---------------------------------------------------------------------------
class TestRecordPaymentAmountValidation:
    """Credit payments recorded against a sale must be positive and ≤ 50,000 GHS."""

    def test_normal_amount_accepted(self):
        from apps.api.modules.sales.schemas import RecordPayment

        rp = RecordPayment(amount=Decimal("200.00"))
        assert rp.amount == Decimal("200.00")

    def test_maximum_boundary_accepted(self):
        from apps.api.modules.sales.schemas import RecordPayment

        rp = RecordPayment(amount=Decimal("50000.00"))
        assert rp.amount == Decimal("50000.00")

    def test_exceeding_maximum_rejected(self):
        from apps.api.modules.sales.schemas import RecordPayment

        with pytest.raises(ValidationError):
            RecordPayment(amount=Decimal("50000.01"))

    def test_zero_amount_rejected(self):
        from apps.api.modules.sales.schemas import RecordPayment

        with pytest.raises(ValidationError):
            RecordPayment(amount=Decimal("0.00"))

    def test_negative_amount_rejected(self):
        from apps.api.modules.sales.schemas import RecordPayment

        with pytest.raises(ValidationError):
            RecordPayment(amount=Decimal("-50.00"))


# ---------------------------------------------------------------------------
# PaymentLeg — individual leg of a split sale payment (sales/schemas.py)
# ---------------------------------------------------------------------------
class TestPaymentLegAmountValidation:
    """Each split-payment leg must be positive and ≤ 50,000 GHS."""

    def test_normal_leg_accepted(self):
        from apps.api.modules.sales.schemas import PaymentLeg

        leg = PaymentLeg(method="cash", amount=Decimal("30.00"))
        assert leg.amount == Decimal("30.00")

    def test_maximum_boundary_accepted(self):
        from apps.api.modules.sales.schemas import PaymentLeg

        leg = PaymentLeg(method="cash", amount=Decimal("50000.00"))
        assert leg.amount == Decimal("50000.00")

    def test_exceeding_maximum_rejected(self):
        from apps.api.modules.sales.schemas import PaymentLeg

        with pytest.raises(ValidationError):
            PaymentLeg(method="cash", amount=Decimal("50000.01"))

    def test_zero_amount_rejected(self):
        from apps.api.modules.sales.schemas import PaymentLeg

        with pytest.raises(ValidationError):
            PaymentLeg(method="cash", amount=Decimal("0.00"))

    def test_negative_amount_rejected(self):
        from apps.api.modules.sales.schemas import PaymentLeg

        with pytest.raises(ValidationError):
            PaymentLeg(method="cash", amount=Decimal("-1.00"))
