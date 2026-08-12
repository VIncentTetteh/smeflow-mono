"""
Analytics service — aggregation queries over sales, inventory, and credit data.

All methods accept a business_id UUID and date-range strings (ISO-8601).
Results are plain dicts for easy JSON serialisation.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.modules.inventory.models import Item
from apps.api.modules.sales.models import Customer, Sale, SaleItem

logger = structlog.get_logger()


def _window(from_date: str, to_date: str) -> tuple[datetime, datetime]:
    start = date_type.fromisoformat(from_date)
    end = date_type.fromisoformat(to_date)
    return datetime.combine(start, time.min), datetime.combine(end + timedelta(days=1), time.min)


# Single source of truth for exportable report types — consumed by the analytics
# router (validation + sync download) and the Celery export task.
EXPORT_REPORTS: tuple[str, ...] = (
    "revenue",
    "top_items",
    "profit_loss",
    "cash_flow",
    "expenses",
)


def flatten_for_export(row: dict) -> dict:
    """
    Drop nested values that cannot be rendered as a single spreadsheet cell.

    pnl_summary carries an `expenses_by_category` list for the UI; it has no place
    in a flat CSV/XLSX row.
    """
    return {key: value for key, value in row.items() if not isinstance(value, (list, dict))}


class AnalyticsService:
    def __init__(self, db: AsyncSession, redis_client: Any | None = None):
        self.db = db
        self.redis = redis_client
        self.cache_ttl = 3600  # 1 hour cache for analytics

    async def _get_cached(self, key: str) -> Any | None:
        """Phase 5: Get cached analytics result."""
        if not self.redis:
            return None
        try:
            cached = await self.redis.get(f"analytics:{key}")
            return cached if cached else None
        except Exception:
            return None

    async def _set_cached(self, key: str, data: Any) -> None:
        """Phase 5: Cache analytics result."""
        if not self.redis:
            return
        try:
            await self.redis.setex(f"analytics:{key}", self.cache_ttl, data)
        except Exception:
            logger.warning("analytics.cache_set_failed", key=key)

    # ── Revenue Trends ────────────────────────────────────────────────────────

    async def revenue_by_day(self, business_id: UUID, from_date: str, to_date: str) -> list[dict]:
        """Daily revenue breakdown within a date window."""
        cache_key = f"revenue_by_day:{business_id}:{from_date}:{to_date}"

        # Phase 5: Check cache first
        cached = await self._get_cached(cache_key)
        if cached:
            return cached

        start_at, end_at = _window(from_date, to_date)

        # Optimized query with composite index usage
        day_expr = func.date(Sale.created_at).label("day")

        result = await self.db.execute(
            select(
                day_expr,
                func.count(Sale.id).label("total_sales"),
                func.sum(Sale.total).label("revenue"),
                func.sum(
                    case((Sale.payment_method == "cash", Sale.total), else_=Decimal("0"))
                ).label("cash"),
                func.sum(
                    case((Sale.payment_method == "momo", Sale.total), else_=Decimal("0"))
                ).label("momo"),
                func.sum(
                    case((Sale.payment_method == "credit", Sale.total), else_=Decimal("0"))
                ).label("credit"),
            )
            .where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
            .group_by(func.date(Sale.created_at))
            .order_by(func.date(Sale.created_at))
        )
        rows = result.all()
        data = [
            {
                "day": str(r.day),
                "total_sales": r.total_sales or 0,
                "revenue": r.revenue or Decimal("0"),
                "cash": r.cash or Decimal("0"),
                "momo": r.momo or Decimal("0"),
                "credit": r.credit or Decimal("0"),
            }
            for r in rows
        ]

        # Phase 5: Cache result
        await self._set_cached(cache_key, data)
        return data

    # ── Top Items ─────────────────────────────────────────────────────────────

    async def top_items(
        self, business_id: UUID, from_date: str, to_date: str, limit: int = 10
    ) -> list[dict]:
        """Top items by revenue in a date window."""
        start_at, end_at = _window(from_date, to_date)

        result = await self.db.execute(
            select(
                SaleItem.description,
                SaleItem.item_id,
                func.sum(SaleItem.qty).label("total_qty"),
                func.sum(SaleItem.line_total).label("total_revenue"),
                func.count(SaleItem.id).label("transaction_count"),
            )
            .join(Sale, Sale.id == SaleItem.sale_id)
            .where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
            .group_by(SaleItem.description, SaleItem.item_id)
            .order_by(func.sum(SaleItem.line_total).desc())
            .limit(limit)
        )
        rows = result.all()
        return [
            {
                "item_id": str(r.item_id) if r.item_id else None,
                "description": r.description,
                "total_qty": r.total_qty or Decimal("0"),
                "total_revenue": r.total_revenue or Decimal("0"),
                "transaction_count": r.transaction_count or 0,
            }
            for r in rows
        ]

    # ── P&L Summary ───────────────────────────────────────────────────────────

    async def pnl_summary(self, business_id: UUID, from_date: str, to_date: str) -> dict:
        """
        P&L: revenue - COGS (cost_price * qty sold) = gross profit,
        then - operating expenses = net profit.

        Only operating-kind expense categories are subtracted. Stock purchases are
        already counted in COGS via SaleItem.cost_price, and owner drawings / loan
        principal are not costs of trading — both are excluded by
        ExpenseService.operating_total. Wages reach this figure automatically: a
        disbursed payroll run posts a system expense.
        """
        start_at, end_at = _window(from_date, to_date)

        # Revenue
        rev_result = await self.db.execute(
            select(
                func.sum(Sale.total).label("revenue"),
                func.sum(Sale.discount_amount).label("discounts"),
            ).where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
        )
        rev_row = rev_result.one()
        revenue = rev_row.revenue or Decimal("0")
        discounts = rev_row.discounts or Decimal("0")

        # COGS — prefer the cost_price snapshot on SaleItem (captured at sale time).
        # Fall back to the current Item.cost_price for older rows that pre-date the snapshot.
        from sqlalchemy import case as sa_case

        from apps.api.modules.inventory.models import Item

        cogs_result = await self.db.execute(
            select(
                func.coalesce(
                    func.sum(
                        SaleItem.qty
                        * sa_case(
                            (SaleItem.cost_price.is_not(None), SaleItem.cost_price),
                            else_=func.coalesce(Item.cost_price, Decimal("0")),
                        )
                    ),
                    0,
                ).label("cogs")
            )
            .join(Sale, Sale.id == SaleItem.sale_id)
            .outerjoin(Item, Item.id == SaleItem.item_id)
            .where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
                SaleItem.item_id.is_not(None),
            )
        )
        cogs_row = cogs_result.one()
        cogs = Decimal(str(cogs_row.cogs or 0))

        gross_profit = revenue - cogs
        gross_margin = (gross_profit / revenue * 100) if revenue else Decimal("0")

        from apps.api.modules.expenses.service import ExpenseService

        expense_svc = ExpenseService(self.db)
        start_date = date_type.fromisoformat(from_date)
        end_date = date_type.fromisoformat(to_date)
        operating_expenses = await expense_svc.operating_total(business_id, start_date, end_date)
        expenses_by_category = await expense_svc.totals_by_category(
            business_id, start_date, end_date, operating_only=True
        )

        net_profit = gross_profit - operating_expenses
        net_margin = (net_profit / revenue * 100) if revenue else Decimal("0")

        return {
            "from_date": from_date,
            "to_date": to_date,
            "revenue": float(revenue),
            "discounts": float(discounts),
            "net_revenue": float(revenue - discounts),
            "cogs": float(cogs),
            "gross_profit": float(gross_profit),
            "gross_margin_pct": round(float(gross_margin), 2),
            "operating_expenses": float(operating_expenses),
            "net_profit": float(net_profit),
            "net_margin_pct": round(float(net_margin), 2),
            "expenses_by_category": expenses_by_category,
        }

    async def expense_report(self, business_id: UUID, from_date: str, to_date: str) -> list[dict]:
        """Expense spend broken down by category — the exportable view."""
        from apps.api.modules.expenses.service import ExpenseService

        return await ExpenseService(self.db).totals_by_category(
            business_id, date_type.fromisoformat(from_date), date_type.fromisoformat(to_date)
        )

    async def customer_analytics(self, business_id: UUID, from_date: str, to_date: str) -> dict:
        """Phase 4: Advanced customer analytics and segmentation."""
        start_at, end_at = _window(from_date, to_date)

        # Compute customer value and frequency from sales data
        customer_data = await self.db.execute(
            select(
                Sale.customer_id,
                func.count(Sale.id).label("purchase_count"),
                func.sum(Sale.total).label("lifetime_value"),
            )
            .where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.customer_id.is_not(None),
            )
            .group_by(Sale.customer_id)
        )

        # Segment customers by purchase frequency and total spend
        segments: dict[str, dict[str, Any]] = {
            "vip": {
                "count": 0,
                "avg_lifetime_value": Decimal("0"),
                "total_lifetime_value": Decimal("0"),
            },
            "regular": {
                "count": 0,
                "avg_lifetime_value": Decimal("0"),
                "total_lifetime_value": Decimal("0"),
            },
            "occasional": {
                "count": 0,
                "avg_lifetime_value": Decimal("0"),
                "total_lifetime_value": Decimal("0"),
            },
        }
        for row in customer_data.all():
            value = row.lifetime_value or Decimal("0")
            count = row.purchase_count or 0
            if count >= 10 or value >= Decimal("1000"):
                seg = "vip"
            elif count >= 3:
                seg = "regular"
            else:
                seg = "occasional"
            segments[seg]["count"] += 1
            segments[seg]["total_lifetime_value"] += value

        for seg_data in segments.values():
            n = seg_data["count"]
            seg_data["avg_lifetime_value"] = (
                seg_data["total_lifetime_value"] / n if n > 0 else Decimal("0")
            )

        # Customer retention analysis
        retention_query = (
            select(
                func.date_trunc("month", Sale.created_at).label("month"),
                func.count(func.distinct(Sale.customer_id)).label("active_customers"),
            )
            .where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
            .group_by(func.date_trunc("month", Sale.created_at))
        )

        retention_data = await self.db.execute(retention_query)
        monthly_retention = [
            {"month": str(r.month)[:7], "active_customers": r.active_customers}
            for r in retention_data.all()
        ]

        return {
            "customer_segments": segments,
            "monthly_retention": monthly_retention,
            "period": {"from_date": from_date, "to_date": to_date},
        }

    async def staff_performance(
        self, business_id: UUID, from_date: str, to_date: str
    ) -> list[dict]:
        """Sales grouped by recorded_by (the staff member who processed each
        sale) within a date window — surfaces data already captured on every
        sale but not previously reported anywhere."""
        from apps.api.modules.auth.models import User

        start_at, end_at = _window(from_date, to_date)
        result = await self.db.execute(
            select(
                Sale.recorded_by,
                User.name,
                User.phone,
                func.count(Sale.id).label("sale_count"),
                func.sum(Sale.total).label("revenue"),
            )
            .join(User, User.id == Sale.recorded_by)
            .where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
                Sale.recorded_by.is_not(None),
            )
            .group_by(Sale.recorded_by, User.name, User.phone)
            .order_by(func.sum(Sale.total).desc())
        )
        return [
            {
                "user_id": str(row.recorded_by),
                "name": row.name or row.phone,
                "phone": row.phone,
                "sale_count": row.sale_count,
                "revenue": row.revenue or Decimal("0"),
            }
            for row in result.all()
        ]

    async def predictive_insights(self, business_id: UUID) -> dict:
        """Phase 4: ML-based predictive analytics for business insights."""
        # Revenue forecasting (simple linear trend)
        recent_revenue = await self.db.execute(
            select(
                func.date_trunc("week", Sale.created_at).label("week"),
                func.sum(Sale.total).label("weekly_revenue"),
            )
            .where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= func.now() - func.interval("12 weeks"),
            )
            .group_by(func.date_trunc("week", Sale.created_at))
            .order_by(func.date_trunc("week", Sale.created_at))
        )

        weekly_data = [(str(r.week), float(r.weekly_revenue or 0)) for r in recent_revenue.all()]

        # Simple linear regression for forecasting
        if len(weekly_data) >= 4:
            x = list(range(len(weekly_data)))
            y = [d[1] for d in weekly_data]

            # Calculate slope and intercept
            n = len(x)
            sum_x = sum(x)
            sum_y = sum(y)
            sum_xy = sum(xi * yi for xi, yi in zip(x, y, strict=False))
            sum_xx = sum(xi * xi for xi in x)

            slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x)
            intercept = (sum_y - slope * sum_x) / n

            # Forecast next 4 weeks
            forecast = []
            for i in range(1, 5):
                predicted = intercept + slope * (n + i - 1)
                forecast.append(
                    {
                        "week": i,
                        "predicted_revenue": max(0, predicted),  # No negative revenue
                    }
                )
        else:
            forecast = []

        # Inventory optimization recommendations
        low_stock_items = await self.db.execute(
            select(Item.name, Item.current_stock, Item.low_stock_threshold)
            .where(
                Item.business_id == business_id,
                Item.current_stock <= Item.low_stock_threshold,
            )
            .order_by(Item.current_stock.asc())
            .limit(10)
        )

        recommendations = []
        for item in low_stock_items.all():
            recommendations.append(
                {
                    "item": item.name,
                    "current_stock": item.current_stock,
                    "reorder_point": item.low_stock_threshold,
                    "action": "Reorder immediately" if item.current_stock == 0 else "Reorder soon",
                }
            )

        return {
            "revenue_forecast": forecast,
            "inventory_recommendations": recommendations,
            "data_points": len(weekly_data),
            "confidence_level": "medium" if len(weekly_data) >= 8 else "low",
        }

    async def competitor_benchmarking(self, business_id: UUID, industry: str) -> dict:
        """Phase 4: Anonymous benchmarking against industry peers."""
        # This would typically pull from a centralized benchmarking database
        # For now, return mock comparative data
        business_metrics = await self.pnl_summary(business_id, "2024-01-01", "2024-12-31")

        # Mock industry averages (in production, this would be real aggregated data)
        industry_averages = {
            "retail": {
                "avg_gross_margin": Decimal("35.0"),
                "avg_monthly_revenue": Decimal("15000.00"),
                "avg_customer_retention": Decimal("0.65"),
            },
            "food_service": {
                "avg_gross_margin": Decimal("25.0"),
                "avg_monthly_revenue": Decimal("8000.00"),
                "avg_customer_retention": Decimal("0.55"),
            },
            "services": {
                "avg_gross_margin": Decimal("45.0"),
                "avg_monthly_revenue": Decimal("12000.00"),
                "avg_customer_retention": Decimal("0.70"),
            },
        }

        benchmark = industry_averages.get(industry, industry_averages["retail"])

        return {
            "business_metrics": business_metrics,
            "industry_averages": benchmark,
            "comparison": {
                "gross_margin_percentile": "above_average"
                if business_metrics["gross_margin_pct"] > benchmark["avg_gross_margin"]
                else "below_average",
                "revenue_percentile": "above_average"
                if business_metrics["revenue"] > benchmark["avg_monthly_revenue"] * 12
                else "below_average",
            },
            "industry": industry,
            "disclaimer": "Benchmarks are anonymized aggregates from similar businesses",
        }

    # ── Cash Flow ─────────────────────────────────────────────────────────────

    async def cash_flow(self, business_id: UUID, from_date: str, to_date: str) -> dict:
        """
        Cash inflows (cash + confirmed momo) less expense outflows on the same rails,
        alongside outstanding credit.

        Outflow counts every expense category — money paid out for stock or drawings
        has still left the business, even though it is excluded from operating expenses.
        """
        start_at, end_at = _window(from_date, to_date)

        result = await self.db.execute(
            select(
                func.sum(
                    case((Sale.payment_method == "cash", Sale.amount_paid), else_=Decimal("0"))
                ).label("cash_in"),
                func.sum(
                    case((Sale.payment_method == "momo", Sale.amount_paid), else_=Decimal("0"))
                ).label("momo_in"),
                func.sum(Sale.balance_due).label("outstanding"),
                func.count(Sale.id).label("total_sales"),
            ).where(
                Sale.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
        )
        row = result.one()
        cash_in = row.cash_in or Decimal("0")
        momo_in = row.momo_in or Decimal("0")
        outstanding = row.outstanding or Decimal("0")
        total_inflow = cash_in + momo_in

        from apps.api.modules.expenses.service import ExpenseService

        outflows = await ExpenseService(self.db).cash_outflow(
            business_id, date_type.fromisoformat(from_date), date_type.fromisoformat(to_date)
        )
        cash_out = outflows["cash"]
        momo_out = outflows["momo"]
        total_outflow = cash_out + momo_out

        return {
            "from_date": from_date,
            "to_date": to_date,
            "cash_inflow": cash_in,
            "momo_inflow": momo_in,
            "total_inflow": total_inflow,
            "cash_outflow": cash_out,
            "momo_outflow": momo_out,
            "total_outflow": total_outflow,
            "net_cash_flow": total_inflow - total_outflow,
            "outstanding_credit": outstanding,
            "total_sales": row.total_sales or 0,
        }

    # ── Inventory Turnover ────────────────────────────────────────────────────

    async def inventory_turnover(
        self, business_id: UUID, from_date: str, to_date: str
    ) -> list[dict]:
        """Items with highest sales velocity (qty sold / avg stock) in period."""
        start_at, end_at = _window(from_date, to_date)

        result = await self.db.execute(
            select(
                Item.id,
                Item.name,
                Item.unit,
                Item.current_stock,
                func.sum(SaleItem.qty).label("qty_sold"),
                func.sum(SaleItem.line_total).label("revenue"),
            )
            .join(SaleItem, SaleItem.item_id == Item.id)
            .join(Sale, Sale.id == SaleItem.sale_id)
            .where(
                Item.business_id == business_id,
                Item.deleted_at.is_(None),
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
            .group_by(Item.id, Item.name, Item.unit, Item.current_stock)
            .order_by(func.sum(SaleItem.qty).desc())
            .limit(20)
        )
        rows = result.all()
        return [
            {
                "item_id": str(r.id),
                "name": r.name,
                "unit": r.unit,
                "current_stock": r.current_stock,
                "qty_sold": r.qty_sold or Decimal("0"),
                "revenue": r.revenue or Decimal("0"),
            }
            for r in rows
        ]

    # ── Customer Analytics ────────────────────────────────────────────────────

    async def customer_summary(
        self, business_id: UUID, from_date: str, to_date: str, limit: int = 10
    ) -> list[dict]:
        """Top customers by revenue with payment method mix."""
        start_at, end_at = _window(from_date, to_date)

        result = await self.db.execute(
            select(
                Customer.id,
                Customer.name,
                Customer.phone,
                func.count(Sale.id).label("purchase_count"),
                func.sum(Sale.total).label("total_spent"),
                func.sum(Sale.balance_due).label("outstanding"),
            )
            .join(Sale, Sale.customer_id == Customer.id)
            .where(
                Customer.business_id == business_id,
                Sale.status != "voided",
                Sale.created_at >= start_at,
                Sale.created_at < end_at,
            )
            .group_by(Customer.id, Customer.name, Customer.phone)
            .order_by(func.sum(Sale.total).desc())
            .limit(limit)
        )
        rows = result.all()
        return [
            {
                "customer_id": str(r.id),
                "name": r.name or "Unknown",
                "phone": r.phone,
                "purchase_count": r.purchase_count or 0,
                "total_spent": r.total_spent or Decimal("0"),
                "outstanding": r.outstanding or Decimal("0"),
            }
            for r in rows
        ]

    # ── Low-stock alerts ──────────────────────────────────────────────────────

    async def low_stock_items(self, business_id: UUID) -> list[dict]:
        """Items at or below their low_stock_threshold."""
        result = await self.db.execute(
            select(Item)
            .where(
                Item.business_id == business_id,
                Item.deleted_at.is_(None),
                Item.current_stock <= Item.low_stock_threshold,
            )
            .order_by(Item.current_stock)
            .limit(50)
        )
        items = result.scalars().all()
        return [
            {
                "item_id": str(i.id),
                "name": i.name,
                "unit": i.unit,
                "current_stock": i.current_stock,
                "low_stock_threshold": i.low_stock_threshold,
                "sell_price": i.sell_price,
            }
            for i in items
        ]

    async def predictive_restock_alerts(self, business_id: UUID, days_ahead: int = 7) -> list[dict]:
        """
        Predict items that will need restocking based on sales velocity.
        Uses average daily sales over the last 30 days to project when items will hit low-stock threshold.
        """
        today = date_type.today()
        start_date = (today - timedelta(days=30)).isoformat()
        end_date = today.isoformat()
        start_at, _end_at = _window(start_date, end_date)

        # Get sales velocity (avg daily sales) per item over last 30 days
        velocity_result = await self.db.execute(
            select(
                Item.id,
                Item.name,
                Item.unit,
                Item.current_stock,
                Item.low_stock_threshold,
                Item.cost_price,
                Item.sell_price,
                func.coalesce(func.sum(SaleItem.qty) / 30.0, Decimal("0")).label("avg_daily_sales"),
            )
            .outerjoin(SaleItem, SaleItem.item_id == Item.id)
            .outerjoin(Sale, Sale.id == SaleItem.sale_id)
            .where(
                Item.business_id == business_id,
                Item.deleted_at.is_(None),
                (Sale.created_at >= start_at) | (Sale.id.is_(None)),  # Include items with no sales
            )
            .group_by(
                Item.id,
                Item.name,
                Item.unit,
                Item.current_stock,
                Item.low_stock_threshold,
                Item.cost_price,
                Item.sell_price,
            )
        )

        predictions = []
        for row in velocity_result.all():
            item_id, name, unit, current_stock, threshold, cost_price, _sell_price, avg_daily = row

            # Skip items with no sales activity
            if avg_daily <= 0:
                continue

            # Calculate days until low-stock threshold is reached
            stock_above_threshold = current_stock - threshold
            if stock_above_threshold < 0:
                # Already below threshold
                days_to_threshold = 0
                urgency = "critical"
            elif avg_daily > 0:
                days_to_threshold = int(stock_above_threshold / avg_daily)
                if days_to_threshold <= 1:
                    urgency = "critical"
                elif days_to_threshold <= 3:
                    urgency = "high"
                elif days_to_threshold <= days_ahead:
                    urgency = "medium"
                else:
                    urgency = "low"
            else:
                urgency = "low"
                days_to_threshold = 999

            # Only include items that need attention within the lookahead window
            if days_to_threshold <= days_ahead:
                predictions.append(
                    {
                        "item_id": str(item_id),
                        "name": name,
                        "unit": unit,
                        "current_stock": float(current_stock),
                        "low_stock_threshold": float(threshold),
                        "avg_daily_sales": float(avg_daily),
                        "days_to_threshold": max(0, days_to_threshold),
                        "urgency": urgency,
                        "estimated_restock_cost": float(threshold * cost_price)
                        if cost_price
                        else 0,
                    }
                )

        # Sort by urgency and days to threshold
        urgency_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        predictions.sort(
            key=lambda x: (urgency_order.get(x["urgency"], 99), x["days_to_threshold"])
        )

        return predictions
