"""Inventory service — item management + atomic stock adjustments."""

from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.audit import audit
from apps.api.core.exceptions import (
    InsufficientStockError,
    LimitExceededError,
    NotFoundError,
    TenantMismatchError,
)
from apps.api.modules.inventory.models import Item, ItemCategory, StockTransaction
from apps.api.modules.inventory.schemas import ItemCreate, ItemUpdate, StockAdjustment
from apps.api.workers.dispatch import enqueue_task

logger = structlog.get_logger()


class InventoryService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Items ──────────────────────────────────────────────────────────────────
    async def create_item(self, business_id: UUID, user_id: UUID, data: ItemCreate) -> Item:
        from apps.api.modules.billing.models import PLANS
        from apps.api.modules.billing.service import BillingService

        billing = BillingService(self.db)
        item_count = await self.db.scalar(
            select(func.count(Item.id)).where(
                Item.business_id == business_id,
                Item.deleted_at.is_(None),
            )
        )
        if not await billing.check_limit(business_id, "items", item_count or 0):
            sub = await billing.get_subscription(business_id)
            limit = PLANS.get(sub.plan, PLANS["free"]).get("items", 0)
            raise LimitExceededError("inventory items", limit)

        item = Item(
            business_id=business_id,
            name=data.name,
            unit=data.unit,
            cost_price=data.cost_price,
            sell_price=data.sell_price,
            current_stock=data.initial_stock,
            low_stock_threshold=data.low_stock_threshold,
            category_id=data.category_id,
            sku=data.sku,
            barcode=data.barcode,
        )
        self.db.add(item)
        await self.db.flush([item])

        # Record initial stock as a StockTransaction
        if data.initial_stock > 0:
            txn = StockTransaction(
                business_id=business_id,
                item_id=item.id,
                type="adjustment",
                qty_change=data.initial_stock,
                qty_before=Decimal("0"),
                qty_after=data.initial_stock,
                notes="Initial stock",
                recorded_by=user_id,
            )
            self.db.add(txn)

        await audit(
            self.db,
            "inventory.item.create",
            "Item",
            item.id,
            user_id,
            business_id,
            after={"name": item.name, "sell_price": str(item.sell_price)},
        )
        logger.info("inventory.item.created", business_id=str(business_id), item_id=str(item.id))
        return item

    async def update_item(
        self, business_id: UUID, item_id: UUID, user_id: UUID, data: ItemUpdate
    ) -> Item:
        item = await self._get_item(business_id, item_id)
        before = {"sell_price": str(item.sell_price), "name": item.name}
        for k, v in data.model_dump(exclude_none=True).items():
            setattr(item, k, v)
        await self.db.flush([item])
        await self.db.refresh(item)
        after = {"sell_price": str(item.sell_price), "name": item.name}
        await audit(
            self.db, "inventory.item.update", "Item", item.id, user_id, business_id, before, after
        )
        return item

    async def soft_delete_item(self, business_id: UUID, item_id: UUID, user_id: UUID) -> None:
        from datetime import datetime, timezone

        item = await self._get_item(business_id, item_id)
        item.deleted_at = datetime.now(timezone.utc)
        item.is_active = False
        await self.db.flush([item])
        await audit(self.db, "inventory.item.delete", "Item", item.id, user_id, business_id)

    async def get_items(
        self,
        business_id: UUID,
        search: str | None = None,
        low_stock_only: bool = False,
        category_id: UUID | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[Item], int]:
        q = select(Item).where(Item.business_id == business_id, Item.deleted_at.is_(None))
        if search:
            q = q.where(Item.name.ilike(f"%{search}%"))
        if low_stock_only:
            q = q.where(Item.current_stock <= Item.low_stock_threshold)
        if category_id:
            q = q.where(Item.category_id == category_id)

        count_result = await self.db.execute(select(func.count()).select_from(q.subquery()))
        total = count_result.scalar() or 0

        q = q.order_by(Item.name).limit(limit).offset(offset)
        result = await self.db.execute(q)
        return list(result.scalars().all()), total

    async def get_item_detail(
        self,
        business_id: UUID,
        item_id: UUID,
        history_limit: int = 50,
    ) -> tuple[Item, list[StockTransaction]]:
        """Return an item and its latest stock transactions for the detail view."""
        item = await self._get_item(business_id, item_id)
        history_result = await self.db.execute(
            select(StockTransaction)
            .where(
                StockTransaction.business_id == business_id,
                StockTransaction.item_id == item.id,
            )
            .order_by(StockTransaction.created_at.desc())
            .limit(history_limit)
        )
        return item, list(history_result.scalars().all())

    # ── Stock Adjustments ──────────────────────────────────────────────────────
    async def adjust_stock(
        self, business_id: UUID, user_id: UUID, data: StockAdjustment
    ) -> StockTransaction:
        """Atomically adjust stock for an item. Raises InsufficientStockError if going negative."""
        item = await self._get_item(business_id, data.item_id)

        new_stock = item.current_stock + data.qty_change
        if new_stock < 0:
            raise InsufficientStockError(
                item.name, float(item.current_stock), abs(float(data.qty_change))
            )

        txn = StockTransaction(
            business_id=business_id,
            item_id=item.id,
            type=data.reason,
            qty_change=data.qty_change,
            qty_before=item.current_stock,
            qty_after=new_stock,
            unit_cost=data.unit_cost,
            notes=data.notes,
            recorded_by=user_id,
            client_created_at=data.client_created_at,
        )
        item.current_stock = new_stock
        self.db.add(txn)
        await self.db.flush([item, txn])

        # Emit low-stock event if threshold crossed
        if new_stock <= item.low_stock_threshold and data.qty_change < 0:
            await self._emit_low_stock_event(business_id, item)

        logger.info(
            "inventory.stock.adjusted",
            item_id=str(item.id),
            qty_change=str(data.qty_change),
            new_stock=str(new_stock),
        )
        return txn

    async def deduct_stock_for_sale(
        self,
        business_id: UUID,
        item_id: UUID,
        qty: Decimal,
        sale_id: UUID,
        user_id: UUID,
    ) -> StockTransaction:
        """Called from SalesService — deduct stock and link to sale."""
        item = await self._get_item(business_id, item_id)
        if item.current_stock < qty:
            raise InsufficientStockError(item.name, float(item.current_stock), float(qty))

        txn = StockTransaction(
            business_id=business_id,
            item_id=item.id,
            type="sale",
            qty_change=-qty,
            qty_before=item.current_stock,
            qty_after=item.current_stock - qty,
            reference_id=sale_id,
            reference_type="sale",
            recorded_by=user_id,
        )
        item.current_stock -= qty
        self.db.add(txn)
        await self.db.flush([item, txn])

        if item.current_stock <= item.low_stock_threshold:
            await self._emit_low_stock_event(business_id, item)
        return txn

    async def bulk_create_items(self, business_id: UUID, user_id: UUID, items_data: list) -> dict:
        """
        Import multiple items synchronously.
        Returns a summary dict with created/failed counts and any per-row errors.
        """
        from apps.api.modules.inventory.schemas import ItemCreate

        created = 0
        failed = 0
        errors: list[dict] = []

        for idx, item_data in enumerate(items_data):
            try:
                if not isinstance(item_data, ItemCreate):
                    item_data = ItemCreate.model_validate(item_data)
                await self.create_item(business_id, user_id, item_data)
                created += 1
            except Exception as exc:
                failed += 1
                errors.append(
                    {"row": idx + 1, "name": getattr(item_data, "name", "?"), "error": str(exc)}
                )

        return {
            "total": len(items_data),
            "created": created,
            "failed": failed,
            "errors": errors,
            "job_id": None,
        }

    async def find_item_by_lookup(
        self,
        business_id: UUID,
        barcode: str | None = None,
        sku: str | None = None,
    ) -> Item:
        """Return an item by barcode or SKU for barcode/QR checkout lookups."""
        if barcode is None and sku is None:
            raise ValueError("barcode or sku is required")

        query = select(Item).where(Item.business_id == business_id, Item.deleted_at.is_(None))
        if barcode is not None:
            query = query.where(Item.barcode == barcode)
        elif sku is not None:
            query = query.where(Item.sku == sku)

        result = await self.db.execute(query)
        item = result.scalar_one_or_none()
        if item is None:
            raise NotFoundError("Item", barcode or sku or "unknown")
        return item

    async def batch_lookup_items(
        self,
        business_id: UUID,
        barcodes: list[str],
        skus: list[str],
    ) -> list[dict]:
        """
        Bulk barcode/SKU lookup — single DB query per lookup type.

        Returns a list of result dicts matching the ``ItemLookupResult`` schema.
        Uses IN queries so the total number of DB round-trips is at most 2
        (one for barcodes, one for SKUs), regardless of how many codes are sent.
        """
        results: list[dict] = []

        if barcodes:
            bcode_rows = (
                (
                    await self.db.execute(
                        select(Item).where(
                            Item.business_id == business_id,
                            Item.barcode.in_(barcodes),
                            Item.deleted_at.is_(None),
                        )
                    )
                )
                .scalars()
                .all()
            )
            found_map = {item.barcode: item for item in bcode_rows if item.barcode}

            for bc in barcodes:
                item = found_map.get(bc)
                results.append(
                    {
                        "query": bc,
                        "query_type": "barcode",
                        "found": item is not None,
                        "item": item,
                        "error": None if item else "not_found",
                    }
                )

        if skus:
            sku_rows = (
                (
                    await self.db.execute(
                        select(Item).where(
                            Item.business_id == business_id,
                            Item.sku.in_(skus),
                            Item.deleted_at.is_(None),
                        )
                    )
                )
                .scalars()
                .all()
            )
            found_map = {item.sku: item for item in sku_rows if item.sku}

            for sku in skus:
                item = found_map.get(sku)
                results.append(
                    {
                        "query": sku,
                        "query_type": "sku",
                        "found": item is not None,
                        "item": item,
                        "error": None if item else "not_found",
                    }
                )

        return results

    # ── Categories ─────────────────────────────────────────────────────────────
    async def create_category(self, business_id: UUID, name: str) -> ItemCategory:
        """
        Get-or-create a category by name within a business.
        ON CONFLICT (business_id, name) DO NOTHING means concurrent calls for
        the same name return the existing row rather than raising an IntegrityError.
        """
        existing = (
            await self.db.execute(
                select(ItemCategory).where(
                    ItemCategory.business_id == business_id,
                    ItemCategory.name == name,
                )
            )
        ).scalar_one_or_none()
        if existing:
            return existing

        from apps.api.modules.billing.models import PLANS
        from apps.api.modules.billing.service import BillingService

        billing = BillingService(self.db)
        category_count = (
            await self.db.execute(
                select(func.count(ItemCategory.id)).where(ItemCategory.business_id == business_id)
            )
        ).scalar_one()
        if not await billing.check_limit(business_id, "item_categories", category_count or 0):
            sub = await billing.get_subscription(business_id)
            limit = PLANS.get(sub.plan, PLANS["free"]).get("item_categories", 0)
            raise LimitExceededError("item categories", limit)

        stmt = (
            pg_insert(ItemCategory)
            .values(business_id=business_id, name=name)
            .on_conflict_do_nothing(index_elements=["business_id", "name"])
            .returning(ItemCategory)
        )
        result = await self.db.execute(stmt)
        cat = result.scalar_one_or_none()
        if cat is None:
            # Row already existed before this insert
            result = await self.db.execute(
                select(ItemCategory).where(
                    ItemCategory.business_id == business_id,
                    ItemCategory.name == name,
                )
            )
            cat = result.scalar_one()
        return cat

    async def get_or_create_category(self, business_id: UUID, name: str) -> ItemCategory:
        """Alias for create_category — used by CSV import for readability."""
        return await self.create_category(business_id, name)

    async def get_categories(self, business_id: UUID) -> list[ItemCategory]:
        result = await self.db.execute(
            select(ItemCategory).where(ItemCategory.business_id == business_id)
        )
        return list(result.scalars().all())

    # ── Internals ──────────────────────────────────────────────────────────────
    async def _get_item(self, business_id: UUID, item_id: UUID) -> Item:
        result = await self.db.execute(
            select(Item).where(Item.id == item_id, Item.deleted_at.is_(None))
        )
        item = result.scalar_one_or_none()
        if not item:
            raise NotFoundError("Item", str(item_id))
        if item.business_id != business_id:
            raise TenantMismatchError()
        return item

    async def _emit_low_stock_event(self, business_id: UUID, item: Item) -> None:
        """Queue a low-stock notification (Celery task)."""
        try:
            from apps.api.workers.tasks.inventory_tasks import notify_low_stock

            enqueue_task(
                notify_low_stock,
                str(business_id),
                str(item.id),
                str(item.name),
                float(item.current_stock),
            )
        except Exception as e:
            logger.warning("inventory.low_stock.event_failed", error=str(e))
