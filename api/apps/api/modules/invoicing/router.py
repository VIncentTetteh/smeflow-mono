"""Invoicing endpoints."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.database import get_db
from apps.api.core.dependencies import (
    PaginationParams,
    RequireFeature,
    RequireRole,
    get_current_business_id,
    get_current_user_id,
)
from apps.api.core.exceptions import NotFoundError
from apps.api.modules.invoicing.service import InvoicingService
from apps.api.workers.dispatch import enqueue_task

logger = structlog.get_logger()


class InvoiceResponse(BaseModel):
    id: UUID
    sale_id: UUID | None
    original_invoice_id: UUID | None
    invoice_number: str
    type: str
    status: str
    supplier_name: str
    supplier_tin: str | None
    supplier_address: str | None
    customer_name: str | None
    customer_tin: str | None
    customer_phone: str | None
    customer_address: str | None
    subtotal: Decimal
    vat_amount: Decimal
    nhil_amount: Decimal
    getfund_amount: Decimal
    covid_levy: Decimal
    total: Decimal
    qr_payload: str | None
    qr_image_url: str | None
    ghqr_payload: str | None
    ghqr_image_url: str | None
    digital_signature: str | None
    pdf_url: str | None
    verification_id: str | None
    paystack_payment_url: str | None
    issued_at: datetime
    paid_at: datetime | None
    due_date: datetime | None
    amount_paid: Decimal
    balance_due: Decimal
    effective_status: str
    line_items: list["InvoiceLineItemResponse"] = []

    model_config = {"from_attributes": True}


class InvoiceLineItemResponse(BaseModel):
    id: UUID
    description: str
    qty: Decimal
    unit: str | None
    unit_price: Decimal
    line_total: Decimal
    vat_rate: Decimal
    vat_amount: Decimal

    model_config = {"from_attributes": True}


class PaginatedInvoices(BaseModel):
    invoices: list[InvoiceResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


class InvoiceLineItemInput(BaseModel):
    description: str = Field(..., max_length=255)
    qty: Decimal = Field(..., gt=0)
    unit_price: Decimal = Field(..., gt=0)
    unit: str | None = Field(None, max_length=30)


class StandaloneInvoiceCreate(BaseModel):
    """Create a standalone invoice not linked to any sale."""

    supplier_name: str | None = Field(None, max_length=255, description="Defaults to business name")
    supplier_tin: str | None = Field(None, max_length=20)
    supplier_address: str | None = None
    customer_name: str | None = Field(None, max_length=255)
    customer_tin: str | None = Field(None, max_length=20)
    customer_phone: str | None = Field(None, max_length=20)
    customer_address: str | None = None
    invoice_type: str = Field("invoice", pattern="^(invoice|proforma|debit_note)$")
    line_items: list[InvoiceLineItemInput] = Field(..., min_length=1)


class DebitNoteCreate(BaseModel):
    """Create a debit note linked to an immutable invoice."""

    line_items: list[InvoiceLineItemInput] = Field(..., min_length=1)


router = APIRouter()


@router.get("", response_model=PaginatedInvoices)
async def list_invoices(
    business_id: UUID = Depends(get_current_business_id),
    status: str | None = Query(None, description="Filter by status: draft|issued|paid|cancelled"),
    invoice_type: str | None = Query(
        None, description="Filter by type: invoice|receipt|credit_note"
    ),
    from_date: str | None = Query(None, description="ISO-8601 start date"),
    to_date: str | None = Query(None, description="ISO-8601 end date"),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
) -> PaginatedInvoices:
    """List invoices for the current business with optional filters and pagination."""
    svc = InvoicingService(db)
    invoices, total = await svc.list_invoices(
        business_id, status, invoice_type, from_date, to_date, pagination.limit, pagination.offset
    )
    return PaginatedInvoices(
        invoices=[InvoiceResponse.model_validate(inv) for inv in invoices],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
        has_more=(pagination.offset + pagination.limit) < total,
    )


@router.post("/generate", response_model=InvoiceResponse, status_code=201)
async def generate_invoice(
    body: StandaloneInvoiceCreate,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> InvoiceResponse:
    """
    Generate a standalone GRA e-VAT compliant invoice not linked to a sale.
    Useful for B2B billing, proforma invoices, and manual adjustments.
    """
    svc = InvoicingService(db)
    invoice = await svc.generate_standalone(
        business_id=business_id,
        supplier_name=body.supplier_name or "",
        supplier_tin=body.supplier_tin,
        supplier_address=body.supplier_address,
        customer_name=body.customer_name,
        customer_tin=body.customer_tin,
        customer_phone=body.customer_phone,
        customer_address=body.customer_address,
        line_items=[item.model_dump() for item in body.line_items],
        invoice_type=body.invoice_type,
    )
    await db.commit()
    invoice = await svc.get_invoice(business_id, invoice.id)
    return InvoiceResponse.model_validate(invoice)


@router.get("/by-sale/{sale_id}", response_model=InvoiceResponse)
async def get_invoice_by_sale(
    sale_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> InvoiceResponse:
    """Fetch the generated receipt/invoice for a sale so mobile can poll after checkout."""
    svc = InvoicingService(db)
    invoice = await svc.get_invoice_by_sale(business_id, sale_id)
    return InvoiceResponse.model_validate(invoice)


@router.post("/{invoice_id}/void", response_model=InvoiceResponse, status_code=200)
async def void_invoice(
    invoice_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> InvoiceResponse:
    """
    Void an issued invoice and issue a balancing credit note.
    Returns the voided invoice; the credit note is created as a side-effect.
    """
    svc = InvoicingService(db)
    invoice = await svc.void_invoice(business_id, invoice_id, user_id)
    await db.commit()
    invoice = await svc.get_invoice(business_id, invoice.id)
    return InvoiceResponse.model_validate(invoice)


@router.post("/{invoice_id}/debit-note", response_model=InvoiceResponse, status_code=201)
async def create_debit_note(
    invoice_id: UUID,
    body: DebitNoteCreate,
    business_id: UUID = Depends(get_current_business_id),
    _role: str = Depends(RequireRole("owner", "manager")),
    db: AsyncSession = Depends(get_db),
) -> InvoiceResponse:
    """Issue a linked debit note instead of mutating an already issued invoice."""
    svc = InvoicingService(db)
    note = await svc.create_debit_note(
        business_id=business_id,
        invoice_id=invoice_id,
        line_items=[item.model_dump() for item in body.line_items],
    )
    await db.commit()
    note = await svc.get_invoice(business_id, note.id)
    return InvoiceResponse.model_validate(note)


@router.get("/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(
    invoice_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> InvoiceResponse:
    svc = InvoicingService(db)
    invoice = await svc.get_invoice(business_id, invoice_id)
    return InvoiceResponse.model_validate(invoice)


@router.get("/{invoice_id}/pdf")
async def get_invoice_pdf(
    invoice_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    _feat: None = Depends(RequireFeature("invoice_pdf")),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Redirect to the S3-hosted PDF for this invoice."""
    svc = InvoicingService(db)
    invoice = await svc.get_invoice(business_id, invoice_id)
    if not invoice.pdf_url:
        raise NotFoundError("Invoice PDF", str(invoice_id))
    return RedirectResponse(url=invoice.pdf_url)


