"""Sales schemas."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from apps.api.core.phone import normalize_ghana_phone

PAYMENT_METHODS = Literal["cash", "momo", "paystack", "credit", "mixed", "ghqr"]
SINGLE_PAYMENT_METHODS = Literal["cash", "momo", "credit"]
PAYMENT_PROVIDERS = Literal["mtn", "telecel", "vodafone", "airteltigo"]


class PaymentLeg(BaseModel):
    """One leg of a split payment — e.g. GHS 30 cash + GHS 20 MoMo."""

    method: SINGLE_PAYMENT_METHODS
    amount: Decimal = Field(..., gt=0, le=Decimal("50000.00"), decimal_places=2)
    phone: str | None = Field(
        None, description="Required when method=momo — the customer's MoMo number"
    )
    provider: PAYMENT_PROVIDERS | None = Field(
        None, description="MoMo provider for Paystack mobile money routing"
    )

    @model_validator(mode="after")
    def momo_requires_phone(self) -> "PaymentLeg":
        if self.method == "momo" and not self.phone:
            raise ValueError("phone is required for a MoMo payment leg")
        return self


class SaleItemInput(BaseModel):
    item_id: UUID | None = None
    description: str | None = Field(None, max_length=255, description="Required if item_id is None")
    qty: Decimal = Field(..., gt=0)
    unit_price: Decimal = Field(..., gt=0, decimal_places=2)
    discount: Decimal = Field(Decimal("0"), ge=0)

    @model_validator(mode="after")
    def check_description(self) -> "SaleItemInput":
        if self.item_id is None and not self.description:
            raise ValueError("Either item_id or description must be provided")
        return self


class SaleCreate(BaseModel):
    items: list[SaleItemInput] = Field(..., min_length=1)
    payment_method: PAYMENT_METHODS
    payment_provider: PAYMENT_PROVIDERS | None = Field(
        "mtn", description="MoMo provider for Paystack mobile money routing"
    )
    # Split payment legs — only populated when payment_method == "mixed"
    payment_splits: list[PaymentLeg] | None = Field(
        None,
        description=(
            "Required when payment_method='mixed'. "
            "Splits must sum to the sale total after discounts."
        ),
    )
    customer_phone: str | None = None
    customer_name: str | None = None
    credit_due_date: date | None = None
    reminder_consent: bool = False
    reminder_channel: str | None = None
    discount_amount: Decimal = Field(Decimal("0"), ge=0)
    notes: str | None = None
    idempotency_key: str = Field(
        ..., description="Client-generated UUID. Required for safe retries."
    )
    client_created_at: datetime | None = None

    @model_validator(mode="after")
    def validate_payment(self) -> "SaleCreate":
        if self.payment_method == "momo":
            raise ValueError(
                "Direct MoMo RequestToPay is deprecated. Use Paystack unified checkout."
            )
        if self.payment_method == "mixed":
            if not self.payment_splits:
                raise ValueError("payment_splits is required when payment_method is 'mixed'")
            if len(self.payment_splits) < 2:
                raise ValueError("mixed payment requires at least 2 payment legs")
            methods = [leg.method for leg in self.payment_splits]
            if "momo" in methods:
                raise ValueError(
                    "Direct MoMo payment legs are deprecated. Use Paystack unified checkout."
                )
            if "credit" in methods:
                raise ValueError("Credit cannot be combined with other payment methods in a split")
        if self.customer_phone:
            normalized = normalize_ghana_phone(self.customer_phone)
            if not normalized:
                raise ValueError("customer_phone must be a valid Ghana phone number")
            self.customer_phone = normalized
        if self.payment_method == "credit":
            if not self.customer_name or not self.customer_name.strip():
                raise ValueError("customer_name is required when payment_method is 'credit'")
            if not self.customer_phone:
                raise ValueError("customer_phone is required when payment_method is 'credit'")
            if not self.credit_due_date:
                raise ValueError("credit_due_date is required when payment_method is 'credit'")
            if self.credit_due_date <= datetime.now().date():
                raise ValueError("credit_due_date must be at least the next calendar day")
            if self.reminder_consent and self.reminder_channel not in {"whatsapp", "sms"}:
                raise ValueError("reminder_channel must be whatsapp or sms when consent is granted")
            self.customer_name = self.customer_name.strip()
        return self


class SaleItemResponse(BaseModel):
    id: UUID
    item_id: UUID | None
    description: str
    qty: Decimal
    unit_price: Decimal
    line_total: Decimal
    vat_amount: Decimal

    model_config = {"from_attributes": True}


class SaleResponse(BaseModel):
    id: UUID
    status: str
    payment_method: str
    subtotal: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    notes: str | None
    customer_id: UUID | None
    customer_phone: str | None = None
    credit_due_date: datetime | None = None
    payment_status: str | None = None
    payment_provider_message: str | None = None
    created_at: datetime
    items: list[SaleItemResponse] = []

    model_config = {"from_attributes": True}

    @classmethod
    def from_sale_with_payment(cls, sale: object, payment: object | None = None) -> "SaleResponse":
        """Build response, enriching with MoMo payment status if available."""
        data = cls.model_validate(sale).model_copy(
            update={
                "payment_status": getattr(payment, "status", None) if payment else None,
                "payment_provider_message": getattr(payment, "provider_message", None)
                if payment
                else None,
                "customer_phone": getattr(
                    getattr(sale, "receivable", None), "customer_phone", None
                ),
            }
        )
        return data


class SaleRecordResponse(BaseModel):
    """Response from POST /sales/record"""

    sale_id: UUID
    invoice_id: UUID | None = None
    qr_image_url: str | None = None
    payment_request_id: str | None = None
    total: Decimal
    balance_due: Decimal
    message: str = "Sale recorded successfully"


class MomoSaleIntentResponse(BaseModel):
    payment_id: UUID
    external_ref: str | None = None
    status: str
    total: Decimal
    expires_at: datetime | None = None
    provider_message: str | None = None
    sale_id: UUID | None = None
    invoice_id: UUID | None = None
    balance_due: Decimal | None = None
    message: str = "MoMo payment prompt sent"


class PaymentIntentResponse(MomoSaleIntentResponse):
    payment_url: str | None = None
    qr_image_url: str | None = None
    channel: str | None = None
    provider_detail: str | None = None
    message: str = "Paystack payment link created"


class CreditRepaymentIntentCreate(BaseModel):
    amount: Decimal = Field(..., gt=0, le=Decimal("50000.00"), decimal_places=2)
    idempotency_key: str


class DailySummary(BaseModel):
    date: str
    total_sales: int
    total_revenue: Decimal
    cash_revenue: Decimal
    momo_revenue: Decimal
    credit_revenue: Decimal
    top_items: list[dict] = []


class PeriodSummary(BaseModel):
    from_date: str
    to_date: str
    total_sales: int
    total_revenue: Decimal
    cash_revenue: Decimal
    momo_revenue: Decimal
    credit_revenue: Decimal
    outstanding_credit: Decimal


class CustomerListItem(BaseModel):
    id: UUID
    name: str | None
    phone: str | None
    purchase_count: int
    lifetime_value: Decimal
    outstanding_credit: Decimal
    last_purchase_at: datetime | None
    since: datetime


class CustomerListResponse(BaseModel):
    total: int
    items: list[CustomerListItem]


class CustomerStats(BaseModel):
    purchase_count: int
    lifetime_value: Decimal
    total_paid: Decimal
    outstanding_credit: Decimal
    last_purchase_at: datetime | None


class CustomerTopItem(BaseModel):
    description: str
    total_qty: Decimal
    total_revenue: Decimal


class CustomerRecentSale(BaseModel):
    id: UUID
    total: Decimal
    payment_method: str
    status: str
    created_at: datetime


class CustomerDetailResponse(BaseModel):
    id: UUID
    name: str | None
    phone: str | None
    since: datetime
    stats: CustomerStats
    top_items: list[CustomerTopItem]
    recent_sales: list[CustomerRecentSale]


class RecordPayment(BaseModel):
    amount: Decimal = Field(..., gt=0, le=Decimal("50000.00"))
    payment_method: PAYMENT_METHODS = "cash"
    notes: str | None = None


class BatchSaleItem(BaseModel):
    idempotency_key: str
    sale_data: SaleCreate


class BatchSyncPayload(BaseModel):
    sales: list[SaleCreate] = Field(..., max_length=100)
