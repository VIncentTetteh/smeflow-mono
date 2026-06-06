"""
Credit scoring engine — rule-based v1 with ML enhancement.
Computes a 0-100 score from transaction history, revenue consistency, and repayment rate.
Includes ML-based prediction model for Phase 4 advanced scoring.
"""

from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


@dataclass
class CreditFactors:
    revenue_30d: Decimal
    revenue_90d: Decimal
    transaction_count_90d: int
    avg_daily_transactions: float
    consistency_score: float  # % of days with ≥1 sale in last 90d (0.0-1.0)
    receivables_repayment_rate: float  # % of credit sales collected (0.0-1.0)
    account_age_days: int
    momo_velocity: float = 0.0
    # Phase 4 additions
    inventory_turnover_ratio: float = 0.0
    customer_retention_rate: float = 0.0
    seasonal_trend_score: float = 0.0
    digital_adoption_score: float = 0.0


@dataclass
class CreditScoreResult:
    score: Decimal  # 0-100
    band: str  # A, B, C, D, E
    max_loan_amount: Decimal
    factors: dict
    risk_probability: float  # ML-based risk assessment (0.0-1.0)
    confidence_score: float  # Model confidence (0.0-1.0)


WEIGHTS = {
    "revenue_30d": 0.20,
    "revenue_90d": 0.15,
    "transaction_frequency": 0.15,
    "consistency": 0.12,
    "repayment": 0.12,
    "account_age": 0.05,
    "inventory_turnover": 0.08,
    "customer_retention": 0.08,
    "seasonal_trend": 0.03,
    "digital_adoption": 0.02,
}

MAX_LOAN_MULTIPLIER = Decimal("0.5")  # Up to 50% of monthly revenue
MIN_SCORE_FOR_LOAN = Decimal("50")
REVENUE_BENCHMARK = 10_000  # GHS 10k/month = 100 points
ADVANCED_FACTOR_KEYS = {
    "inventory_turnover",
    "customer_retention",
    "seasonal_trend",
    "digital_adoption",
}


class CreditScoringEngine:
    def __init__(self, use_ml: bool = True):
        self.use_ml = use_ml
        self.ml_model = None
        if use_ml:
            self._load_ml_model()

    def _load_ml_model(self):
        """Load pre-trained ML model for credit risk prediction."""
        # Phase 4: ML model integration
        # In production, this would load a trained model from disk/storage
        # For now, we'll use a simplified ML-like approach
        self.ml_model = {
            "weights": {
                "revenue_ratio": 0.3,
                "consistency": 0.25,
                "repayment_rate": 0.25,
                "age_factor": 0.1,
                "inventory_factor": 0.05,
                "retention_factor": 0.05,
            },
            "bias": 0.1,
            "trained": True,
        }

    def _ml_predict_risk(self, factors: CreditFactors) -> tuple[float, float]:
        """ML-based risk prediction returning (risk_probability, confidence)."""
        if not self.ml_model:
            return 0.5, 0.5  # Neutral risk, low confidence

        # Until a trained model is deployed, derive risk from business health.
        # Better health must lower risk; the previous linear placeholder inverted
        # that relationship and penalized stronger traders.
        health_score = self._normalized_rule_score(factors) / 100.0
        risk_probability = max(0.02, min(0.98, 1 - health_score))

        confidence = min(
            (factors.transaction_count_90d / 90.0) * 0.5
            + factors.consistency_score * 0.3
            + (1 if factors.account_age_days > 30 else 0) * 0.2,
            1.0,
        )

        return risk_probability, confidence

    def _normalized_rule_score(self, factors: CreditFactors) -> float:
        component_scores = self._component_scores(factors)
        active_weights = {
            key: weight
            for key, weight in WEIGHTS.items()
            if key not in ADVANCED_FACTOR_KEYS or component_scores[key] > 0
        }
        weighted_score = sum(
            component_scores[key] * weight for key, weight in active_weights.items()
        )
        return weighted_score / sum(active_weights.values())

    def _component_scores(self, factors: CreditFactors) -> dict[str, float]:
        return {
            "revenue_30d": min(float(factors.revenue_30d) / REVENUE_BENCHMARK * 100, 100),
            "revenue_90d": min(float(factors.revenue_90d) / (REVENUE_BENCHMARK * 3) * 100, 100),
            "transaction_frequency": min(factors.avg_daily_transactions / 10.0 * 100, 100),
            "consistency": factors.consistency_score * 100,
            "repayment": factors.receivables_repayment_rate * 100,
            "account_age": min(factors.account_age_days / 365 * 100, 100),
            "inventory_turnover": min(factors.inventory_turnover_ratio / 12.0 * 100, 100),
            "customer_retention": factors.customer_retention_rate * 100,
            "seasonal_trend": factors.seasonal_trend_score * 100,
            "digital_adoption": factors.digital_adoption_score * 100,
        }

    def compute(self, factors: CreditFactors) -> CreditScoreResult:
        component_scores = self._component_scores(factors)
        rev_30d_score = component_scores["revenue_30d"]
        freq_score = component_scores["transaction_frequency"]
        consistency_score = component_scores["consistency"]
        repayment_score = component_scores["repayment"]
        age_score = component_scores["account_age"]
        inventory_score = component_scores["inventory_turnover"]
        retention_score = component_scores["customer_retention"]
        seasonal_score = component_scores["seasonal_trend"]
        digital_score = component_scores["digital_adoption"]

        # Optional Phase 4 factors are only included when data is present. A new
        # pilot trader should not be penalized because advanced analytics inputs
        # have not been populated yet.
        rule_based_score = self._normalized_rule_score(factors)

        risk_probability, confidence_score = self._ml_predict_risk(factors)

        # Blend rule-based scoring with the placeholder ML risk only when the
        # confidence signal has meaningful data behind it.
        ml_adjustment = (1 - risk_probability) * 100
        ml_weight = 0.15 * confidence_score
        final_score = (rule_based_score * (1 - ml_weight)) + (ml_adjustment * ml_weight)

        score = Decimal(str(round(final_score, 2)))
        band = (
            "A"
            if score >= 80
            else "B"
            if score >= 65
            else "C"
            if score >= 50
            else "D"
            if score >= 35
            else "E"
        )
        max_loan = (
            factors.revenue_30d * MAX_LOAN_MULTIPLIER
            if score >= MIN_SCORE_FOR_LOAN
            else Decimal("0")
        )

        return CreditScoreResult(
            score=score,
            band=band,
            max_loan_amount=max_loan.quantize(Decimal("0.01")),
            risk_probability=risk_probability,
            confidence_score=confidence_score,
            factors={
                "revenue_30d": float(factors.revenue_30d),
                "revenue_90d": float(factors.revenue_90d),
                "transaction_count_90d": factors.transaction_count_90d,
                "consistency_score": factors.consistency_score,
                "repayment_rate": factors.receivables_repayment_rate,
                "momo_velocity": factors.momo_velocity,
                "account_age_days": factors.account_age_days,
                "inventory_turnover_ratio": factors.inventory_turnover_ratio,
                "customer_retention_rate": factors.customer_retention_rate,
                "seasonal_trend_score": factors.seasonal_trend_score,
                "digital_adoption_score": factors.digital_adoption_score,
                "component_scores": {
                    "revenue_30d": round(rev_30d_score, 1),
                    "revenue_90d": round(component_scores["revenue_90d"], 1),
                    "frequency": round(freq_score, 1),
                    "consistency": round(consistency_score, 1),
                    "repayment": round(repayment_score, 1),
                    "age": round(age_score, 1),
                    "inventory": round(inventory_score, 1),
                    "retention": round(retention_score, 1),
                    "seasonal": round(seasonal_score, 1),
                    "digital": round(digital_score, 1),
                },
                "ml_insights": {
                    "risk_probability": round(risk_probability, 3),
                    "confidence_score": round(confidence_score, 3),
                    "model_used": self.use_ml,
                },
            },
        )


