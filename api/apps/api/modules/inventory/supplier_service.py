"""Supplier and Purchase Order service."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.api.core.exceptions import ConflictError, NotFoundError
from apps.api.modules.inventory.supplier_models import (
    PurchaseOrder,
    PurchaseOrderItem,
    Supplier,
)

logger = structlog.get_logger()


class SupplierService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Suppliers ──────────────────────────────────────────────────────────────

    async def create_supplier(self, business_id: UUID, **fields) -> Supplier:
        supplier = Supplier(business_id=business_id, **fields)
        self.db.add(supplier)
        await self.db.flush([supplier])
        logger.info("supplier.created", supplier_id=str(supplier.id))
        return supplier

    async def list_suppliers(self, business_id: UUID) -> list[Supplier]:
        result = await self.db.execute(
            select(Supplier)
            .where(Supplier.business_id == business_id, Supplier.is_active.is_(True))
            .order_by(Supplier.name)
        )
        return list(result.scalars().all())

    async def get_supplier(self, business_id: UUID, supplier_id: UUID) -> Supplier:
        result = await self.db.execute(
            select(Supplier).where(Supplier.id == supplier_id, Supplier.business_id == business_id)
        )
        supplier = result.scalar_one_or_none()
        if not supplier:
            raise NotFoundError("Supplier", str(supplier_id))
        return supplier

    async def update_supplier(self, business_id: UUID, supplier_id: UUID, **fields) -> Supplier:
        supplier = await self.get_supplier(business_id, supplier_id)
        for k, v in fields.items():
            if v is not None:
                setattr(supplier, k, v)
        await self.db.flush([supplier])
        return supplier

    async def deactivate_supplier(self, business_id: UUID, supplier_id: UUID) -> None:
        supplier = await self.get_supplier(business_id, supplier_id)
        supplier.is_active = False
        await self.db.flush([supplier])

    # ── Purchase Orders ────────────────────────────────────────────────────────

    async def create_purchase_order(
        self,
        business_id: UUID,
        user_id: UUID,
        supplier_id: UUID | None,
        line_items: list[dict],
        notes: str | None = None,
        expected_date: datetime | None = None,
    ) -> PurchaseOrder:
        """Create a draft purchase order with line items.

        line_items: [{"item_id": UUID|None, "description": str, "qty_ordered": Decimal,
                       "unit_cost": Decimal}]
        """
        # Validate supplier belongs to this business
        if supplier_id:
            await self.get_supplier(business_id, supplier_id)

        po_number = await self._next_po_number(business_id)

        subtotal = sum(
            Decimal(str(li["qty_ordered"])) * Decimal(str(li["unit_cost"])) for li in line_items
        )
        total = subtotal  # Input VAT is handled separately if tracked

        po = PurchaseOrder(
            business_id=business_id,
            supplier_id=supplier_id,
            po_number=po_number,
            status="draft",
            order_date=datetime.now(timezone.utc),
            expected_date=expected_date,
            subtotal=subtotal,
            total=total,
            notes=notes,
            created_by=user_id,
        )
        self.db.add(po)
        await self.db.flush([po])

        for li in line_items:
            qty = Decimal(str(li["qty_ordered"]))
            cost = Decimal(str(li["unit_cost"]))
            poi = PurchaseOrderItem(
                purchase_order=po,
                item_id=li.get("item_id"),
                description=li["description"],
                qty_ordered=qty,
                unit_cost=cost,
                line_total=(qty * cost).quantize(Decimal("0.01")),
            )
            self.db.add(poi)

        await self.db.flush()
        result = await self.db.execute(
            select(PurchaseOrder)
            .where(PurchaseOrder.id == po.id)
            .options(selectinload(PurchaseOrder.line_items), selectinload(PurchaseOrder.supplier))
        )
        loaded_po = result.scalar_one()
        logger.info("purchase_order.created", po_id=str(loaded_po.id), po_number=po_number)
        return loaded_po

    async def receive_purchase_order(
        self,
        business_id: UUID,
        po_id: UUID,
        user_id: UUID,
        receipts: list[dict],  # [{"line_item_id": UUID, "qty_received": Decimal}]
    ) -> PurchaseOrder:
        """Mark items received on a PO and update stock levels.

        Partial receipt is supported — call again for remaining lines.
        Status transitions: draft/ordered → partially_received or received.
        """
        from apps.api.modules.inventory.service import InventoryService

        result = await self.db.execute(
            select(PurchaseOrder)
            .where(PurchaseOrder.id == po_id, PurchaseOrder.business_id == business_id)
            .options(selectinload(PurchaseOrder.line_items))
        )
        po = result.scalar_one_or_none()
        if not po:
            raise NotFoundError("PurchaseOrder", str(po_id))
        if po.status == "cancelled":
            raise ConflictError("Cannot receive a cancelled purchase order")

        inv_svc = InventoryService(self.db)
        receipt_map = {str(r["line_item_id"]): Decimal(str(r["qty_received"])) for r in receipts}

        for line in po.line_items:
            qty_in = receipt_map.get(str(line.id))
            if not receipt_map:
                qty_in = line.qty_ordered - (line.qty_received or Decimal("0"))
            if not qty_in or qty_in <= 0:
                continue
            line.qty_received = min((line.qty_received or Decimal("0")) + qty_in, line.qty_ordered)
            # Credit stock if item is linked
            if line.item_id:
                adj = type(
                    "Adj",
                    (),
                    {
                        "item_id": line.item_id,
                        "qty_change": qty_in,
                        "reason": "purchase",
                        "unit_cost": line.unit_cost,
                        "notes": f"PO {po.po_number} receipt",
                        "client_created_at": None,
                    },
                )()
                await inv_svc.adjust_stock(business_id, user_id, adj)

        # Update PO status
        all_received = all(
            (li.qty_received or Decimal("0")) >= li.qty_ordered for li in po.line_items
        )
        po.status = "received" if all_received else "partially_received"
        if all_received:
            po.received_at = datetime.now(timezone.utc)

        await self.db.flush([po])
        return po

    async def list_purchase_orders(
        self, business_id: UUID, status: str | None = None, limit: int = 50, offset: int = 0
    ) -> tuple[list[PurchaseOrder], int]:
        q = select(PurchaseOrder).where(PurchaseOrder.business_id == business_id)
        count_q = select(func.count(PurchaseOrder.id)).where(
            PurchaseOrder.business_id == business_id
        )
        if status:
            q = q.where(PurchaseOrder.status == status)
            count_q = count_q.where(PurchaseOrder.status == status)
        q = (
            q.options(selectinload(PurchaseOrder.line_items), selectinload(PurchaseOrder.supplier))
            .order_by(PurchaseOrder.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = (await self.db.execute(q)).scalars().all()
        total = (await self.db.execute(count_q)).scalar_one()
        return list(rows), total

    async def _next_po_number(self, business_id: UUID) -> str:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        prefix = f"PO-{now.strftime('%Y%m')}"
        count_result = await self.db.execute(
            select(func.count(PurchaseOrder.id)).where(
                PurchaseOrder.business_id == business_id,
                PurchaseOrder.po_number.like(f"{prefix}%"),
            )
        )
        seq = (count_result.scalar() or 0) + 1
        return f"{prefix}-{seq:04d}"
