"""Celery tasks for invoice generation and delivery."""

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()


@celery.task(bind=True, max_retries=3, default_retry_delay=10)
def generate_invoice_for_sale(self, sale_id: str, business_id: str) -> str:
    """Generate a GRA e-VAT invoice from a completed sale."""
    import asyncio
    from uuid import UUID

    from apps.api.core.database import AsyncSessionLocal
    from apps.api.modules.invoicing.service import InvoicingService

    async def _run() -> str:
        async with AsyncSessionLocal() as db:
            svc = InvoicingService(db)
            invoice = await svc.generate_from_sale(UUID(sale_id), UUID(business_id))
            await db.commit()
            return str(invoice.id)

    try:
        invoice_id = asyncio.run(_run())
        logger.info("task.invoice_generated", invoice_id=invoice_id)
        return invoice_id
    except Exception as exc:
        logger.error("task.invoice_generation_failed", sale_id=sale_id, error=str(exc))
        raise self.retry(exc=exc) from exc


@celery.task(bind=True, max_retries=3)
def generate_invoice_assets(self, invoice_id: str) -> None:
    """Generate QR image, GhQR, and PDF for an invoice. Upload to S3."""
    import asyncio
    from uuid import UUID

    async def _run() -> None:
        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.invoicing.models import Invoice
        from libs.qr_generator.ghqr import generate_qr_image_bytes

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Invoice).where(Invoice.id == UUID(invoice_id)))
            invoice = result.scalar_one_or_none()
            if not invoice or not invoice.qr_payload:
                return

            # 1. GRA QR image
            qr_bytes = generate_qr_image_bytes(invoice.qr_payload)
            qr_url = await _upload_to_s3(qr_bytes, f"invoices/{invoice_id}/qr.png", "image/png")
            invoice.qr_image_url = qr_url

            # 2. GhQR image (if payload exists)
            if invoice.ghqr_payload:
                ghqr_bytes = generate_qr_image_bytes(invoice.ghqr_payload)
                ghqr_url = await _upload_to_s3(
                    ghqr_bytes, f"invoices/{invoice_id}/ghqr.png", "image/png"
                )
                invoice.ghqr_image_url = ghqr_url

            # 3. PDF
            pdf_bytes = _build_invoice_pdf(invoice)
            pdf_url = await _upload_to_s3(
                pdf_bytes,
                f"invoices/{invoice_id}/invoice.pdf",
                "application/pdf",
            )
            invoice.pdf_url = pdf_url

            await db.commit()
            logger.info("task.invoice_assets_generated", invoice_id=invoice_id)

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("task.invoice_assets_failed", invoice_id=invoice_id, error=str(exc))
        raise self.retry(exc=exc) from exc


@celery.task(bind=True, max_retries=2)
def send_invoice_to_customer(self, invoice_id: str) -> None:
    """Send invoice PDF via WhatsApp to customer (if phone available)."""
    import asyncio
    from uuid import UUID

    async def _run() -> None:
        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.invoicing.models import Invoice
        from apps.api.modules.sales.models import Customer, Sale
        from apps.api.workers.tasks.notification_tasks import send_notification

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Invoice).where(Invoice.id == UUID(invoice_id)))
            invoice = result.scalar_one_or_none()
            if not invoice:
                return

            customer_phone = invoice.customer_phone
            if not customer_phone and invoice.sale_id:
                sale_result = await db.execute(select(Sale).where(Sale.id == invoice.sale_id))
                sale = sale_result.scalar_one_or_none()
                if sale and sale.customer_id:
                    customer_result = await db.execute(
                        select(Customer).where(Customer.id == sale.customer_id)
                    )
                    customer = customer_result.scalar_one_or_none()
                    customer_phone = customer.phone if customer else None

            if not customer_phone:
                logger.info("task.send_invoice.skipped_no_customer_phone", invoice_id=invoice_id)
                return

            send_notification.delay(
                business_id=str(invoice.business_id),
                event_type="invoice.sent",
                data={
                    "invoice_number": invoice.invoice_number,
                    "total": str(invoice.total),
                    "pdf_url": invoice.pdf_url or "",
                    "phone": customer_phone,
                },
            )
            logger.info("task.send_invoice.queued", invoice_id=invoice_id)

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("task.send_invoice.failed", invoice_id=invoice_id, error=str(exc))
        raise self.retry(exc=exc) from exc


def _build_invoice_pdf(invoice: object) -> bytes:
    """Build a compact invoice PDF for customer delivery."""
    import io

    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    y = height - 72

    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(72, y, "SME Flow Invoice")
    y -= 32

    pdf.setFont("Helvetica", 10)
    rows = [
        ("Invoice #", getattr(invoice, "invoice_number", "")),
        ("Status", getattr(invoice, "status", "")),
        ("Supplier", getattr(invoice, "supplier_name", "")),
        ("Supplier TIN", getattr(invoice, "supplier_tin", "") or "N/A"),
        ("Customer", getattr(invoice, "customer_name", "") or "Walk-in customer"),
        (
            "Due date",
            getattr(invoice, "due_date", None).date().isoformat()
            if getattr(invoice, "due_date", None)
            else "N/A",
        ),
        ("Verification ID", getattr(invoice, "verification_id", "") or "N/A"),
    ]
    for label, value in rows:
        pdf.drawString(72, y, f"{label}: {value}")
        y -= 16

    y -= 12
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(72, y, "Tax Summary")
    y -= 18
    pdf.setFont("Helvetica", 10)
    money_rows = [
        ("Subtotal", getattr(invoice, "subtotal", 0)),
        ("VAT", getattr(invoice, "vat_amount", 0)),
        ("NHIL", getattr(invoice, "nhil_amount", 0)),
        ("GETFund", getattr(invoice, "getfund_amount", 0)),
        ("COVID Levy", getattr(invoice, "covid_levy", 0)),
        ("Total", getattr(invoice, "total", 0)),
        ("Amount paid", getattr(invoice, "amount_paid", 0)),
        ("Balance due", getattr(invoice, "balance_due", 0)),
    ]
    for label, value in money_rows:
        pdf.drawString(72, y, label)
        pdf.drawRightString(width - 72, y, f"GHS {value}")
        y -= 16

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


async def _upload_to_s3(data: bytes, key: str, content_type: str) -> str:
    """Upload bytes to S3 and return public URL."""
    from apps.api.core.config import get_settings

    settings = get_settings()
    if not (
        settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY and settings.AWS_S3_BUCKET
    ):
        return f"local://{key}"

    import boto3

    s3 = boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )
    s3.put_object(
        Bucket=settings.AWS_S3_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
        ACL="public-read",
    )
    return f"https://{settings.AWS_S3_BUCKET}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"
