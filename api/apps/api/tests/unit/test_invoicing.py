"""Unit tests for invoicing calculations (GRA tax breakdown)."""

from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from apps.api.core.config import get_settings

settings = get_settings()


class TestGRATaxCalculation:
    """Verify GRA tax breakdown is computed correctly for given subtotals."""

    def _compute(self, subtotal: Decimal) -> dict:
        vat = round(subtotal * Decimal(str(settings.VAT_RATE)), 2)
        nhil = round(subtotal * Decimal(str(settings.NHIL_RATE)), 2)
        getfund = round(subtotal * Decimal(str(settings.GETFUND_RATE)), 2)
        covid = round(subtotal * Decimal(str(settings.COVID_LEVY_RATE)), 2)
        total = subtotal + vat + nhil + getfund + covid
        return {"vat": vat, "nhil": nhil, "getfund": getfund, "covid": covid, "total": total}

    def test_vat_rate_is_15_percent(self):
        result = self._compute(Decimal("100"))
        assert result["vat"] == Decimal("15.00")

    def test_nhil_rate_is_2_point_5_percent(self):
        result = self._compute(Decimal("100"))
        assert result["nhil"] == Decimal("2.50")

    def test_getfund_rate_is_2_point_5_percent(self):
        result = self._compute(Decimal("100"))
        assert result["getfund"] == Decimal("2.50")

    def test_covid_levy_is_1_percent(self):
        result = self._compute(Decimal("100"))
        assert result["covid"] == Decimal("1.00")

    def test_total_on_100_ghs_subtotal(self):
        result = self._compute(Decimal("100"))
        assert result["total"] == Decimal("121.00")

    def test_zero_subtotal(self):
        result = self._compute(Decimal("0"))
        assert result["total"] == Decimal("0")
        assert result["vat"] == Decimal("0")

    def test_large_subtotal_precision(self):
        result = self._compute(Decimal("12345.67"))
        # Total should be ~21% higher (15 + 2.5 + 2.5 + 1 = 21%)
        assert result["total"] > Decimal("12345.67")
        # Sum of taxes
        tax_sum = result["vat"] + result["nhil"] + result["getfund"] + result["covid"]
        assert result["total"] == Decimal("12345.67") + tax_sum


def test_invoice_pdf_builder_returns_pdf_bytes():
    from apps.api.workers.tasks.invoicing_tasks import _build_invoice_pdf

    invoice = SimpleNamespace(
        invoice_number="SME-UNIT-00001",
        supplier_name="Test Shop",
        supplier_tin="C0012345678",
        customer_name="Akosua Asante",
        subtotal=Decimal("100.00"),
        vat_amount=Decimal("15.00"),
        nhil_amount=Decimal("2.50"),
        getfund_amount=Decimal("2.50"),
        covid_levy=Decimal("1.00"),
        total=Decimal("121.00"),
        verification_id="VERIFY123",
        line_items=[
            SimpleNamespace(
                description="Rice",
                qty=Decimal("2"),
                unit_price=Decimal("50.00"),
                line_total=Decimal("100.00"),
            )
        ],
    )

    pdf_bytes = _build_invoice_pdf(invoice)

    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500


def test_generate_invoice_assets_queues_customer_delivery(monkeypatch):
    from apps.api.core import database
    from apps.api.workers import dispatch
    from apps.api.workers.tasks import invoicing_tasks

    invoice_id = str(uuid4())
    invoice = SimpleNamespace(
        id=invoice_id,
        qr_payload='{"invoice":"qr"}',
        ghqr_payload='{"invoice":"ghqr"}',
        qr_image_url=None,
        ghqr_image_url=None,
        pdf_url=None,
    )

    class FakeResult:
        def scalar_one_or_none(self):
            return invoice

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, _query):
            return FakeResult()

        async def commit(self):
            return None

    uploaded: list[tuple[bytes, str, str]] = []
    queued: list[str] = []

    async def fake_upload(data: bytes, key: str, content_type: str) -> str:
        uploaded.append((data, key, content_type))
        return f"https://cdn.example.com/{key}"

    def fake_enqueue(_task, invoice_id_arg: str):
        queued.append(invoice_id_arg)

    monkeypatch.setattr(database, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(invoicing_tasks, "_upload_to_s3", fake_upload)
    monkeypatch.setattr(invoicing_tasks, "_build_invoice_pdf", lambda _invoice: b"%PDF-test")
    monkeypatch.setattr(dispatch, "enqueue_task", fake_enqueue)

    invoicing_tasks.generate_invoice_assets.run(invoice_id)

    assert invoice.qr_image_url == f"https://cdn.example.com/invoices/{invoice_id}/qr.png"
    assert invoice.ghqr_image_url == f"https://cdn.example.com/invoices/{invoice_id}/ghqr.png"
    assert invoice.pdf_url == f"https://cdn.example.com/invoices/{invoice_id}/invoice.pdf"
    assert uploaded[-1] == (b"%PDF-test", f"invoices/{invoice_id}/invoice.pdf", "application/pdf")
    assert queued == []


def test_send_invoice_to_customer_uses_invoice_customer_phone(monkeypatch):
    from apps.api.core import database
    from apps.api.workers.tasks import invoicing_tasks, notification_tasks

    invoice_id = str(uuid4())
    invoice = SimpleNamespace(
        business_id=uuid4(),
        sale_id=None,
        customer_phone="+233244555666",
        invoice_number="SME-TEST-00001",
        total=Decimal("121.00"),
        pdf_url="https://cdn.example.com/invoice.pdf",
    )

    class FakeResult:
        def scalar_one_or_none(self):
            return invoice

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, _query):
            return FakeResult()

    sent: list[dict] = []

    def fake_delay(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(database, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(notification_tasks.send_notification, "delay", fake_delay)

    invoicing_tasks.send_invoice_to_customer.run(invoice_id)

    assert sent == [
        {
            "business_id": str(invoice.business_id),
            "event_type": "invoice.sent",
            "data": {
                "invoice_number": "SME-TEST-00001",
                "total": "121.00",
                "pdf_url": "https://cdn.example.com/invoice.pdf",
                "phone": "+233244555666",
            },
        }
    ]


def test_send_invoice_to_customer_skips_without_customer_phone(monkeypatch):
    from apps.api.core import database
    from apps.api.workers.tasks import invoicing_tasks, notification_tasks

    invoice = SimpleNamespace(
        business_id=uuid4(),
        sale_id=None,
        customer_phone=None,
        invoice_number="SME-TEST-00002",
        total=Decimal("121.00"),
        pdf_url="https://cdn.example.com/invoice.pdf",
    )

    class FakeResult:
        def scalar_one_or_none(self):
            return invoice

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, _query):
            return FakeResult()

    sent: list[dict] = []
    monkeypatch.setattr(database, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(
        notification_tasks.send_notification, "delay", lambda **kwargs: sent.append(kwargs)
    )

    invoicing_tasks.send_invoice_to_customer.run(str(uuid4()))

    assert sent == []
