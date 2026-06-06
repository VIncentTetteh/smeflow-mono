"""Supplier and Purchase Order endpoints."""

from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import RequireRole, get_current_business_id, get_current_user_id
from apps.api.modules.inventory.models import Item
from apps.api.modules.inventory.supplier_service import SupplierService

router = APIRouter()


class SupplierCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    tin: str | None = None
    notes: str | None = None


class POLineItemIn(BaseModel):
    item_id: UUID | None = None
    description: str | None = None
    qty_ordered: Decimal | None = Field(None, gt=0)
    unit_cost: Decimal | None = Field(None, gt=0)
    qty: Decimal | None = Field(None, gt=0)
    cost_price: Decimal | None = Field(None, gt=0)


class PurchaseOrderCreate(BaseModel):
    supplier_id: UUID | None = None
    line_items: list[POLineItemIn] = Field(..., min_length=1)
    notes: str | None = None
    expected_date: datetime | date | None = None
    expected_delivery_date: datetime | date | None = None
    reference_number: str | None = None
    payment_terms: str | None = None


class POReceiptLine(BaseModel):
    line_item_id: UUID
    qty_received: Decimal = Field(..., gt=0)


class POReceive(BaseModel):
    receipts: list[POReceiptLine] = Field(default_factory=list)


def _serialize_supplier(supplier) -> dict:
    return {
        "id": str(supplier.id),
        "name": supplier.name,
        "phone": supplier.phone,
        "email": supplier.email,
        "address": supplier.address,
        "tin": supplier.tin,
        "created_at": supplier.created_at.isoformat() if supplier.created_at else None,
    }


def _serialize_po(po) -> dict:
    supplier = po.__dict__.get("supplier")
    line_items = po.__dict__.get("line_items", []) or []
    return {
        "id": str(po.id),
        "po_number": po.po_number,
        "supplier_id": str(po.supplier_id) if po.supplier_id else None,
        "supplier_name": supplier.name if supplier else None,
        "status": po.status,
        "total": float(po.total or 0),
        "expected_delivery_date": po.expected_date.date().isoformat() if po.expected_date else None,
        "notes": po.notes,
        "line_items": [
            {
                "id": str(li.id),
                "item_id": str(li.item_id) if li.item_id else None,
                "name": li.description,
                "qty": float(li.qty_ordered),
                "qty_received": float(li.qty_received or 0),
                "cost_price": float(li.unit_cost),
            }
            for li in line_items
        ],
        "created_at": po.created_at.isoformat() if po.created_at else None,
        "received_at": po.received_at.isoformat() if po.received_at else None,
    }


def _as_datetime(value: datetime | date | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.combine(value, time.min)


async def _normalize_line_items(
    db: AsyncSession,
    business_id: UUID,
    line_items: list[POLineItemIn],
) -> list[dict]:
    normalized: list[dict] = []
    for line in line_items:
        qty_ordered = line.qty_ordered if line.qty_ordered is not None else line.qty
        unit_cost = line.unit_cost if line.unit_cost is not None else line.cost_price
        if qty_ordered is None or unit_cost is None:
            raise HTTPException(
                status_code=422,
                detail="Each line item must include qty/cost_price or qty_ordered/unit_cost.",
            )

        description = line.description
        if not description and line.item_id:
            item = await db.get(Item, line.item_id)
            if item and item.business_id == business_id:
                description = item.name
        if not description:
            description = "Inventory item"

        normalized.append(
            {
                "item_id": line.item_id,
                "description": description,
                "qty_ordered": qty_ordered,
                "unit_cost": unit_cost,
            }
        )
    return normalized


# ── Supplier endpoints ────────────────────────────────────────────────────────


@router.post("/suppliers", status_code=201)
async def create_supplier(
    body: SupplierCreate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = SupplierService(db)
    supplier = await svc.create_supplier(business_id, **body.model_dump(exclude_none=True))
    await db.commit()
    return _serialize_supplier(supplier)


@router.get("/suppliers")
async def list_suppliers(
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    svc = SupplierService(db)
    suppliers = await svc.list_suppliers(business_id)
    return [_serialize_supplier(s) for s in suppliers]


@router.patch("/suppliers/{supplier_id}")
async def update_supplier(
    supplier_id: UUID,
    body: SupplierCreate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = SupplierService(db)
    supplier = await svc.update_supplier(
        business_id, supplier_id, **body.model_dump(exclude_none=True)
    )
    await db.commit()
    return _serialize_supplier(supplier)


@router.delete("/suppliers/{supplier_id}", status_code=204)
async def deactivate_supplier(
    supplier_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = SupplierService(db)
    await svc.deactivate_supplier(business_id, supplier_id)
    await db.commit()


# ── Purchase Order endpoints ──────────────────────────────────────────────────


@router.post("/purchase-orders", status_code=201)
async def create_purchase_order(
    body: PurchaseOrderCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = SupplierService(db)
    line_items = await _normalize_line_items(db, business_id, body.line_items)
    po = await svc.create_purchase_order(
        business_id=business_id,
        user_id=user_id,
        supplier_id=body.supplier_id,
        line_items=line_items,
        notes=body.notes,
        expected_date=_as_datetime(body.expected_date or body.expected_delivery_date),
    )
    await db.commit()
    return _serialize_po(po)


@router.get("/purchase-orders")
async def list_purchase_orders(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = SupplierService(db)
    orders, total = await svc.list_purchase_orders(business_id, status, limit, offset)
    return {
        "total": total,
        "items": [
            {
                **_serialize_po(po),
            }
            for po in orders
        ],
    }


@router.post("/purchase-orders/{po_id}/receive", status_code=200)
async def receive_purchase_order(
    po_id: UUID,
    body: POReceive | None = None,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark lines as received on a PO — automatically credits inventory stock."""
    svc = SupplierService(db)
    po = await svc.receive_purchase_order(
        business_id=business_id,
        po_id=po_id,
        user_id=user_id,
        receipts=[r.model_dump() for r in (body.receipts if body else [])],
    )
    await db.commit()
    return _serialize_po(po)
