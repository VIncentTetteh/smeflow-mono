"""Expense endpoints — recording what the business spends."""

from datetime import date as date_type
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import (
    PaginationParams,
    RequireRole,
    get_current_business_id,
    get_current_user_id,
)
from apps.api.modules.expenses.categories import EXPENSE_CATEGORIES, category_kind, category_label
from apps.api.modules.expenses.models import SOURCE_MANUAL, Expense
from apps.api.modules.expenses.schemas import (
    ExpenseCategoryOption,
    ExpenseCreate,
    ExpenseListResponse,
    ExpenseResponse,
    ExpenseSummaryResponse,
    ExpenseUpdate,
)
from apps.api.modules.expenses.service import ExpenseService

router = APIRouter()

DEFAULT_SUMMARY_DAYS = 30


def _serialize(expense: Expense) -> ExpenseResponse:
    return ExpenseResponse(
        id=expense.id,
        category=expense.category,
        category_label=category_label(expense.category),
        kind=category_kind(expense.category),
        amount=expense.amount,
        vat_amount=expense.vat_amount,
        expense_date=expense.expense_date,
        payment_method=expense.payment_method,
        vendor_name=expense.vendor_name,
        reference=expense.reference,
        notes=expense.notes,
        source=expense.source,
        is_editable=expense.source == SOURCE_MANUAL,
        created_at=expense.created_at,
    )


# ── Categories ────────────────────────────────────────────────────────────────
# Declared before /{expense_id} so the static paths win the route match.


@router.get("/categories", response_model=list[ExpenseCategoryOption])
async def list_categories() -> list[ExpenseCategoryOption]:
    """The fixed expense category set. `kind` tells the client which totals apply."""
    return [ExpenseCategoryOption(**c) for c in EXPENSE_CATEGORIES]


@router.get("/summary", response_model=ExpenseSummaryResponse)
async def expense_summary(
    from_date: date_type | None = Query(None),
    to_date: date_type | None = Query(None),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> ExpenseSummaryResponse:
    """Totals for a date range, broken down by category and payment method."""
    resolved_to = to_date or date_type.today()
    resolved_from = from_date or (resolved_to - timedelta(days=DEFAULT_SUMMARY_DAYS))
    svc = ExpenseService(db)
    return ExpenseSummaryResponse(**await svc.summary(business_id, resolved_from, resolved_to))


# ── Expenses ──────────────────────────────────────────────────────────────────


@router.post("", status_code=201, response_model=ExpenseResponse)
async def record_expense(
    body: ExpenseCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> ExpenseResponse:
    svc = ExpenseService(db)
    expense = await svc.create_expense(business_id, user_id=user_id, **body.model_dump())
    await db.commit()
    return _serialize(expense)


@router.get("", response_model=ExpenseListResponse)
async def list_expenses(
    from_date: date_type | None = Query(None),
    to_date: date_type | None = Query(None),
    category: str | None = Query(None),
    payment_method: str | None = Query(None),
    pagination: PaginationParams = Depends(),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> ExpenseListResponse:
    svc = ExpenseService(db)
    expenses, total = await svc.list_expenses(
        business_id,
        from_date=from_date,
        to_date=to_date,
        category=category,
        payment_method=payment_method,
        limit=pagination.limit,
        offset=pagination.offset,
    )
    return ExpenseListResponse(
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
        items=[_serialize(e) for e in expenses],
    )


@router.get("/{expense_id}", response_model=ExpenseResponse)
async def get_expense(
    expense_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> ExpenseResponse:
    svc = ExpenseService(db)
    return _serialize(await svc.get_expense(business_id, expense_id))


@router.patch("/{expense_id}", response_model=ExpenseResponse)
async def update_expense(
    expense_id: UUID,
    body: ExpenseUpdate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> ExpenseResponse:
    svc = ExpenseService(db)
    expense = await svc.update_expense(
        business_id, expense_id, **body.model_dump(exclude_unset=True)
    )
    await db.commit()
    return _serialize(expense)


@router.delete("/{expense_id}", status_code=204)
async def delete_expense(
    expense_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = ExpenseService(db)
    await svc.delete_expense(business_id, expense_id)
    await db.commit()