async def compute_factors(db: AsyncSession, business_id: UUID) -> CreditFactors:
    """Aggregate transaction history into CreditFactors for scoring."""
    from datetime import datetime, timedelta, timezone
    from decimal import Decimal

    from sqlalchemy import case, func, select

    from apps.api.modules.business.models import Business
    from apps.api.modules.payments.models import Payment
    from apps.api.modules.sales.models import Receivable, Sale

    now = datetime.now(timezone.utc)
    cutoff_30d = now - timedelta(days=30)
    cutoff_90d = now - timedelta(days=90)
    cutoff_180d = now - timedelta(days=180)

    # Revenue last 30 days
    rev_30d_result = await db.execute(
        select(func.coalesce(func.sum(Sale.total), 0)).where(
            Sale.business_id == business_id,
            Sale.status != "voided",
            Sale.created_at >= cutoff_30d,
        )
    )
    revenue_30d = Decimal(str(rev_30d_result.scalar() or 0))

    # Revenue last 90 days
    rev_90d_result = await db.execute(
        select(func.coalesce(func.sum(Sale.total), 0)).where(
            Sale.business_id == business_id,
            Sale.status != "voided",
            Sale.created_at >= cutoff_90d,
        )
    )
    revenue_90d = Decimal(str(rev_90d_result.scalar() or 0))

    # Transaction count + distinct active days (consistency)
    txn_result = await db.execute(
        select(
            func.count(Sale.id).label("transaction_count"),
            func.count(func.distinct(func.date(Sale.created_at))).label("distinct_days"),
        ).where(
            Sale.business_id == business_id,
            Sale.status != "voided",
            Sale.created_at >= cutoff_90d,
        )
    )
    row = txn_result.one()
    txn_count = row.transaction_count or 0
    distinct_days = row.distinct_days or 0
    consistency = distinct_days / 90.0

    # Receivables repayment rate
    rec_result = await db.execute(
        select(
            func.coalesce(func.sum(Receivable.amount), 0).label("total"),
            func.coalesce(func.sum(Receivable.amount_paid), 0).label("paid"),
        ).where(
            Receivable.business_id == business_id,
            Receivable.created_at >= cutoff_180d,
        )
    )
    rec_row = rec_result.one()
    repayment_rate = (float(rec_row.paid) / float(rec_row.total)) if rec_row.total > 0 else 1.0

    momo_result = await db.execute(
        select(func.count(Payment.id)).where(
            Payment.business_id == business_id,
            Payment.type == "collection",
            Payment.provider.in_(["mtn", "telecel", "vodafone", "airteltigo"]),
            Payment.status == "success",
            Payment.created_at >= cutoff_90d,
        )
    )
    momo_velocity = (momo_result.scalar() or 0) / 90.0

    # Business age
    biz_result = await db.execute(select(Business.created_at).where(Business.id == business_id))
    created_at = biz_result.scalar_one_or_none()
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    age_days = (now - created_at).days if created_at else 0

    # Phase 4: Advanced factors

    # Inventory turnover ratio (COGS / Average Inventory)
    from apps.api.modules.inventory.models import Item, StockTransaction

    inventory_result = await db.execute(
        select(
            func.coalesce(func.sum(Item.cost_price * Item.current_stock), 0).label(
                "inventory_value"
            ),
            func.coalesce(func.sum(func.abs(StockTransaction.qty_change) * Item.cost_price), 0).label(
                "cogs_90d"
            ),
        )
        .select_from(StockTransaction)
        .join(Item, Item.id == StockTransaction.item_id, isouter=True)
        .where(
            StockTransaction.business_id == business_id,
            StockTransaction.type == "sale",
            StockTransaction.created_at >= cutoff_90d,
        )
    )
    inv_row = inventory_result.one()
    avg_inventory = float(inv_row.inventory_value or 0)  # Current-stock snapshot
    cogs_90d = float(inv_row.cogs_90d or 0)
    inventory_turnover = cogs_90d / avg_inventory if avg_inventory > 0 else 0.0

    # Customer retention rate (repeat customers / total customers)
    customer_result = await db.execute(
        select(
            Sale.customer_id,
            func.count(Sale.customer_id).label("sale_count"),
        )
        .where(
            Sale.business_id == business_id,
            Sale.status != "voided",
            Sale.customer_id.is_not(None),
            Sale.created_at >= cutoff_180d,
        )
        .group_by(Sale.customer_id)
    )
    customer_rows = customer_result.all()
    total_customers = len(customer_rows)
    repeat_customers = sum(1 for row in customer_rows if row.sale_count and row.sale_count > 1)
    retention_rate = repeat_customers / total_customers if total_customers > 0 else 0.0

    # Seasonal trend score (revenue stability across months)
    monthly_result = await db.execute(
        select(Sale.created_at, Sale.total)
        .where(
            Sale.business_id == business_id,
            Sale.status != "voided",
            Sale.created_at >= cutoff_180d,
        )
        .order_by(Sale.created_at)
    )
    monthly_buckets: dict[tuple[int, int], float] = {}
    for month_row in monthly_result.all():
        created = month_row.created_at
        if created is None:
            continue
        monthly_buckets[(created.year, created.month)] = monthly_buckets.get(
            (created.year, created.month), 0.0
        ) + float(month_row.total or 0)
    monthly_revenues = list(monthly_buckets.values())
    if len(monthly_revenues) >= 3:
        # Coefficient of variation (lower = more stable = better score)
        mean_rev = sum(monthly_revenues) / len(monthly_revenues)
        variance = sum((x - mean_rev) ** 2 for x in monthly_revenues) / len(monthly_revenues)
        std_dev = variance**0.5
        cv = std_dev / mean_rev if mean_rev > 0 else 1.0
        seasonal_trend = max(0, 1 - cv)  # Convert to 0-1 score
    else:
        seasonal_trend = 0.5  # Neutral for new businesses

    # Digital adoption score (ratio of digital payments to total)
    digital_result = await db.execute(
        select(
            func.count(Sale.id).label("total_sales"),
            func.count(
                case((Sale.payment_method.in_(["momo", "mixed", "card"]), Sale.id), else_=None)
            ).label("digital_sales"),
        ).where(
            Sale.business_id == business_id,
            Sale.status != "voided",
            Sale.created_at >= cutoff_90d,
        )
    )
    digital_row = digital_result.one()
    total_sales = digital_row.total_sales or 0
    digital_sales = digital_row.digital_sales or 0
    digital_adoption = digital_sales / total_sales if total_sales > 0 else 0.0

    return CreditFactors(
        revenue_30d=revenue_30d,
        revenue_90d=revenue_90d,
        transaction_count_90d=txn_count,
        avg_daily_transactions=txn_count / 90.0,
        consistency_score=consistency,
        receivables_repayment_rate=repayment_rate,
        momo_velocity=momo_velocity,
        account_age_days=age_days,
        inventory_turnover_ratio=inventory_turnover,
        customer_retention_rate=retention_rate,
        seasonal_trend_score=seasonal_trend,
        digital_adoption_score=digital_adoption,
    )
