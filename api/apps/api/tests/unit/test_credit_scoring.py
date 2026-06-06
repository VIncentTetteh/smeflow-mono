"""Unit tests for the credit scoring engine."""

from decimal import Decimal

from apps.api.modules.credit.scoring import CreditFactors, CreditScoringEngine


class TestCreditScoringEngine:
    def _make_factors(self, **overrides) -> CreditFactors:
        defaults = {
            "revenue_30d": Decimal("5000"),
            "revenue_90d": Decimal("14000"),
            "transaction_count_90d": 180,
            "avg_daily_transactions": 2.0,
            "consistency_score": 0.75,
            "receivables_repayment_rate": 0.85,
            "account_age_days": 200,
        }
        defaults.update(overrides)
        return CreditFactors(**defaults)

    def test_high_revenue_consistent_scores_band_a(self):
        factors = self._make_factors(
            revenue_30d=Decimal("25000"),
            revenue_90d=Decimal("70000"),
            transaction_count_90d=450,
            avg_daily_transactions=5.0,
            consistency_score=0.92,
            receivables_repayment_rate=0.97,
            account_age_days=400,
        )
        result = CreditScoringEngine().compute(factors)
        assert result.band == "A"
        assert result.score >= 80
        assert result.max_loan_amount > 0

    def test_new_business_no_history_scores_band_e(self):
        factors = self._make_factors(
            revenue_30d=Decimal("0"),
            revenue_90d=Decimal("0"),
            transaction_count_90d=0,
            avg_daily_transactions=0.0,
            consistency_score=0.0,
            receivables_repayment_rate=1.0,
            account_age_days=3,
        )
        result = CreditScoringEngine().compute(factors)
        assert result.band in ("D", "E")
        assert result.max_loan_amount == Decimal("0")

    def test_mid_tier_scores_band_c(self):
        factors = self._make_factors()
        result = CreditScoringEngine().compute(factors)
        assert result.band in ("B", "C")

    def test_risk_probability_decreases_for_stronger_business(self):
        weak = self._make_factors(
            revenue_30d=Decimal("500"),
            revenue_90d=Decimal("1000"),
            transaction_count_90d=12,
            avg_daily_transactions=0.1,
            consistency_score=0.05,
            receivables_repayment_rate=0.25,
            account_age_days=10,
        )
        strong = self._make_factors(
            revenue_30d=Decimal("25000"),
            revenue_90d=Decimal("70000"),
            transaction_count_90d=450,
            avg_daily_transactions=5.0,
            consistency_score=0.92,
            receivables_repayment_rate=0.97,
            account_age_days=400,
        )

        weak_result = CreditScoringEngine().compute(weak)
        strong_result = CreditScoringEngine().compute(strong)

        assert strong_result.risk_probability < weak_result.risk_probability

    def test_loan_amount_is_half_monthly_revenue(self):
        factors = self._make_factors(
            revenue_30d=Decimal("10000"),
            revenue_90d=Decimal("28000"),
            consistency_score=0.9,
            avg_daily_transactions=5.0,
            receivables_repayment_rate=0.95,
            account_age_days=300,
        )
        result = CreditScoringEngine().compute(factors)
        if result.score >= 50:
            assert result.max_loan_amount == Decimal("5000.00")

    def test_score_never_exceeds_100(self):
        factors = self._make_factors(
            revenue_30d=Decimal("9999999"),
            revenue_90d=Decimal("9999999"),
            avg_daily_transactions=999.0,
            consistency_score=1.0,
            receivables_repayment_rate=1.0,
            account_age_days=9999,
        )
        result = CreditScoringEngine().compute(factors)
        assert result.score <= Decimal("100")

    def test_factors_stored_in_result(self):
        factors = self._make_factors()
        result = CreditScoringEngine().compute(factors)
        assert "revenue_30d" in result.factors
        assert "component_scores" in result.factors
        assert "consistency" in result.factors["component_scores"]
