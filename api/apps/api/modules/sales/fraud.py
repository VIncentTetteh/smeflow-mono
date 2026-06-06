"""Lightweight sales fraud checks for Phase 4 production hardening."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.audit import audit
from apps.api.modules.sales.models import Sale

logger = structlog.get_logger()


@dataclass(frozen=True)
class FraudCheck:
    is_fraud: bool
    reason: str
    observed: str
    limit: str


@dataclass(frozen=True)
class FraudResult:
    blocked: bool
    reasons: list[str]
    checks: list[FraudCheck]


class FraudDetector:
    """Velocity and amount checks that block obvious abuse before persistence."""

    SALES_PER_HOUR = 200
    SALES_PER_MINUTE = 10
    MAX_SINGLE_SALE_GHS = Decimal("50000")
    MOMO_COLLECTIONS_PER_DAY = 500

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def check_sale(self, business_id: UUID, amount: Decimal) -> FraudResult:
        now = datetime.now(timezone.utc)
        checks = [
            await self._check_sales_velocity(
                business_id, now - timedelta(hours=1), self.SALES_PER_HOUR, "sales_per_hour"
            ),
            await self._check_sales_velocity(
                business_id,
                now - timedelta(minutes=1),
                self.SALES_PER_MINUTE,
                "sales_per_minute",
            ),
            self._check_amount(amount),
            await self._check_momo_velocity(business_id, now - timedelta(days=1)),
        ]
        failed = [check for check in checks if check.is_fraud]
        if failed:
            reasons = [check.reason for check in failed]
            await self.flag_for_review(business_id, failed)
            return FraudResult(blocked=True, reasons=reasons, checks=checks)
        return FraudResult(blocked=False, reasons=[], checks=checks)

    async def flag_for_review(self, business_id: UUID, checks: list[FraudCheck]) -> None:
        payload = {
            "reasons": [check.reason for check in checks],
            "checks": [
                {"reason": check.reason, "observed": check.observed, "limit": check.limit}
                for check in checks
            ],
        }
        await audit(
            self.db,
            action="fraud.flagged",
            resource_type="Business",
            resource_id=business_id,
            business_id=business_id,
            after=payload,
        )
        logger.warning("fraud.sale_blocked", business_id=str(business_id), **payload)

    async def _check_sales_velocity(
        self, business_id: UUID, since: datetime, limit: int, reason: str
    ) -> FraudCheck:
        count = (
            await self.db.execute(
                select(func.count(Sale.id)).where(
                    Sale.business_id == business_id,
                    Sale.status != "voided",
                    Sale.created_at >= since,
                )
            )
        ).scalar_one()
        return FraudCheck(
            is_fraud=count >= limit,
            reason=reason,
            observed=str(count),
            limit=str(limit),
        )

    def _check_amount(self, amount: Decimal) -> FraudCheck:
        return FraudCheck(
            is_fraud=amount > self.MAX_SINGLE_SALE_GHS,
            reason="max_single_sale_ghs",
            observed=str(amount),
            limit=str(self.MAX_SINGLE_SALE_GHS),
        )

    async def _check_momo_velocity(self, business_id: UUID, since: datetime) -> FraudCheck:
        count = (
            await self.db.execute(
                select(func.count(Sale.id)).where(
                    Sale.business_id == business_id,
                    Sale.payment_method == "momo",
                    Sale.status != "voided",
                    Sale.created_at >= since,
                )
            )
        ).scalar_one()
        return FraudCheck(
            is_fraud=count >= self.MOMO_COLLECTIONS_PER_DAY,
            reason="momo_collections_per_day",
            observed=str(count),
            limit=str(self.MOMO_COLLECTIONS_PER_DAY),
        )
