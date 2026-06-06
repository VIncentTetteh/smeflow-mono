"""Integration tests for Phase 2 credit APIs."""

from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_credit_score_history_and_loan_request(
    async_client: AsyncClient, auth_headers: dict, seeded_item
) -> None:
    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "starter"},
        headers=auth_headers,
    )

    for _ in range(3):
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

    score = await async_client.get("/api/v1/credit/score", headers=auth_headers)
    assert score.status_code == 200
    data = score.json()
    assert Decimal(data["score"]) >= Decimal("0")
    assert data["band"] in ["A", "B", "C", "D", "E"]
    assert "momo_velocity" in data["factors"]

    history = await async_client.get("/api/v1/credit/score/history", headers=auth_headers)
    assert history.status_code == 200
    assert len(history.json()) >= 1

    request = await async_client.post(
        "/api/v1/credit/request",
        json={"amount_requested": "100.00", "term_days": 30},
        headers=auth_headers,
    )
    assert request.status_code == 201
    assert request.json()["status"] == "pending_partner"
    assert request.json()["partner_ref"] is None

    requests = await async_client.get("/api/v1/credit/requests", headers=auth_headers)
    assert requests.status_code == 200
    assert requests.json()[0]["id"] == request.json()["id"]


@pytest.mark.asyncio
async def test_credit_factors_count_verified_paystack_momo_and_mixed_sales(
    db_session, seeded_business
) -> None:
    from apps.api.modules.credit.scoring import compute_factors
    from apps.api.modules.payments.models import Payment
    from apps.api.modules.sales.models import Sale

    business_id = seeded_business["business"].id
    db_session.add_all(
        [
            Sale(
                business_id=business_id,
                payment_method="mixed",
                status="completed",
                subtotal=Decimal("100.00"),
                total=Decimal("100.00"),
                amount_paid=Decimal("100.00"),
                balance_due=Decimal("0.00"),
            ),
            Sale(
                business_id=business_id,
                payment_method="cash",
                status="completed",
                subtotal=Decimal("50.00"),
                total=Decimal("50.00"),
                amount_paid=Decimal("50.00"),
                balance_due=Decimal("0.00"),
            ),
            Payment(
                business_id=business_id,
                type="collection",
                provider="telecel",
                amount=Decimal("100.00"),
                status="success",
                external_ref=f"telecel-{uuid4()}",
            ),
        ]
    )
    await db_session.flush()

    factors = await compute_factors(db_session, business_id)

    assert factors.momo_velocity > 0
    assert factors.digital_adoption_score == 0.5


@pytest.mark.asyncio
async def test_selected_lender_request_grants_consent_and_limits_visibility(
    async_client: AsyncClient, auth_headers: dict, db_session, seeded_item
) -> None:
    from apps.api.core.security import hash_password
    from apps.api.modules.lender.models import LenderPartner

    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "starter"},
        headers=auth_headers,
    )

    ghanafin = LenderPartner(
        lender_id="ghanafin",
        name="GhanaFin",
        api_key_hash=hash_password("ghana-key"),
        is_active=True,
    )
    otherfin = LenderPartner(
        lender_id="otherfin",
        name="OtherFin",
        api_key_hash=hash_password("other-key"),
        is_active=True,
    )
    db_session.add_all([ghanafin, otherfin])
    await db_session.flush()

    loan = await async_client.post(
        "/api/v1/credit/request",
        json={
            "amount_requested": "100.00",
            "term_days": 30,
            "target_lender_id": "ghanafin",
        },
        headers=auth_headers,
    )
    assert loan.status_code == 201
    assert loan.json()["lender_id"] == "ghanafin"

    ghana_token = await async_client.post(
        "/api/v1/lender/auth/token",
        json={"lender_id": "ghanafin", "api_key": "ghana-key"},
    )
    assert ghana_token.status_code == 200
    ghana_headers = {"Authorization": f"Bearer {ghana_token.json()['access_token']}"}

    other_token = await async_client.post(
        "/api/v1/lender/auth/token",
        json={"lender_id": "otherfin", "api_key": "other-key"},
    )
    assert other_token.status_code == 200
    other_headers = {"Authorization": f"Bearer {other_token.json()['access_token']}"}

    visible = await async_client.get("/api/v1/lender/loans", headers=ghana_headers)
    assert visible.status_code == 200
    assert [item["id"] for item in visible.json()] == [loan.json()["id"]]

    hidden = await async_client.get("/api/v1/lender/loans", headers=other_headers)
    assert hidden.status_code == 200
    assert hidden.json() == []


@pytest.mark.asyncio
async def test_loan_activation_records_lender_revenue_once(
    async_client: AsyncClient, db_session, seeded_business
) -> None:
    from sqlalchemy import func, select

    from apps.api.core.config import get_settings
    from apps.api.core.security import create_access_token
    from apps.api.modules.credit.models import CreditScore, LoanRequest, RepaymentInstalment
    from apps.api.modules.credit.service import CreditService
    from apps.api.modules.lender.models import LenderLoanRevenue

    business_id = seeded_business["business"].id
    score = CreditScore(
        business_id=business_id,
        score=Decimal("720.00"),
        band="B",
        max_loan_amount=Decimal("5000.00"),
        factors={},
    )
    db_session.add(score)
    await db_session.flush([score])
    loan = LoanRequest(
        business_id=business_id,
        credit_score_id=score.id,
        amount_requested=Decimal("1000.00"),
        amount_approved=Decimal("1000.00"),
        interest_rate=Decimal("5.00"),
        term_days=60,
        lender_id="ghanafin",
        status="disbursing",
        disbursement_phone="+233244000000",
    )
    db_session.add(loan)
    await db_session.flush([loan])

    svc = CreditService(db_session)
    await svc.mark_loan_active(loan.id, "momo-ref-1")
    await svc.mark_loan_active(loan.id, "momo-ref-1")

    revenue = (
        await db_session.execute(
            select(LenderLoanRevenue).where(LenderLoanRevenue.loan_request_id == loan.id)
        )
    ).scalar_one()
    assert revenue.principal_amount == Decimal("1000.00")
    assert revenue.fee_rate_percent == Decimal(
        str(get_settings().LENDER_ORIGINATION_FEE_RATE_PERCENT)
    )
    assert revenue.fee_amount == Decimal("20.00")
    assert revenue.status == "earned"

    schedule_count = (
        await db_session.execute(
            select(func.count(RepaymentInstalment.id)).where(
                RepaymentInstalment.loan_request_id == loan.id
            )
        )
    ).scalar_one()
    assert schedule_count == 2

    admin_headers = {
        "Authorization": (
            "Bearer "
            + create_access_token(
                user_id=seeded_business["user"].id,
                business_id=None,
                role="platform_admin",
            )
        )
    }
    listing = await async_client.get(
        "/api/v1/admin/lender-revenue?lender_id=ghanafin&status=earned",
        headers=admin_headers,
    )
    assert listing.status_code == 200
    assert listing.json()["total"] == 1

    summary = await async_client.get("/api/v1/admin/lender-revenue/summary", headers=admin_headers)
    assert summary.status_code == 200
    assert summary.json()["totals"]["earned_amount"] == 20.0

    paid = await async_client.post(
        f"/api/v1/admin/lender-revenue/{revenue.id}/mark-paid",
        headers=admin_headers,
    )
    assert paid.status_code == 200
    assert paid.json()["status"] == "paid"
