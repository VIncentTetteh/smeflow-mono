"""
Expense service — CRUD plus the aggregation helpers the P&L depends on.

`operating_total`, `totals_by_category` and `cash_outflow` are the read side used by
AnalyticsService; they all filter on `kind == "operating"` where relevant so that
stock purchases (already in COGS) and owner drawings cannot inflate expenses.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.exceptions import ConflictError, NotFoundError
from apps.api.modules.expenses.categories import (
    CASH_PAYMENT_METHODS,
    OPERATING_CATEGORY_KEYS,
    category_kind,
    category_label,
)
from apps.api.modules.expenses.models import SOURCE_MANUAL, Expense


class ExpenseService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Write ─────────────────────────────────────────────────────────────────

    async def create_expense(
        self,
        business_id: UUID,
        *,
        user_id: UUID | None = None,
        source: str = SOURCE_MANUAL,
        source_id: UUID | None = None,
        **fields: object,
    ) -> Expense:
        expense = Expense(
            business_id=business_id,
            recorded_by=user_id,
            source=source,
            source_id=source_id,
            **fields,
        )
        self.db.add(expense)
        await self.db.flush([expense])
        return expense

    async def update_expense(
        self, business_id: UUID, expense_id: UUID, **fields: object
    ) -> Expense:
        expense = await self.get_expense(business_id, expense_id)
        self._assert_editable(expense)
        for key, value in fields.items():
            setattr(expense, key, value)
        await self.db.flush([expense])
        return expense

    async def delete_expense(self, business_id: UUID, expense_id: UUID) -> None:
        expense = await self.get_expense(business_id, expense_id)
        self._assert_editable(expense)
        expense.deleted_at = datetime.now(timezone.utc)
        await self.db.flush([expense])

    @staticmethod
    def _assert_editable(expense: Expense) -> None:
        if expense.source != SOURCE_MANUAL:
            raise ConflictError(
                f"This expense was created automatically from {expense.source} and "
                "cannot be edited or deleted here."
            )

    async def upsert_system_expense(
        self,
        business_id: UUID,
        *,
        source: str,
        source_id: UUID,
        category: str,
        amount: Decimal,
        expense_date: date_type,
        payment_method: str = "momo",
        vendor_name: str | None = None,
        notes: str | None = None,
    ) -> Expense:
        """
        Create or update the single system-generated expense for (source, source_id).

        Idempotent: a retried payroll disbursement updates the existing row rather
        than adding a second one. Backed by the uq_expenses_source unique index.
        """
        existing = (
            await self.db.execute(
                select(Expense).where(
                    Expense.business_id == business_id,
                    Expense.source == source,
                    Expense.source_id == source_id,
                )
            )
        ).scalar_one_or_none()

        if existing is not None:
            existing.category = category
            existing.amount = amount
            existing.expense_date = expense_date
            existing.payment_method = payment_method
            existing.vendor_name = vendor_name
            existing.notes = notes
            existing.deleted_at = None
            await self.db.flush([existing])
            return existing

        return await self.create_expense(
            business_id,
            source=source,
            source_id=source_id,
            category=category,
            amount=amount,
            expense_date=expense_date,
            payment_method=payment_method,
            vendor_name=vendor_name,
            notes=notes,
        )

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get_expense(self, business_id: UUID, expense_id: UUID) -> Expense:
        expense = (
            await self.db.execute(
                select(Expense).where(
                    Expense.id == expense_id,
                    Expense.business_id == business_id,
                    Expense.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if expense is None:
            raise NotFoundError("Expense", str(expense_id))
        return expense

    async def list_expenses(
        self,
        business_id: UUID,
        *,
        from_date: date_type | None = None,
        to_date: date_type | None = None,
        category: str | None = None,
        payment_method: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Expense], int]:
        filters = self._filters(business_id, from_date, to_date)
        if category:
            filters.append(Expense.category == category)
        if payment_method:
            filters.append(Expense.payment_method == payment_method)

        total = (await self.db.execute(select(func.count(Expense.id)).where(*filters))).scalar_one()

        rows = (
            await self.db.execute(
                select(Expense)
                .where(*filters)
                .order_by(Expense.expense_date.desc(), Expense.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        ).scalars()
        return list(rows), int(total or 0)

    async def summary(self, business_id: UUID, from_date: date_type, to_date: date_type) -> dict:
        """Totals for a date range, split by category and by payment method."""
        by_category = await self.totals_by_category(business_id, from_date, to_date)

        operating_total = sum(
            (Decimal(str(row["total"])) for row in by_category if row["kind"] == "operating"),
            Decimal("0"),
        )
        grand_total = sum((Decimal(str(row["total"])) for row in by_category), Decimal("0"))

        method_rows = (
            await self.db.execute(
                select(
                    Expense.payment_method,
                    func.coalesce(func.sum(Expense.amount), 0).label("total"),
                    func.count(Expense.id).label("count"),
                )
                .where(*self._filters(business_id, from_date, to_date))
                .group_by(Expense.payment_method)
                .order_by(func.sum(Expense.amount).desc())
            )
        ).all()

        return {
            "from_date": from_date,
            "to_date": to_date,
            "total": float(grand_total),
            "operating_total": float(operating_total),
            "excluded_total": float(grand_total - operating_total),
            "count": sum(row["count"] for row in by_category),
            "by_category": by_category,
            "by_payment_method": [
                {
                    "payment_method": r.payment_method,
                    "total": float(r.total or 0),
                    "count": int(r.count or 0),
                }
                for r in method_rows
            ],
        }

    async def totals_by_category(
        self,
        business_id: UUID,
        from_date: date_type,
        to_date: date_type,
        *,
        operating_only: bool = False,
    ) -> list[dict]:
        filters = self._filters(business_id, from_date, to_date)
        if operating_only:
            filters.append(Expense.category.in_(OPERATING_CATEGORY_KEYS))

        rows = (
            await self.db.execute(
                select(
                    Expense.category,
                    func.coalesce(func.sum(Expense.amount), 0).label("total"),
                    func.count(Expense.id).label("count"),
                )
                .where(*filters)
                .group_by(Expense.category)
                .order_by(func.sum(Expense.amount).desc())
            )
        ).all()

        return [
            {
                "category": r.category,
                "label": category_label(r.category),
                "kind": category_kind(r.category),
                "total": float(r.total or 0),
                "count": int(r.count or 0),
            }
            for r in rows
        ]

    async def operating_total(
        self, business_id: UUID, from_date: date_type, to_date: date_type
    ) -> Decimal:
        """Sum of operating-kind expenses — the figure subtracted from gross profit."""
        total = (
            await self.db.execute(
                select(func.coalesce(func.sum(Expense.amount), 0)).where(
                    *self._filters(business_id, from_date, to_date),
                    Expense.category.in_(OPERATING_CATEGORY_KEYS),
                )
            )
        ).scalar_one()
        return Decimal(str(total or 0))

    async def cash_outflow(
        self, business_id: UUID, from_date: date_type, to_date: date_type
    ) -> dict[str, Decimal]:
        """
        Expense spend that actually left the business, split by rail.

        Counts every category — money paid out for stock or drawings is still cash
        gone, even though it does not belong in operating expenses.
        """
        rows = (
            await self.db.execute(
                select(
                    Expense.payment_method,
                    func.coalesce(func.sum(Expense.amount), 0).label("total"),
                )
                .where(
                    *self._filters(business_id, from_date, to_date),
                    Expense.payment_method.in_(CASH_PAYMENT_METHODS),
                )
                .group_by(Expense.payment_method)
            )
        ).all()

        totals = {method: Decimal("0") for method in CASH_PAYMENT_METHODS}
        for row in rows:
            totals[row.payment_method] = Decimal(str(row.total or 0))
        return totals

    # ── Internals ─────────────────────────────────────────────────────────────

    @staticmethod
    def _filters(business_id: UUID, from_date: date_type | None, to_date: date_type | None) -> list:
        filters = [Expense.business_id == business_id, Expense.deleted_at.is_(None)]
        if from_date is not None:
            filters.append(Expense.expense_date >= from_date)
        if to_date is not None:
            filters.append(Expense.expense_date <= to_date)
        return filters
