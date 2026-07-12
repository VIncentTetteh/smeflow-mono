"""Integration tests for Invoicing module: list, generate, void."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select


async def _upgrade_to_starter(async_client: AsyncClient, auth_headers: dict) -> None:
    resp = await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "starter"},
        headers=auth_headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
class TestListInvoices:
    async def test_list_invoices_empty(self, async_client: AsyncClient, auth_headers: dict):
        resp = await async_client.get("/api/v1/invoices", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["invoices"] == []

    async def test_list_invoices_with_filter(
        self, async_client: AsyncClient, auth_headers: dict, seeded_business
    ):
        """Generate two invoices then filter by status."""
        await _upgrade_to_starter(async_client, auth_headers)

        payload = {
            "supplier_name": "Test Shop",
            "customer_name": "Kofi Mensah",
            "invoice_type": "invoice",
            "line_items": [
                {"description": "Bags of flour", "qty": "10", "unit_price": "50.00", "unit": "bag"}
            ],
        }

        r1 = await async_client.post(
            "/api/v1/invoices/generate", json=payload, headers=auth_headers
        )
        assert r1.status_code == 201

        # Filter by issued status
        resp = await async_client.get("/api/v1/invoices?status=issued", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1


@pytest.mark.asyncio
class TestGenerateInvoice:
    async def test_generate_standalone_invoice(self, async_client: AsyncClient, auth_headers: dict):
        await _upgrade_to_starter(async_client, auth_headers)

        payload = {
            "supplier_name": "Test Shop",
            "supplier_tin": "C0012345678",
            "customer_name": "Akosua Asante",
            "customer_phone": "+233244555666",
            "customer_tin": "P0099887766",
            "invoice_type": "invoice",
            "line_items": [
                {
                    "description": "Rice (50kg bag)",
                    "qty": "2",
                    "unit_price": "250.00",
                    "unit": "bag",
                },
                {"description": "Palm oil (5L)", "qty": "5", "unit_price": "45.00"},
            ],
        }
        resp = await async_client.post(
            "/api/v1/invoices/generate", json=payload, headers=auth_headers
        )
        assert resp.status_code == 201
        data = resp.json()

        assert data["status"] == "issued"
        assert data["type"] == "invoice"
        assert data["supplier_name"] == "Test Shop"
        assert data["customer_name"] == "Akosua Asante"
        assert data["customer_phone"] == "+233244555666"
        assert data["invoice_number"].startswith("SME-")
        assert data["qr_payload"]
        assert data["ghqr_payload"]
        assert data["digital_signature"]
        assert data["verification_id"]
        assert len(data["line_items"]) == 2
        assert data["line_items"][0]["description"] == "Rice (50kg bag)"
        assert Decimal(data["line_items"][0]["line_total"]) == Decimal("500.00")

        # Verify tax computation: subtotal = 2*250 + 5*45 = 725
        subtotal = Decimal("725.00")
        assert Decimal(data["subtotal"]) == subtotal
        # VAT uses the configured platform rate; the full tax total also includes levies.
        assert Decimal(data["vat_amount"]) == Decimal("90.63")
        assert Decimal(data["total"]) == Decimal("848.26")

    async def test_generate_invoice_requires_line_items(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        await _upgrade_to_starter(async_client, auth_headers)

        resp = await async_client.post(
            "/api/v1/invoices/generate",
            json={"invoice_type": "invoice", "line_items": []},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_generate_proforma_invoice(self, async_client: AsyncClient, auth_headers: dict):
        await _upgrade_to_starter(async_client, auth_headers)

        payload = {
            "invoice_type": "proforma",
            "customer_name": "Future Customer",
            "line_items": [{"description": "Consulting fee", "qty": "1", "unit_price": "1000.00"}],
        }
        resp = await async_client.post(
            "/api/v1/invoices/generate", json=payload, headers=auth_headers
        )
        assert resp.status_code == 201
        assert resp.json()["type"] == "proforma"


@pytest.mark.asyncio
class TestVoidInvoice:
    async def test_void_invoice_changes_status_to_cancelled(
        self, async_client: AsyncClient, auth_headers: dict, db_session
    ):
        from apps.api.modules.admin.models import AuditLog
        from apps.api.modules.invoicing.models import Invoice, InvoiceItem

        await _upgrade_to_starter(async_client, auth_headers)

        # First generate an invoice
        create_resp = await async_client.post(
            "/api/v1/invoices/generate",
            json={
                "customer_name": "To Void",
                "invoice_type": "invoice",
                "line_items": [{"description": "Item", "qty": "1", "unit_price": "100.00"}],
            },
            headers=auth_headers,
        )
        assert create_resp.status_code == 201
        invoice_id = create_resp.json()["id"]

        # Now void it
        void_resp = await async_client.post(
            f"/api/v1/invoices/{invoice_id}/void", headers=auth_headers
        )
        assert void_resp.status_code == 200
        assert void_resp.json()["status"] == "cancelled"

        credit_note = (
            await db_session.execute(
                select(Invoice).where(Invoice.type == "credit_note", Invoice.sale_id.is_(None))
            )
        ).scalar_one()
        assert credit_note.total == Decimal("-117.00")

        credit_lines = (
            (
                await db_session.execute(
                    select(InvoiceItem).where(InvoiceItem.invoice_id == credit_note.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(credit_lines) == 1
        assert credit_note.original_invoice_id == UUID(invoice_id)
        assert credit_note.qr_payload
        assert credit_note.ghqr_payload
        assert credit_note.digital_signature
        assert credit_note.verification_id
        assert credit_lines[0].qty == Decimal("-1.000")
        assert credit_lines[0].line_total == Decimal("-100.00")

        audit_entry = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.action == "invoice.voided",
                    AuditLog.resource_id == UUID(invoice_id),
                )
            )
        ).scalar_one_or_none()
        assert audit_entry is not None

    async def test_void_already_cancelled_invoice_returns_409(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        await _upgrade_to_starter(async_client, auth_headers)

        create_resp = await async_client.post(
            "/api/v1/invoices/generate",
            json={
                "invoice_type": "invoice",
                "line_items": [{"description": "Item", "qty": "1", "unit_price": "50.00"}],
            },
            headers=auth_headers,
        )
        invoice_id = create_resp.json()["id"]

        await async_client.post(f"/api/v1/invoices/{invoice_id}/void", headers=auth_headers)
        resp2 = await async_client.post(f"/api/v1/invoices/{invoice_id}/void", headers=auth_headers)
        assert resp2.status_code == 409

    async def test_void_nonexistent_invoice_returns_404(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.post(f"/api/v1/invoices/{uuid4()}/void", headers=auth_headers)
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestGetInvoice:
    async def test_get_invoice_by_id(self, async_client: AsyncClient, auth_headers: dict):
        await _upgrade_to_starter(async_client, auth_headers)

        create_resp = await async_client.post(
            "/api/v1/invoices/generate",
            json={
                "invoice_type": "invoice",
                "line_items": [{"description": "Widget", "qty": "3", "unit_price": "20.00"}],
            },
            headers=auth_headers,
        )
        invoice_id = create_resp.json()["id"]

        get_resp = await async_client.get(f"/api/v1/invoices/{invoice_id}", headers=auth_headers)
        assert get_resp.status_code == 200
        assert get_resp.json()["id"] == invoice_id
        assert get_resp.json()["line_items"][0]["description"] == "Widget"

    async def test_invoice_lookup_by_sale_id(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session
    ):
        sale_resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "cash",
                "customer_phone": "+233244777888",
                "customer_name": "Invoice Customer",
                "idempotency_key": "invoice-lookup-by-sale",
            },
            headers=auth_headers,
        )
        assert sale_resp.status_code == 201
        sale_data = sale_resp.json()
        sale_id = sale_data["sale_id"]
        assert sale_data["invoice_id"]

        lookup_resp = await async_client.get(
            f"/api/v1/invoices/by-sale/{sale_id}", headers=auth_headers
        )
        assert lookup_resp.status_code == 200
        data = lookup_resp.json()
        assert data["sale_id"] == sale_id
        assert data["type"] == "receipt"
        assert data["customer_name"] == "Invoice Customer"
        assert data["customer_phone"] == "+233244777888"
        assert data["line_items"][0]["description"] == "Test Tomatoes"
        assert data["qr_payload"]
        assert data["ghqr_payload"]
        assert data["digital_signature"]

    async def test_sale_linked_invoice_uses_tax_inclusive_pricing(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        """generate_from_sale must extract tax from the sale total (Item.sell_price
        is tax-INCLUSIVE), not add tax on top of it — this is the opposite
        convention from generate_standalone/create_debit_note. Regression guard
        for the tax model fix in sell.tsx / InvoicingService.generate_from_sale."""
        sale_resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "cash",
                "idempotency_key": "invoice-tax-inclusive-check",
            },
            headers=auth_headers,
        )
        assert sale_resp.status_code == 201
        sale_id = sale_resp.json()["sale_id"]

        invoice_resp = await async_client.get(
            f"/api/v1/invoices/by-sale/{sale_id}", headers=auth_headers
        )
        assert invoice_resp.status_code == 200
        data = invoice_resp.json()

        # Total is exactly what the customer paid: 2 * 12.00 = 24.00 (tax-inclusive).
        assert Decimal(data["total"]) == Decimal("24.00")
        # Pre-tax base = total / 1.17 (combined VAT 12.5% + NHIL 2.5% + GETFund 1% + covid levy 1%).
        assert Decimal(data["subtotal"]) == Decimal("20.51")
        assert Decimal(data["vat_amount"]) == Decimal("2.56")
        assert Decimal(data["nhil_amount"]) == Decimal("0.51")
        assert Decimal(data["getfund_amount"]) == Decimal("0.21")
        assert Decimal(data["covid_levy"]) == Decimal("0.21")
        # Components must sum back to the original total — proves tax was extracted,
        # not added on top (which would inflate total beyond what the customer paid).
        components_sum = (
            Decimal(data["subtotal"])
            + Decimal(data["vat_amount"])
            + Decimal(data["nhil_amount"])
            + Decimal(data["getfund_amount"])
            + Decimal(data["covid_levy"])
        )
        assert components_sum == Decimal(data["total"])

    async def test_invoice_pdf_and_send_paths(
        self, async_client: AsyncClient, auth_headers: dict, db_session, monkeypatch
    ):
        from apps.api.modules.invoicing import router as invoicing_router
        from apps.api.modules.invoicing.models import Invoice

        await _upgrade_to_starter(async_client, auth_headers)

        create_resp = await async_client.post(
            "/api/v1/invoices/generate",
            json={
                "invoice_type": "invoice",
                "line_items": [{"description": "Bulk order", "qty": "1", "unit_price": "150.00"}],
            },
            headers=auth_headers,
        )
        invoice_id = create_resp.json()["id"]
        invoice = (
            await db_session.execute(select(Invoice).where(Invoice.id == UUID(invoice_id)))
        ).scalar_one()
        invoice.pdf_url = "https://example.com/invoices/test.pdf"
        await db_session.flush([invoice])

        pdf_resp = await async_client.get(
            f"/api/v1/invoices/{invoice_id}/pdf", headers=auth_headers, follow_redirects=False
        )
        assert pdf_resp.status_code in (302, 307)
        assert pdf_resp.headers["location"] == "https://example.com/invoices/test.pdf"

        queued: list[str] = []

        def fake_enqueue(_task, invoice_id_arg: str):
            queued.append(invoice_id_arg)

        monkeypatch.setattr(invoicing_router, "enqueue_task", fake_enqueue)
        send_resp = await async_client.post(
            f"/api/v1/invoices/{invoice_id}/send", headers=auth_headers
        )
        assert send_resp.status_code == 200
        assert send_resp.json()["status"] == "skipped"
        assert queued == []

        invoice.customer_phone = "+233244555666"
        await db_session.flush([invoice])
        send_resp = await async_client.post(
            f"/api/v1/invoices/{invoice_id}/send", headers=auth_headers
        )
        assert send_resp.status_code == 200
        assert send_resp.json()["status"] == "queued"
        assert queued == [send_resp.json()["message_id"]]


@pytest.mark.asyncio
class TestInvoiceCorrections:
    async def test_create_debit_note_linked_to_original(
        self, async_client: AsyncClient, auth_headers: dict, db_session
    ):
        from apps.api.modules.invoicing.models import Invoice

        await _upgrade_to_starter(async_client, auth_headers)

        create_resp = await async_client.post(
            "/api/v1/invoices/generate",
            json={
                "invoice_type": "invoice",
                "customer_name": "Bulk Buyer",
                "line_items": [{"description": "Original", "qty": "1", "unit_price": "100.00"}],
            },
            headers=auth_headers,
        )
        invoice_id = create_resp.json()["id"]

        debit_resp = await async_client.post(
            f"/api/v1/invoices/{invoice_id}/debit-note",
            json={
                "line_items": [
                    {"description": "Additional delivery charge", "qty": "1", "unit_price": "20.00"}
                ]
            },
            headers=auth_headers,
        )
        assert debit_resp.status_code == 201
        data = debit_resp.json()
        assert data["type"] == "debit_note"
        assert data["original_invoice_id"] == invoice_id
        assert data["customer_name"] == "Bulk Buyer"
        assert data["qr_payload"]
        assert data["ghqr_payload"]
        assert data["digital_signature"]
        assert len(data["line_items"]) == 1

        note = (
            await db_session.execute(select(Invoice).where(Invoice.id == UUID(data["id"])))
        ).scalar_one()
        assert note.original_invoice_id == UUID(invoice_id)

    async def test_issued_invoice_has_no_update_route(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        await _upgrade_to_starter(async_client, auth_headers)

        create_resp = await async_client.post(
            "/api/v1/invoices/generate",
            json={
                "invoice_type": "invoice",
                "line_items": [{"description": "Immutable", "qty": "1", "unit_price": "30.00"}],
            },
            headers=auth_headers,
        )
        invoice_id = create_resp.json()["id"]

        patch_resp = await async_client.patch(
            f"/api/v1/invoices/{invoice_id}",
            json={"customer_name": "Changed"},
            headers=auth_headers,
        )
        assert patch_resp.status_code == 405
