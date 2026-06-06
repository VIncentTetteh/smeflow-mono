"""Inventory endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import (
    PaginationParams,
    RequireFeature,
    RequireRole,
    get_current_business_id,
    get_current_user_id,
    require_kyc_verified,
)
from apps.api.modules.inventory.schemas import (
    BatchLookupRequest,
    BatchLookupResponse,
    BulkImportResult,
    BulkItemsPayload,
    CategoryCreate,
    CategoryResponse,
    ItemCreate,
    ItemDetailResponse,
    ItemLookupResult,
    ItemResponse,
    ItemUpdate,
    PaginatedItems,
    StockAdjustment,
    StockAdjustmentResponse,
)
from apps.api.modules.inventory.service import InventoryService
from apps.api.workers.dispatch import enqueue_task

router = APIRouter()
_require_bulk_csv_import = RequireFeature("bulk_csv_import")


@router.post("/items", response_model=ItemResponse, status_code=201)
async def create_item(
    body: ItemCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    db: AsyncSession = Depends(get_db),
) -> ItemResponse:
    svc = InventoryService(db)
    item = await svc.create_item(business_id, user_id, body)
    return ItemResponse.from_orm_with_flags(item)


@router.post("/items/bulk", response_model=BulkImportResult, status_code=202)
async def bulk_import_items(
    body: BulkItemsPayload,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    db: AsyncSession = Depends(get_db),
) -> BulkImportResult:
    """
    Bulk-import up to 500 inventory items in a single request.
    Items with ≤20 rows are committed immediately (synchronous).
    Larger payloads are dispatched to a Celery worker and the response
    includes a `job_id` for polling via GET /tasks/{job_id}.
    """
    svc = InventoryService(db)
    items = body.items

    if len(items) > 20:
        # Fire-and-forget via Celery
        try:
            from apps.api.workers.tasks.inventory_tasks import bulk_import_items_task

            task = enqueue_task(
                bulk_import_items_task,
                str(business_id),
                str(user_id),
                [item.model_dump(mode="json") for item in items],
            )
            if task is None:
                raise RuntimeError("Celery dispatch unavailable")
            return BulkImportResult(
                total=len(items),
                created=0,
                failed=0,
                errors=[],
                job_id=task.id,
            )
        except Exception as celery_exc:
            import structlog as _log

            _log.get_logger().warning("inventory.bulk_celery_unavailable", error=str(celery_exc))

    result = await svc.bulk_create_items(business_id, user_id, items)
    await db.commit()
    return BulkImportResult(**result)


@router.get("/items", response_model=PaginatedItems)
async def list_items(
    business_id: UUID = Depends(get_current_business_id),
    search: str | None = Query(None),
    low_stock: bool = Query(False),
    category_id: UUID | None = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
) -> PaginatedItems:
    svc = InventoryService(db)
    items, total = await svc.get_items(
        business_id, search, low_stock, category_id, pagination.limit, pagination.offset
    )
    return PaginatedItems(
        items=[ItemResponse.from_orm_with_flags(i) for i in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
        has_more=(pagination.offset + pagination.limit) < total,
    )


@router.get("/items/lookup", response_model=ItemResponse)
async def lookup_item(
    barcode: str | None = Query(None, description="Exact barcode value to find an item."),
    sku: str | None = Query(None, description="Exact SKU value to find an item."),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> ItemResponse:
    if barcode is None and sku is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="barcode or sku is required for lookup.",
        )
    svc = InventoryService(db)
    item = await svc.find_item_by_lookup(business_id, barcode, sku)
    return ItemResponse.from_orm_with_flags(item)


@router.post(
    "/items/lookup/batch",
    response_model=BatchLookupResponse,
    summary="Batch barcode / SKU lookup",
    tags=["Inventory"],
)
async def batch_lookup_items(
    body: BatchLookupRequest,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> BatchLookupResponse:
    """
    Look up multiple items by barcode and/or SKU in a single request.

    - Accepts up to **50 barcodes** and **50 SKUs** per call (100 total).
    - Uses two IN-queries internally — latency scales with DB, not list length.
    - Items not found in the catalogue are returned with ``found: false``.

    Typical use-case: a point-of-sale scanner sends a batch of scanned barcodes
    and receives stock levels + prices for all of them in one round-trip.

    ```json
    POST /api/v1/inventory/items/lookup/batch
    {
      "barcodes": ["6001234567890", "6009876543210"],
      "skus": ["RICE-50KG", "OIL-5L"]
    }
    ```
    """
    if not body.barcodes and not body.skus:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Provide at least one barcode or SKU.",
        )

    svc = InventoryService(db)
    raw_results = await svc.batch_lookup_items(business_id, body.barcodes, body.skus)

    lookup_results: list[ItemLookupResult] = []
    for r in raw_results:
        item_response = ItemResponse.from_orm_with_flags(r["item"]) if r["item"] else None
        lookup_results.append(
            ItemLookupResult(
                query=r["query"],
                query_type=r["query_type"],
                found=r["found"],
                item=item_response,
                error=r["error"],
            )
        )

    found_count = sum(1 for r in lookup_results if r.found)
    return BatchLookupResponse(
        total_queried=len(lookup_results),
        found=found_count,
        not_found=len(lookup_results) - found_count,
        results=lookup_results,
    )


@router.get("/items/{item_id}", response_model=ItemDetailResponse)
async def get_item(
    item_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> ItemDetailResponse:
    svc = InventoryService(db)
    item_obj, history = await svc.get_item_detail(business_id, item_id)
    response = ItemDetailResponse(
        **ItemResponse.from_orm_with_flags(item_obj).model_dump(),
        stock_history=[],
    )
    response.stock_history = [StockAdjustmentResponse.model_validate(txn) for txn in history]
    return response


@router.patch("/items/{item_id}", response_model=ItemResponse)
async def update_item(
    item_id: UUID,
    body: ItemUpdate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    db: AsyncSession = Depends(get_db),
) -> ItemResponse:
    svc = InventoryService(db)
    item = await svc.update_item(business_id, item_id, user_id, body)
    return ItemResponse.from_orm_with_flags(item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = InventoryService(db)
    await svc.soft_delete_item(business_id, item_id, user_id)


@router.post("/adjust", response_model=StockAdjustmentResponse, status_code=201)
async def adjust_stock(
    body: StockAdjustment,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> StockAdjustmentResponse:
    """Manually adjust stock (purchase, damage, correction)."""
    svc = InventoryService(db)
    txn = await svc.adjust_stock(business_id, user_id, body)
    return StockAdjustmentResponse.model_validate(txn)


@router.get("/categories", response_model=list[CategoryResponse])
async def list_categories(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[CategoryResponse]:
    svc = InventoryService(db)
    cats = await svc.get_categories(business_id)
    return [CategoryResponse.model_validate(c) for c in cats]


@router.post("/categories", response_model=CategoryResponse, status_code=201)
async def create_category(
    body: CategoryCreate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    db: AsyncSession = Depends(get_db),
) -> CategoryResponse:
    svc = InventoryService(db)
    cat = await svc.create_category(business_id, body.name)
    return CategoryResponse.model_validate(cat)


# ── CSV Bulk Import ────────────────────────────────────────────────────────────


@router.post("/import/csv", status_code=200)
async def import_items_csv(
    file: UploadFile,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    _kyc: None = Depends(require_kyc_verified),
    _feat: None = Depends(_require_bulk_csv_import),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Bulk-upsert inventory items from a CSV file.

    Expected CSV columns (header row required):
        name, unit, cost_price, sell_price, category, stock_qty, low_stock_threshold

    - name: required, item display name
    - unit: required (e.g. kg, pieces, bottles)
    - cost_price: required, numeric
    - sell_price: required, numeric
    - category: optional, created automatically if new
    - stock_qty: optional, defaults to 0
    - low_stock_threshold: optional, defaults to 5

    Rows with missing required fields are skipped and reported in errors[].
    Existing items (matched by name, case-insensitive) are updated in place.
    """
    import csv
    import io
    from decimal import Decimal, InvalidOperation

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle BOM from Excel exports
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    required_cols = {"name", "unit", "cost_price", "sell_price"}
    if not reader.fieldnames or not required_cols.issubset(set(reader.fieldnames)):
        raise HTTPException(
            400,
            detail=(
                f"CSV must include columns: {', '.join(sorted(required_cols))}. "
                f"Got: {reader.fieldnames}"
            ),
        )

    svc = InventoryService(db)
    created = updated = 0
    errors: list[dict] = []

    for row_num, row in enumerate(reader, start=2):  # start=2 (row 1 = header)
        try:
            name = (row.get("name") or "").strip()
            unit = (row.get("unit") or "").strip()
            if not name or not unit:
                errors.append({"row": row_num, "error": "name and unit are required"})
                continue

            cost_price = Decimal(str(row.get("cost_price", "0") or "0").strip())
            sell_price = Decimal(str(row.get("sell_price", "0") or "0").strip())
            stock_qty = Decimal(str(row.get("stock_qty", "0") or "0").strip())
            threshold = Decimal(str(row.get("low_stock_threshold", "5") or "5").strip())
            category_name = (row.get("category") or "").strip() or None

            category_id = None
            if category_name:
                cat = await svc.get_or_create_category(business_id, category_name)
                category_id = cat.id

            from sqlalchemy import select as sa_select

            from apps.api.modules.inventory.models import Item

            existing_result = await db.execute(
                sa_select(Item).where(
                    Item.business_id == business_id,
                    Item.name.ilike(name),
                    Item.deleted_at.is_(None),
                )
            )
            existing = existing_result.scalar_one_or_none()

            if existing:
                existing.unit = unit
                existing.cost_price = cost_price
                existing.sell_price = sell_price
                existing.low_stock_threshold = threshold
                if category_id:
                    existing.category_id = category_id
                updated += 1
            else:
                from apps.api.modules.inventory.schemas import ItemCreate

                item_data = ItemCreate(
                    name=name,
                    unit=unit,
                    cost_price=cost_price,
                    sell_price=sell_price,
                    stock_qty=stock_qty,
                    low_stock_threshold=threshold,
                    category_id=category_id,
                )
                await svc.create_item(business_id, user_id, item_data)
                created += 1

        except (InvalidOperation, Exception) as exc:
            errors.append({"row": row_num, "error": str(exc)})

    await db.commit()
    return {
        "created": created,
        "updated": updated,
        "errors": errors,
        "total_processed": created + updated + len(errors),
    }


