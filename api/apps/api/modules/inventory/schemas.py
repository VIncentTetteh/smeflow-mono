"""Inventory schemas."""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

STOCK_ADJUST_REASONS = Literal["purchase", "damage", "adjustment", "transfer", "return"]


class ItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    unit: str = Field(..., max_length=30, description="e.g. piece, kg, litre, box, bag")
    cost_price: Decimal = Field(Decimal("0"), ge=0, decimal_places=2)
    sell_price: Decimal = Field(..., gt=0, decimal_places=2)
    initial_stock: Decimal = Field(Decimal("0"), ge=0)
    low_stock_threshold: Decimal = Field(Decimal("5"), ge=0)
    category_id: UUID | None = None
    sku: str | None = Field(None, max_length=100)
    barcode: str | None = Field(None, max_length=100)


class ItemUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    unit: str | None = None
    cost_price: Decimal | None = Field(None, ge=0)
    sell_price: Decimal | None = Field(None, gt=0)
    low_stock_threshold: Decimal | None = Field(None, ge=0)
    category_id: UUID | None = None
    sku: str | None = None
    barcode: str | None = None
    is_active: bool | None = None
    description: str | None = Field(None, max_length=2000)
    storefront_visible: bool | None = None


class ItemResponse(BaseModel):
    id: UUID
    name: str
    unit: str
    cost_price: Decimal
    sell_price: Decimal
    current_stock: Decimal
    low_stock_threshold: Decimal
    sku: str | None
    barcode: str | None
    is_active: bool
    category_id: UUID | None
    description: str | None = None
    image_url: str | None = None
    storefront_visible: bool = True
    created_at: datetime
    updated_at: datetime
    is_low_stock: bool = False

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_with_flags(cls, item: object) -> "ItemResponse":
        obj = cls.model_validate(item)
        obj.is_low_stock = obj.current_stock <= obj.low_stock_threshold
        return obj


class StockAdjustment(BaseModel):
    item_id: UUID
    qty_change: Decimal = Field(..., description="Positive = add stock, Negative = remove")
    reason: STOCK_ADJUST_REASONS
    unit_cost: Decimal | None = Field(None, ge=0, description="Cost per unit (for purchases)")
    notes: str | None = Field(None, max_length=500)
    client_created_at: datetime | None = None


class StockAdjustmentResponse(BaseModel):
    id: UUID
    item_id: UUID
    type: str
    qty_change: Decimal
    qty_before: Decimal
    qty_after: Decimal
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ItemDetailResponse(ItemResponse):
    stock_history: list[StockAdjustmentResponse] = []


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class CategoryResponse(BaseModel):
    id: UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedItems(BaseModel):
    items: list[ItemResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


class BulkItemsPayload(BaseModel):
    """Payload for POST /items/bulk — import up to 500 items at once."""

    items: list[ItemCreate] = Field(..., min_length=1, max_length=500)


class BulkImportResult(BaseModel):
    """Result of a bulk item import."""

    total: int
    created: int
    failed: int
    errors: list[dict] = []
    job_id: str | None = Field(
        None, description="Celery task ID when processed asynchronously (>20 items)"
    )


class ItemLookupResult(BaseModel):
    """
    Result for a single barcode/SKU in a batch lookup.

    ``found`` is True when a matching item was located.
    When False, ``item`` is None and ``error`` describes the reason.
    """

    query: str = Field(..., description="The barcode or SKU value that was queried")
    query_type: Literal["barcode", "sku"] = Field(..., description="Which field was matched")
    found: bool
    item: ItemResponse | None = None
    error: str | None = Field(
        None, description="Reason for not found (e.g. 'not_found', 'ambiguous')"
    )


class BatchLookupRequest(BaseModel):
    """Request body for POST /inventory/items/lookup/batch."""

    barcodes: list[str] = Field(
        default=[],
        max_length=50,
        description="List of barcode values to look up (max 50)",
    )
    skus: list[str] = Field(
        default=[],
        max_length=50,
        description="List of SKU values to look up (max 50)",
    )


class BatchLookupResponse(BaseModel):
    """Response for POST /inventory/items/lookup/batch."""

    total_queried: int
    found: int
    not_found: int
    results: list[ItemLookupResult]
