"""Expense schemas."""

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from apps.api.modules.expenses.categories import CATEGORY_KEYS, PAYMENT_METHODS


def _validate_category(value: str) -> str:
    if value not in CATEGORY_KEYS:
        raise ValueError(
            f"Unknown expense category '{value}'. "
            f"Valid categories: {', '.join(sorted(CATEGORY_KEYS))}"
        )
    return value


def _validate_payment_method(value: str) -> str:
    if value not in PAYMENT_METHODS:
        raise ValueError(
            f"Unknown payment method '{value}'. Valid methods: {', '.join(sorted(PAYMENT_METHODS))}"
        )
    return value


class ExpenseCreate(BaseModel):
    category: str = Field(..., max_length=50)
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    expense_date: date
    payment_method: str = Field("cash", max_length=20)
    vat_amount: Decimal | None = Field(None, ge=0, decimal_places=2)
    vendor_name: str | None = Field(None, max_length=255)
    reference: str | None = Field(None, max_length=100)
    notes: str | None = Field(None, max_length=500)

    _check_category = field_validator("category")(_validate_category)
    _check_payment_method = field_validator("payment_method")(_validate_payment_method)


class ExpenseUpdate(BaseModel):
    category: str | None = Field(None, max_length=50)
    amount: Decimal | None = Field(None, gt=0, decimal_places=2)
    expense_date: date | None = None
    payment_method: str | None = Field(None, max_length=20)
    vat_amount: Decimal | None = Field(None, ge=0, decimal_places=2)
    vendor_name: str | None = Field(None, max_length=255)
    reference: str | None = Field(None, max_length=100)
    notes: str | None = Field(None, max_length=500)

    @field_validator("category")
    @classmethod
    def _check_category(cls, value: str | None) -> str | None:
        return _validate_category(value) if value is not None else None

    @field_validator("payment_method")
    @classmethod
    def _check_payment_method(cls, value: str | None) -> str | None:
        return _validate_payment_method(value) if value is not None else None


class ExpenseResponse(BaseModel):
    id: UUID
    category: str
    category_label: str
    kind: str
    amount: Decimal
    vat_amount: Decimal | None
    expense_date: date
    payment_method: str
    vendor_name: str | None
    reference: str | None
    notes: str | None
    source: str
    is_editable: bool
    created_at: datetime


class CategoryTotal(BaseModel):
    category: str
    label: str
    kind: str
    total: float
    count: int


class PaymentMethodTotal(BaseModel):
    payment_method: str
    total: float
    count: int


class ExpenseSummaryResponse(BaseModel):
    from_date: date
    to_date: date
    total: float
    operating_total: float
    excluded_total: float = Field(
        ...,
        description="Spend recorded under cogs / non-operating categories, "
        "excluded from operating expenses and net profit.",
    )
    count: int
    by_category: list[CategoryTotal]
    by_payment_method: list[PaymentMethodTotal]


class ExpenseListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ExpenseResponse]


class ExpenseCategoryOption(BaseModel):
    key: str
    label: str
    kind: str
