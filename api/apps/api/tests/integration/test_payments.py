"""Integration tests for payments and reconciliation."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_payment_request_initiates_paystack_call(
    async_client: AsyncClient, auth_headers: dict, db_session, seeded_business, monkeypatch
):
    from apps.api.modules.payments.models import Payment
    from libs.payment_clients.base import PaymentInitResponse
    from libs.payment_clients.paystack import PaystackClient

    calls: list[tuple[Decimal, str, str]] = []

    async def fake_request_payment(self, amount, phone, reference, description):
        calls.append((amount, phone, reference))
        return PaymentInitResponse(external_ref="ps-ext-123", status="pending")

    monkeypatch.setattr(PaystackClient, "request_payment", fake_request_payment)

    resp = await async_client.post(
        "/api/v1/payments/request",
        json={
            "amount": "42.50",
            "provider": "mtn",
            "phone": "+233244000111",
            "reference": "order-1",
            "idempotency_key": str(uuid4()),
        },
        headers=auth_headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["external_ref"] == "ps-ext-123"
    assert data["status"] == "pending"
    assert calls == [(Decimal("42.50"), "+233244000111", "order-1")]

    payment = await db_session.get(Payment, UUID(data["payment_id"]))
    assert payment.external_ref == "ps-ext-123"
    assert payment.status == "pending"


@pytest.mark.asyncio
async def test_payment_request_failure_returns_payment_error(
    async_client: AsyncClient, auth_headers: dict, monkeypatch
):
    from apps.api.core.exceptions import PaymentError
    from libs.payment_clients.paystack import PaystackClient

    async def fake_request_payment(self, amount, phone, reference, description):
        raise PaymentError("provider down", provider="mtn")

    monkeypatch.setattr(PaystackClient, "request_payment", fake_request_payment)

    resp = await async_client.post(
        "/api/v1/payments/request",
        json={
            "amount": "10.00",
            "provider": "mtn",
            "phone": "+233244000111",
            "idempotency_key": str(uuid4()),
        },
        headers=auth_headers,
    )

    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "PAYMENT_ERROR"


@pytest.mark.asyncio
async def test_paystack_charge_webhook_reconciles_invoice_sale_and_receivable_idempotently(
    db_session, seeded_business
):
    from apps.api.modules.invoicing.models import Invoice
    from apps.api.modules.payments.models import Payment
    from apps.api.modules.payments.router import _apply_paystack_payment_update
    from apps.api.modules.sales.models import Customer, Receivable, Sale

    business = seeded_business["business"]
    user = seeded_business["user"]

    customer = Customer(
        business_id=business.id,
        name="Credit Customer",
        phone="+233244111222",
    )
    db_session.add(customer)
    await db_session.flush([customer])

    sale = Sale(
        business_id=business.id,
        customer_id=customer.id,
        recorded_by=user.id,
        status="credit",
        payment_method="momo",
        subtotal=Decimal("50.00"),
        total=Decimal("50.00"),
        amount_paid=Decimal("0.00"),
        balance_due=Decimal("50.00"),
        idempotency_key=str(uuid4()),
    )
    db_session.add(sale)
    await db_session.flush([sale])

    receivable = Receivable(
        business_id=business.id,
        sale_id=sale.id,
        customer_id=customer.id,
        amount=Decimal("50.00"),
    )
    invoice = Invoice(
        business_id=business.id,
        sale_id=sale.id,
        invoice_number="SME-TEST-00001",
        type="invoice",
        status="issued",
        supplier_name=business.name,
        subtotal=Decimal("50.00"),
        total=Decimal("50.00"),
    )
    db_session.add_all([receivable, invoice])
    await db_session.flush([receivable, invoice])

    payment = Payment(
        business_id=business.id,
        invoice_id=invoice.id,
        sale_id=sale.id,
        type="collection",
        provider="mtn",
        amount=Decimal("50.00"),
        phone="+233244111222",
        external_ref="ps-callback-1",
        internal_ref="sale-1",
        status="pending",
        idempotency_key=str(uuid4()),
    )
    db_session.add(payment)
    await db_session.flush([payment])

    # Simulate Paystack charge.success webhook — twice to prove idempotency
    event_payload = {
        "event": "charge.success",
        "data": {
            "reference": "ps-callback-1",
            "status": "success",
            "channel": "mobile_money",
            "authorization": {"provider": "mtn"},
            "gateway_response": "Successful",
        },
    }
    await _apply_paystack_payment_update(event_payload, db_session)
    await _apply_paystack_payment_update(event_payload, db_session)

    for obj in (payment, sale, receivable, invoice):
        await db_session.refresh(obj)

    assert payment.status == "success"
    assert payment.processor == "paystack"
    assert payment.channel == "mobile_money"
    assert payment.provider_detail == "mtn"
    assert payment.metadata_["reconciled_at"]
    assert invoice.status == "paid"
    assert invoice.paid_at is not None
    assert sale.status == "completed"
    assert sale.amount_paid == Decimal("50.00")
    assert sale.balance_due == Decimal("0.00")
    assert receivable.status == "settled"
    assert receivable.amount_paid == Decimal("50.00")


@pytest.mark.asyncio
async def test_paystack_charge_webhook_activates_pending_subscription_upgrade(
    db_session, seeded_business
):
    """A subscription-upgrade checkout (Initialize Transaction, not a Payment row)
    must activate via the canonical webhook's fallback to
    BillingService.handle_webhook_success() — the actual live code path for
    charge.success, unlike handle_paystack_webhook()'s customer.metadata/data.plan
    parsing, which this event shape never populates."""
    from apps.api.modules.billing.models import BillingTransaction, Subscription
    from apps.api.modules.payments.router import _apply_paystack_payment_update

    business = seeded_business["business"]

    sub = Subscription(business_id=business.id, plan="free", billing_interval="monthly")
    db_session.add(sub)
    await db_session.flush([sub])

    reference = f"sub-{business.id}-pro-1700000000"
    txn = BillingTransaction(
        subscription_id=sub.id,
        business_id=business.id,
        amount=Decimal("149.00"),
        status="pending",
        payment_method="paystack",
        provider_ref=reference,
        description="subscription_upgrade:pro:monthly",
    )
    db_session.add(txn)
    await db_session.flush([txn])

    # Shaped like a real Initialize-Transaction charge.success: no data.plan,
    # no data.customer.metadata — just the reference we already track.
    event_payload = {
        "event": "charge.success",
        "data": {
            "reference": reference,
            "status": "success",
            "customer": {"customer_code": "CUS_testabc"},
        },
    }
    await _apply_paystack_payment_update(event_payload, db_session)

    await db_session.refresh(sub)
    await db_session.refresh(txn)
    await db_session.refresh(business)

    assert sub.plan == "pro"
    assert business.subscription == "pro"
    assert txn.status == "success"
    assert txn.paid_at is not None


@pytest.mark.asyncio
async def test_generate_ghqr_returns_dynamic_payload(async_client: AsyncClient, auth_headers: dict):
    resp = await async_client.post(
        "/api/v1/payments/ghqr/generate",
        json={"amount": "25.00"},
        headers=auth_headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["amount"] == "25.00"
    assert data["currency"] == "GHS"
    assert data["qr_payload"]


@pytest.mark.asyncio
async def test_paystack_webhook_rejects_invalid_json(async_client: AsyncClient):
    resp = await async_client.post(
        "/api/v1/payments/webhooks/paystack",
        content=b"{not json",
    )

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_paystack_webhook_ignores_invalid_signature(async_client: AsyncClient, monkeypatch):
    from libs.payment_clients.paystack import PaystackClient

    monkeypatch.setattr(PaystackClient, "verify_webhook_raw", lambda self, body, sig: False)

    resp = await async_client.post(
        "/api/v1/payments/webhooks/paystack",
        json={"event": "charge.success", "data": {"reference": "missing"}},
        headers={"X-Paystack-Signature": "bad"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "ignored"}


# ── List / detail endpoints ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_payments_empty(async_client: AsyncClient, auth_headers: dict):
    resp = await async_client.get("/api/v1/payments", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert "items" in data
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_reconciliation_inbox_groups_unmatched_and_matched_payments(
    async_client: AsyncClient, auth_headers: dict, db_session, seeded_business
):
    from apps.api.modules.payments.models import Payment
    from apps.api.modules.sales.models import Sale

    biz_id = seeded_business["business"].id
    user_id = seeded_business["user"].id
    sale = Sale(
        business_id=biz_id,
        recorded_by=user_id,
        status="completed",
        payment_method="momo",
        subtotal=Decimal("25.00"),
        total=Decimal("25.00"),
        amount_paid=Decimal("25.00"),
        balance_due=Decimal("0.00"),
        idempotency_key=str(uuid4()),
    )
    db_session.add(sale)
    await db_session.flush([sale])

    db_session.add_all(
        [
            Payment(
                business_id=biz_id,
                type="collection",
                provider="mtn",
                amount=Decimal("100.00"),
                phone="+233244000001",
                internal_ref="ref-unmatched",
                status="success",
                idempotency_key=str(uuid4()),
            ),
            Payment(
                business_id=biz_id,
                sale_id=sale.id,
                type="collection",
                provider="mtn",
                amount=Decimal("25.00"),
                phone="+233244000002",
                internal_ref="ref-matched",
                status="success",
                idempotency_key=str(uuid4()),
            ),
        ]
    )
    await db_session.flush()

    resp = await async_client.get("/api/v1/payments/reconciliation/inbox", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert "summary" in data
    assert data["summary"]["unmatched"] == 1
    assert data["summary"]["matched"] == 1
    assert data["summary"]["suggested_match"] == 0


@pytest.mark.asyncio
async def test_get_payment_by_id(
    async_client: AsyncClient, auth_headers: dict, db_session, seeded_business
):
    from apps.api.modules.payments.models import Payment

    biz_id = seeded_business["business"].id
    p = Payment(
        business_id=biz_id,
        type="collection",
        provider="mtn",
        amount=Decimal("15.00"),
        phone="+233244000111",
        internal_ref="ref-detail-test",
        status="pending",
        idempotency_key=str(uuid4()),
    )
    db_session.add(p)
    await db_session.flush([p])

    resp = await async_client.get(f"/api/v1/payments/{p.id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["provider"] == "mtn"
    assert float(data["amount"]) == 15.0
    assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_get_payment_not_found(async_client: AsyncClient, auth_headers: dict):
    resp = await async_client.get(f"/api/v1/payments/{uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_payment_channel_analytics_groups_platform_held_successful_collections(
    async_client: AsyncClient, auth_headers: dict, db_session, seeded_business
):
    from apps.api.modules.payments.models import Payment
    from apps.api.modules.settlements.models import MerchantLedgerEntry

    business_id = seeded_business["business"].id
    card_payment = Payment(
        business_id=business_id,
        type="collection",
        provider="paystack",
        processor="paystack",
        channel="card",
        provider_detail="visa",
        amount=Decimal("25.00"),
        status="success",
        idempotency_key=str(uuid4()),
    )
    cash_payment = Payment(
        business_id=business_id,
        type="collection",
        provider="cash",
        processor="manual",
        channel="cash",
        amount=Decimal("15.00"),
        status="success",
        idempotency_key=str(uuid4()),
    )
    momo_payment = Payment(
        business_id=business_id,
        type="collection",
        provider="mtn",
        processor="paystack",
        channel=None,
        amount=Decimal("30.00"),
        status="success",
        idempotency_key=str(uuid4()),
    )
    uncredited_payment = Payment(
        business_id=business_id,
        type="collection",
        provider="vodafone",
        processor="paystack",
        channel="mobile_money",
        amount=Decimal("100.00"),
        status="success",
        idempotency_key=str(uuid4()),
    )
    db_session.add_all([card_payment, cash_payment, momo_payment, uncredited_payment])
    await db_session.flush([card_payment, cash_payment, momo_payment, uncredited_payment])
    db_session.add_all(
        [
            MerchantLedgerEntry(
                business_id=business_id,
                payment_id=card_payment.id,
                type="credit",
                amount=Decimal("25.00"),
                balance_after=Decimal("25.00"),
            ),
            MerchantLedgerEntry(
                business_id=business_id,
                payment_id=momo_payment.id,
                type="credit",
                amount=Decimal("30.00"),
                balance_after=Decimal("55.00"),
            ),
        ]
    )
    await db_session.flush()
    resp = await async_client.get("/api/v1/payments/analytics/channels", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["grand_total"] == "55.00"
    assert data["items"] == [
        {
            "processor": "paystack",
            "channel": "mobile_money",
            "provider_detail": "mtn",
            "count": 1,
            "total": "30.00",
        },
        {
            "processor": "paystack",
            "channel": "card",
            "provider_detail": "visa",
            "count": 1,
            "total": "25.00",
        },
    ]
    assert {
        "processor": "paystack",
        "channel": "cash",
        "provider_detail": None,
        "count": 1,
        "total": "15.00",
    } not in data["items"]
