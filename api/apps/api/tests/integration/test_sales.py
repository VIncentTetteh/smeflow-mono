"""Integration tests for Sales module: period summary, sale recording, void."""

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

# credit_due_date must be strictly after "today" (see SaleCreate.validate_payment) —
# compute relative to the test run instead of a fixed date that eventually lands
# in the past.
CREDIT_DUE_DATE = (date.today() + timedelta(days=30)).isoformat()


@pytest.mark.asyncio
class TestPeriodSummary:
    async def test_period_summary_empty_range(self, async_client: AsyncClient, auth_headers: dict):
        today = str(date.today())
        resp = await async_client.get(
            f"/api/v1/sales/summary/period?from_date={today}&to_date={today}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_sales"] == 0
        assert Decimal(data["total_revenue"]) == Decimal("0")
        assert "cash_revenue" in data
        assert "momo_revenue" in data
        assert "credit_revenue" in data
        assert "outstanding_credit" in data

    async def test_period_summary_requires_both_dates(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        today = str(date.today())
        resp = await async_client.get(
            f"/api/v1/sales/summary/period?from_date={today}",
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_period_summary_after_sale(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        """Record a cash sale, verify it appears in period summary."""
        idem_key = str(uuid4())
        await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [
                    {
                        "item_id": str(seeded_item.id),
                        "qty": "5",
                        "unit_price": "12.00",
                    }
                ],
                "payment_method": "cash",
                "idempotency_key": idem_key,
            },
            headers=auth_headers,
        )

        today = str(date.today())
        resp = await async_client.get(
            f"/api/v1/sales/summary/period?from_date={today}&to_date={today}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_sales"] >= 1
        assert Decimal(data["cash_revenue"]) >= Decimal("60.00")


@pytest.mark.asyncio
class TestSaleRecording:
    async def test_record_cash_sale(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "cash",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert Decimal(data["total"]) == Decimal("24.00")
        assert Decimal(data["balance_due"]) == Decimal("0.00")

    async def test_record_sale_decreases_stock(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session
    ):
        """Verify inventory is deducted after a sale."""
        # Record a sale of 10 units
        await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "10", "unit_price": "12.00"}],
                "payment_method": "cash",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )

        # Check item stock via API
        resp = await async_client.get(
            f"/api/v1/inventory/items/{seeded_item.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        # Stock should be 100 - 10 = 90
        assert Decimal(resp.json()["current_stock"]) == Decimal("90.00")

    async def test_record_cash_sale_writes_audit_event(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session
    ):
        from sqlalchemy import select

        from apps.api.modules.admin.models import AuditLog

        resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "1", "unit_price": "12.00"}],
                "payment_method": "cash",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        sale_id = resp.json()["sale_id"]

        result = await db_session.execute(select(AuditLog).where(AuditLog.action == "sale.create"))
        audit_log = result.scalar_one()
        assert str(audit_log.resource_id) == sale_id
        assert audit_log.after_state["payment_method"] == "cash"

    async def test_record_credit_sale_creates_balance_due(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "3", "unit_price": "12.00"}],
                "payment_method": "credit",
                "customer_name": "Ama Owusu",
                "customer_phone": "+233200111222",
                "credit_due_date": CREDIT_DUE_DATE,
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert Decimal(data["balance_due"]) == Decimal("36.00")

        listed = await async_client.get("/api/v1/sales", headers=auth_headers)
        assert listed.status_code == 200
        credit_sale = next(row for row in listed.json() if row["id"] == data["sale_id"])
        assert credit_sale["credit_due_date"].startswith(CREDIT_DUE_DATE)

        detail = await async_client.get(f"/api/v1/sales/{data['sale_id']}", headers=auth_headers)
        assert detail.status_code == 200
        assert detail.json()["credit_due_date"].startswith(CREDIT_DUE_DATE)

    async def test_record_momo_sale_is_rejected_for_unified_checkout(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session
    ):
        resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "momo",
                "payment_provider": "telecel",
                "customer_phone": "+233244333444",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 422
        assert "Direct MoMo RequestToPay is deprecated" in str(resp.json())

    async def test_momo_intent_create_endpoint_is_retired(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session, monkeypatch
    ):
        resp = await async_client.post(
            "/api/v1/sales/momo/intents",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "momo",
                "payment_provider": "telecel",
                "customer_phone": "+233244333444",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 410
        assert resp.json()["error"]["code"] == "MOMO_REQUEST_TO_PAY_DEPRECATED"

    async def test_paystack_intent_returns_customer_checkout_and_tracks_channel(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session, monkeypatch
    ):
        from apps.api.modules.payments.models import Payment
        from libs.payment_clients.paystack import PaystackClient

        async def fake_initialize(self, email, amount_ghs, reference, **kwargs):
            return {
                "authorization_url": "https://checkout.paystack.com/test-link",
                "access_code": "access",
                "reference": reference,
            }

        async def fake_verify(self, external_ref):
            return {"status": "success", "channel": "card", "provider_detail": "visa"}

        monkeypatch.setattr(PaystackClient, "initialize_transaction", fake_initialize)
        monkeypatch.setattr(PaystackClient, "verify_transaction_details", fake_verify)

        intent = await async_client.post(
            "/api/v1/sales/payment-intents",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "paystack",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        assert intent.status_code == 201
        assert intent.json()["payment_url"] == "https://checkout.paystack.com/test-link"
        assert intent.json()["qr_image_url"]

        verified = await async_client.post(
            f"/api/v1/sales/payment-intents/{intent.json()['payment_id']}/verify",
            headers=auth_headers,
        )
        assert verified.status_code == 200
        assert verified.json()["channel"] == "card"
        assert verified.json()["sale_id"]
        payment = await db_session.get(Payment, UUID(intent.json()["payment_id"]))
        assert payment.processor == "paystack"
        assert payment.channel == "card"
        assert payment.provider_detail == "visa"
        from sqlalchemy import select

        from apps.api.modules.business.models import Business
        from apps.api.modules.settlements.models import MerchantLedgerEntry

        business = await db_session.get(Business, payment.business_id)
        assert business.unsettled_balance == Decimal("23.40")
        ledger_rows = (
            await db_session.execute(
                select(MerchantLedgerEntry).where(
                    MerchantLedgerEntry.business_id == payment.business_id,
                    MerchantLedgerEntry.payment_id == payment.id,
                )
            )
        ).scalars().all()
        assert [row.type for row in ledger_rows] == ["credit", "fee"]

        today = str(date.today())
        daily = await async_client.get("/api/v1/sales/summary/daily", headers=auth_headers)
        assert daily.status_code == 200
        assert Decimal(daily.json()["momo_revenue"]) >= Decimal("24.00")

        period = await async_client.get(
            f"/api/v1/sales/summary/period?from_date={today}&to_date={today}",
            headers=auth_headers,
        )
        assert period.status_code == 200
        assert Decimal(period.json()["momo_revenue"]) >= Decimal("24.00")

    async def test_momo_intent_retirement_takes_precedence_over_reservation_checks(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, monkeypatch
    ):
        resp = await async_client.post(
            "/api/v1/sales/momo/intents",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "momo",
                "payment_provider": "telecel",
                "customer_phone": "+233244333444",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )

        assert resp.status_code == 410
        body = resp.json()["error"]
        assert body["code"] == "MOMO_REQUEST_TO_PAY_DEPRECATED"

    async def test_momo_intent_verify_endpoint_requires_existing_legacy_payment(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session, monkeypatch
    ):
        first = await async_client.post(
            f"/api/v1/sales/momo/intents/{uuid4()}/verify",
            headers=auth_headers,
        )

        assert first.status_code == 404

    async def test_mixed_cash_momo_sale_is_rejected_for_unified_checkout(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, db_session
    ):
        resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "mixed",
                "payment_splits": [
                    {"method": "cash", "amount": "10.00"},
                    {"method": "momo", "amount": "14.00", "phone": "+233244333444"},
                ],
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 422
        assert "Direct MoMo payment legs are deprecated" in str(resp.json())

    async def test_mixed_payment_is_rejected_until_splits_exist(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "1", "unit_price": "12.00"}],
                "payment_method": "mixed",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_idempotency_prevents_duplicate(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        key = str(uuid4())
        payload = {
            "items": [{"item_id": str(seeded_item.id), "qty": "1", "unit_price": "12.00"}],
            "payment_method": "cash",
            "idempotency_key": key,
        }
        r1 = await async_client.post("/api/v1/sales/record", json=payload, headers=auth_headers)
        r2 = await async_client.post("/api/v1/sales/record", json=payload, headers=auth_headers)
        assert r1.status_code == 201
        assert r2.status_code in (200, 201)
        assert r1.json()["sale_id"] == r2.json()["sale_id"]

    async def test_batch_sync_handles_duplicate_and_success(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        key = str(uuid4())
        sale = {
            "items": [{"item_id": str(seeded_item.id), "qty": "1", "unit_price": "12.00"}],
            "payment_method": "cash",
            "idempotency_key": key,
        }

        first = await async_client.post(
            "/api/v1/sales/batch",
            json={"sales": [sale]},
            headers=auth_headers,
        )
        second = await async_client.post(
            "/api/v1/sales/batch",
            json={"sales": [sale]},
            headers=auth_headers,
        )

        assert first.status_code == 200
        assert first.json()["results"][0]["status"] == "success"
        assert second.status_code == 200
        assert second.json()["results"][0]["status"] == "duplicate"

    async def test_record_credit_payment_updates_receivable(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item
    ):
        credit_resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "3", "unit_price": "12.00"}],
                "payment_method": "credit",
                "customer_name": "Ama Owusu",
                "customer_phone": "+233200111222",
                "credit_due_date": CREDIT_DUE_DATE,
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        sale_id = credit_resp.json()["sale_id"]

        partial = await async_client.post(
            f"/api/v1/sales/{sale_id}/pay",
            json={"amount": "10.00", "payment_method": "cash"},
            headers=auth_headers,
        )
        assert partial.status_code == 200
        assert partial.json()["status"] == "credit"
        assert Decimal(partial.json()["amount_paid"]) == Decimal("10.00")
        assert Decimal(partial.json()["balance_due"]) == Decimal("26.00")

        final = await async_client.post(
            f"/api/v1/sales/{sale_id}/pay",
            json={"amount": "26.00", "payment_method": "cash"},
            headers=auth_headers,
        )
        assert final.status_code == 200
        assert final.json()["status"] == "completed"
        assert Decimal(final.json()["balance_due"]) == Decimal("0.00")

    async def test_credit_repayment_intent_uses_merchant_amount_and_rejects_excess(
        self, async_client: AsyncClient, auth_headers: dict, seeded_item, monkeypatch
    ):
        from libs.payment_clients.paystack import PaystackClient

        async def fake_initialize(self, email, amount_ghs, reference, **kwargs):
            return {
                "authorization_url": "https://checkout.paystack.test/credit",
                "reference": reference,
            }

        monkeypatch.setattr(PaystackClient, "initialize_transaction", fake_initialize)
        credit = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "3", "unit_price": "12.00"}],
                "payment_method": "credit",
                "customer_name": "Ama Owusu",
                "customer_phone": "+233200111222",
                "credit_due_date": CREDIT_DUE_DATE,
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        sale_id = credit.json()["sale_id"]

        intent = await async_client.post(
            f"/api/v1/sales/{sale_id}/repayment-intents",
            json={"amount": "10.00", "idempotency_key": str(uuid4())},
            headers=auth_headers,
        )
        assert intent.status_code == 201
        assert intent.json()["payment_url"] == "https://checkout.paystack.test/credit"

        excess = await async_client.post(
            f"/api/v1/sales/{sale_id}/repayment-intents",
            json={"amount": "50.00", "idempotency_key": str(uuid4())},
            headers=auth_headers,
        )
        assert excess.status_code == 422
        assert excess.json()["error"]["code"] == "REPAYMENT_EXCEEDS_BALANCE"

    async def test_void_sale(self, async_client: AsyncClient, auth_headers: dict, seeded_item):
        create_resp = await async_client.post(
            "/api/v1/sales/record",
            json={
                "items": [{"item_id": str(seeded_item.id), "qty": "2", "unit_price": "12.00"}],
                "payment_method": "cash",
                "idempotency_key": str(uuid4()),
            },
            headers=auth_headers,
        )
        sale_id = create_resp.json()["sale_id"]

        void_resp = await async_client.post(f"/api/v1/sales/{sale_id}/void", headers=auth_headers)
        assert void_resp.status_code == 200
        assert void_resp.json()["status"] == "voided"


@pytest.mark.asyncio
class TestSalesCustomers:
    async def test_list_customers_route_is_not_shadowed_by_sale_id(
        self, async_client: AsyncClient, auth_headers: dict
    ):
        resp = await async_client.get("/api/v1/sales/customers", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []
