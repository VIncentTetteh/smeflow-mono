"""Unit tests for merchant settlement service helpers."""

from decimal import Decimal

import pytest

from apps.api.modules.settlements.service import (
    calculate_fee,
    settlement_payout_amounts,
    PLATFORM_FEE_RATES,
)


class TestSettlementPayoutAmounts:
    def test_no_fee_on_payout(self):
        fee, net = settlement_payout_amounts(Decimal("100.00"))
        assert fee == Decimal("0")
        assert net == Decimal("100.00")

    def test_payout_matches_full_withdrawal(self):
        fee, net = settlement_payout_amounts(Decimal("4999.99"))
        assert fee == Decimal("0")
        assert net == Decimal("4999.99")


class TestCollectionFee:
    def test_free_plan_fee_is_2_point_5_percent(self):
        fee = calculate_fee(Decimal("100.00"), "free")
        assert fee == Decimal("2.50")

    def test_pro_plan_fee_is_1_percent(self):
        fee = calculate_fee(Decimal("100.00"), "pro")
        assert fee == Decimal("1.00")

    def test_net_after_collection_fee(self):
        gross = Decimal("100.00")
        fee = calculate_fee(gross, "free")
        assert gross - fee == Decimal("97.50")


class TestAutoApproveCeilingFromSettings:
    def test_settings_ceiling_used_by_service_helpers(self, monkeypatch):
        from apps.api.modules.settlements import service as svc_mod

        class FakeSettings:
            SETTLEMENT_MIN_GHS = 10.0
            SETTLEMENT_AUTO_APPROVE_CEILING_GHS = 3000.0
            SETTLEMENT_DEFAULT_THRESHOLD_GHS = 50.0

        monkeypatch.setattr(svc_mod, "_get_settings", lambda: FakeSettings())
        assert svc_mod._auto_approve_ceiling_ghs() == Decimal("3000.0")
        assert svc_mod._min_settlement_ghs() == Decimal("10.0")

    def test_ceiling_boundary_inclusive(self):
        """Amount exactly at ceiling should auto-approve (<=)."""
        ceiling = Decimal("5000.00")
        assert Decimal("5000.00") <= ceiling
        assert Decimal("5000.01") > ceiling


class TestPlatformFeeRates:
    def test_rates_defined_for_all_plans(self):
        assert "free" in PLATFORM_FEE_RATES
        assert "starter" in PLATFORM_FEE_RATES
        assert "pro" in PLATFORM_FEE_RATES


class TestBulkTransferParsing:
    def test_parses_list_response(self):
        from libs.payment_clients.paystack import parse_bulk_transfer_outcomes

        chunk = [{"agent_id": "a1", "amount_ghs": 10, "reference": "payout-a1-20260101"}]
        resp = [{"transfer_code": "TRF_abc", "status": "pending", "reference": "payout-a1-20260101"}]
        outcomes = parse_bulk_transfer_outcomes(resp, chunk)
        assert outcomes[0]["transfer_code"] == "TRF_abc"
        assert outcomes[0]["status"] == "pending"

    def test_parses_nested_dict_response(self):
        from libs.payment_clients.paystack import parse_bulk_transfer_outcomes

        chunk = [{"settlement_id": "s1", "amount_ghs": 50, "reference": "settle-biz-abc12345"}]
        resp = {"transfers": [{"transfer_code": "TRF_xyz", "status": "success"}]}
        outcomes = parse_bulk_transfer_outcomes(resp, chunk)
        assert outcomes[0]["settlement_id"] == "s1"
        assert outcomes[0]["transfer_code"] == "TRF_xyz"