@router.post("/{invoice_id}/send", status_code=200)
async def resend_invoice(
    invoice_id: UUID,
    business_id: UUID = Depends(get_current_business_id),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Queue an invoice customer message and return its truthful initial state."""
    svc = InvoicingService(db)
    invoice = await svc.get_invoice(business_id, invoice_id)
    from apps.api.modules.notifications.delivery_service import CustomerDeliveryService

    body = f"Invoice #{invoice.invoice_number} for GHS {invoice.total} is ready."
    if invoice.pdf_url:
        body = f"{body} {invoice.pdf_url}"
    message = await CustomerDeliveryService(db).create_message(
        business_id=business_id,
        message_type="invoice",
        recipient_phone=invoice.customer_phone,
        body=body,
        preferred_channel="whatsapp",
        idempotency_key=f"invoice:{invoice.id}:manual:{uuid4()}",
        consent_status="not_required",
        related_resource_type="invoice",
        related_resource_id=str(invoice.id),
    )
    if message.status == "skipped":
        return {
            "message": "Invoice was not queued because the customer has no valid phone number.",
            "status": "skipped",
            "message_id": str(message.id),
        }
    try:
        from apps.api.workers.tasks.notification_tasks import deliver_customer_message

        enqueue_task(deliver_customer_message, str(message.id))
    except Exception as e:
        logger.warning("invoice.send_queue_failed", invoice_id=str(invoice.id), error=str(e))
        return {
            "message": "Invoice delivery could not be queued. Try again.",
            "status": "failed",
            "message_id": str(message.id),
        }
    return {
        "message": "Invoice delivery queued.",
        "status": "queued",
        "message_id": str(message.id),
    }