@router.get("/items/{item_id}/threshold-suggestion")
async def suggest_threshold(
    item_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Suggest a dynamic low-stock threshold for an item based on 30-day sales velocity.

    Formula: threshold = ceil(avg_daily_units_sold * 3)
    This gives roughly 3 days of buffer at average sales pace.
    Returns the current threshold alongside the suggestion.
    """
    import math
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import func
    from sqlalchemy import select as sa_select

    from apps.api.modules.inventory.models import Item, StockTransaction

    item_result = await db.execute(
        sa_select(Item).where(Item.id == item_id, Item.business_id == business_id)
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Item not found")

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    sold_result = await db.execute(
        sa_select(func.coalesce(func.sum(StockTransaction.qty_change), 0)).where(
            StockTransaction.item_id == item_id,
            StockTransaction.business_id == business_id,
            StockTransaction.type == "sale",
            StockTransaction.created_at >= cutoff,
        )
    )
    total_sold_30d = float(sold_result.scalar() or 0)
    avg_daily = total_sold_30d / 30.0
    suggested = max(math.ceil(avg_daily * 3), 1)  # minimum 1 unit

    return {
        "item_id": str(item_id),
        "item_name": item.name,
        "current_threshold": float(item.low_stock_threshold),
        "suggested_threshold": suggested,
        "avg_daily_units_sold_30d": round(avg_daily, 2),
        "basis": "3-day buffer at 30-day average sales velocity",
    }


@router.get("/restock-alerts")
async def restock_alerts(
    days_ahead: int = Query(7, ge=1, le=30, description="Lookahead window in days"),
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Items predicted to need restocking within the lookahead window.

    Uses 30-day average daily sales velocity to project stock depletion.
    Returns items sorted by urgency (critical first).
    """
    from apps.api.modules.analytics.service import AnalyticsService

    svc = AnalyticsService(db)
    alerts = await svc.predictive_restock_alerts(business_id, days_ahead=days_ahead)
    urgency_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(alerts, key=lambda a: urgency_order.get(a["urgency"], 99))
