"""
Integration tests for the USSD callback and state machine.

Strategy:
- HTTP-layer tests go through the full FastAPI stack using async_client.
  USSDSession is monkeypatched so Redis is never called.
- State-machine tests call sm_handle / sm_handle_registration directly
  with a plain USSDSession instance and a patched save().
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from apps.api.modules.ussd.session import USSDSession
from apps.api.modules.ussd.state_machine import handle as sm_handle
from apps.api.modules.ussd.state_machine import handle_registration as sm_handle_registration

# ── Helpers ───────────────────────────────────────────────────────────────────

USSD_PATH = "/api/v1/ussd/callback"


def _form(session_id="sess-1", msisdn="+233244999001", user_data="", event_type="Initiation"):
    return {
        "SessionID": session_id,
        "MSISDN": msisdn,
        "UserData": user_data,
        "Type": event_type,
    }


def _make_session(
    session_id="sess-1",
    phone="+233244999001",
    business_id=None,
    user_id=None,
    state="MAIN_MENU",
) -> USSDSession:
    return USSDSession(
        session_id=session_id,
        phone=phone,
        business_id=business_id,
        user_id=user_id,
        state=state,
    )


# ── Router-layer tests (via HTTP) ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ussd_disabled_returns_end(async_client: AsyncClient, monkeypatch):
    """When ENABLE_USSD=False the callback must immediately END."""
    from apps.api.modules.ussd import router as ussd_router_mod

    monkeypatch.setattr(ussd_router_mod.get_settings(), "ENABLE_USSD", False)
    resp = await async_client.post(USSD_PATH, data=_form())
    assert resp.status_code == 200
    assert resp.text.startswith("END")


@pytest.mark.asyncio
async def test_ussd_invalid_signature_returns_end(async_client: AsyncClient, monkeypatch):
    """A bad HMAC signature must return END (not 403 — USSD gateways expect plain text)."""
    from apps.api.modules.ussd import router as ussd_router_mod

    # Enable USSD and set a secret so verification is active
    settings = ussd_router_mod.get_settings()
    monkeypatch.setattr(settings, "ENABLE_USSD", True)
    monkeypatch.setattr(settings, "USSD_CALLBACK_SECRET", "super-secret")

    resp = await async_client.post(
        USSD_PATH,
        data=_form(),
        headers={"X-Hubtel-Signature": "badhash"},
    )
    assert resp.status_code == 200
    assert resp.text.startswith("END")


@pytest.mark.asyncio
async def test_ussd_release_event_clears_session(async_client: AsyncClient, monkeypatch):
    """Release/Timeout events should delete the session and return END."""
    from apps.api.modules.ussd import router as ussd_router_mod

    monkeypatch.setattr(ussd_router_mod.get_settings(), "ENABLE_USSD", True)

    session = _make_session()
    deleted: list[bool] = []

    async def fake_get_or_create(sid, phone):
        return session

    async def fake_delete(self):
        deleted.append(True)

    with (
        patch.object(USSDSession, "get_or_create", new=AsyncMock(side_effect=fake_get_or_create)),
        patch.object(USSDSession, "delete", new=fake_delete),
    ):
        resp = await async_client.post(USSD_PATH, data=_form(event_type="Release"))

    assert resp.status_code == 200
    assert resp.text.startswith("END")
    assert deleted  # session.delete() was called


@pytest.mark.asyncio
async def test_ussd_unknown_phone_starts_registration(
    async_client: AsyncClient, monkeypatch, db_session
):
    """A phone not in the DB should enter the USSD registration flow."""
    from apps.api.modules.ussd import router as ussd_router_mod

    monkeypatch.setattr(ussd_router_mod.get_settings(), "ENABLE_USSD", True)

    # Phone number that doesn't exist in the test DB
    session = _make_session(phone="+233244000000")

    async def fake_get_or_create(sid, phone):
        return session

    async def fake_save(self):
        pass

    with (
        patch.object(USSDSession, "get_or_create", new=AsyncMock(side_effect=fake_get_or_create)),
        patch.object(USSDSession, "save", new=fake_save),
    ):
        resp = await async_client.post(USSD_PATH, data=_form(msisdn="+233244000000"))

    assert resp.status_code == 200
    assert resp.text.startswith("CON")
    assert "business name" in resp.text.lower() or "SME Flow" in resp.text


@pytest.mark.asyncio
async def test_ussd_known_phone_shows_main_menu(
    async_client: AsyncClient, monkeypatch, seeded_business
):
    """A known user with a business should see the main menu."""
    from apps.api.modules.ussd import router as ussd_router_mod

    monkeypatch.setattr(ussd_router_mod.get_settings(), "ENABLE_USSD", True)

    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(
        phone=user.phone,
        business_id=str(biz.id),
        user_id=str(user.id),
    )

    async def fake_get_or_create(sid, phone):
        return session

    async def fake_save(self):
        pass

    with (
        patch.object(USSDSession, "get_or_create", new=AsyncMock(side_effect=fake_get_or_create)),
        patch.object(USSDSession, "save", new=fake_save),
    ):
        resp = await async_client.post(USSD_PATH, data=_form(msisdn=user.phone, user_data=""))

    assert resp.status_code == 200
    assert resp.text.startswith("CON")
    assert "Record Sale" in resp.text
    assert "Credit Score" in resp.text  # option 6 must be visible


# ── State-machine direct tests ────────────────────────────────────────────────


@pytest.fixture
def noop_save(monkeypatch):
    """Patch USSDSession.save to a no-op so tests never touch Redis."""

    async def _save(self):
        pass

    monkeypatch.setattr(USSDSession, "save", _save)


@pytest.mark.asyncio
async def test_sm_main_menu_displayed_on_empty_input(db_session, noop_save, seeded_business):
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(business_id=str(biz.id), user_id=str(user.id))

    resp = await sm_handle(session, "", db_session)
    assert resp.startswith("CON")
    assert "Record Sale" in resp
    assert "Credit Score" in resp


@pytest.mark.asyncio
async def test_sm_record_sale_full_flow(db_session, noop_save, seeded_business, seeded_item):
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(business_id=str(biz.id), user_id=str(user.id))

    # Step 1: select "Record Sale"
    resp = await sm_handle(session, "1", db_session)
    assert session.state == "RECORD_SALE_ITEM"
    assert resp.startswith("CON")

    # Step 2: enter item name (fuzzy match against seeded_item "Test Tomatoes")
    resp = await sm_handle(session, "Test Tomatoes", db_session)
    assert session.state == "RECORD_SALE_QTY"
    assert resp.startswith("CON")

    # Step 3: enter quantity
    resp = await sm_handle(session, "2", db_session)
    assert session.state == "RECORD_SALE_PRICE"
    assert resp.startswith("CON")

    # Step 4: enter price
    resp = await sm_handle(session, "12.00", db_session)
    assert session.state == "RECORD_SALE_CONFIRM"
    assert resp.startswith("CON")
    assert "24.00" in resp  # 2 x 12.00

    # Step 5: confirm
    resp = await sm_handle(session, "1", db_session)
    assert resp.startswith("END")
    assert "recorded" in resp.lower() or "24.00" in resp
    assert session.state == "MAIN_MENU"


@pytest.mark.asyncio
async def test_sm_record_sale_cancel(db_session, noop_save, seeded_business, seeded_item):
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(
        business_id=str(biz.id),
        user_id=str(user.id),
        state="RECORD_SALE_CONFIRM",
    )
    session.data = {
        "item_name": "Test Tomatoes",
        "item_id": str(seeded_item.id),
        "qty": "2",
        "unit_price": "12.00",
        "total": "24.00",
    }

    resp = await sm_handle(session, "2", db_session)
    assert resp.startswith("END")
    assert "cancel" in resp.lower()
    assert session.state == "MAIN_MENU"


@pytest.mark.asyncio
async def test_sm_check_stock_found(db_session, noop_save, seeded_business, seeded_item):
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(business_id=str(biz.id), user_id=str(user.id))

    # Select "Check Stock"
    await sm_handle(session, "2", db_session)
    assert session.state == "CHECK_STOCK_ITEM"

    resp = await sm_handle(session, "Tomatoes", db_session)
    assert resp.startswith("END")
    assert "100" in resp  # seeded_item.current_stock = 100


@pytest.mark.asyncio
async def test_sm_check_stock_not_found(db_session, noop_save, seeded_business):
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(business_id=str(biz.id), user_id=str(user.id), state="CHECK_STOCK_ITEM")

    resp = await sm_handle(session, "nonexistent_item_xyz", db_session)
    assert resp.startswith("END")
    assert "not found" in resp.lower() or "nhuu" in resp.lower()


@pytest.mark.asyncio
async def test_sm_today_summary(db_session, noop_save, seeded_business):
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(business_id=str(biz.id), user_id=str(user.id))

    resp = await sm_handle(session, "3", db_session)
    assert resp.startswith("END")
    assert "Revenue" in resp or "Sika" in resp


@pytest.mark.asyncio
async def test_sm_outstanding_balances_empty(db_session, noop_save, seeded_business):
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(business_id=str(biz.id), user_id=str(user.id))

    resp = await sm_handle(session, "5", db_session)
    assert resp.startswith("END")
    # No receivables seeded — total should be 0
    assert "0.00" in resp


@pytest.mark.asyncio
async def test_sm_credit_score_none(db_session, noop_save, seeded_business):
    """Option 6 with no CreditScore record should return a 'none' message."""
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(business_id=str(biz.id), user_id=str(user.id))

    resp = await sm_handle(session, "6", db_session)
    assert resp.startswith("END")
    assert "score" in resp.lower() or "credit" in resp.lower()


@pytest.mark.asyncio
async def test_sm_credit_score_with_data(db_session, noop_save, seeded_business):
    """Option 6 with a CreditScore record should show the score, band, and max loan."""
    from datetime import datetime, timezone

    from apps.api.modules.credit.models import CreditScore

    biz = seeded_business["business"]
    user = seeded_business["user"]

    cs = CreditScore(
        business_id=biz.id,
        score=72,
        band="B",
        max_loan_amount=Decimal("5000.00"),
        computed_at=datetime.now(timezone.utc),
        factors={},
    )
    db_session.add(cs)
    await db_session.flush([cs])

    session = _make_session(business_id=str(biz.id), user_id=str(user.id))
    resp = await sm_handle(session, "6", db_session)
    assert resp.startswith("END")
    assert "72" in resp
    assert "5000" in resp


@pytest.mark.asyncio
async def test_sm_invalid_choice_returns_con(db_session, noop_save, seeded_business):
    biz = seeded_business["business"]
    user = seeded_business["user"]
    session = _make_session(business_id=str(biz.id), user_id=str(user.id))

    resp = await sm_handle(session, "9", db_session)
    assert resp.startswith("CON")


# ── Registration flow ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_registration_flow_creates_user_and_business(db_session, noop_save):
    """Full USSD registration creates a User + Business and transitions to main menu."""
    session = _make_session(phone="+233244888777")

    # Initiation — should ask for business name
    resp = await sm_handle_registration(session, "", db_session)
    assert resp.startswith("CON")
    assert session.state == "REGISTER_NAME"

    # Enter business name
    resp = await sm_handle_registration(session, "Ama's Shop", db_session)
    assert resp.startswith("CON")
    assert session.state == "REGISTER_TYPE"
    assert session.data.get("business_name") == "Ama's Shop"

    # Select business type (1 = market_stall)
    resp = await sm_handle_registration(session, "1", db_session)
    assert resp.startswith("CON")
    assert session.state == "REGISTER_ADDRESS"
    assert session.data.get("business_type") == "market_stall"

    # Enter address — completes registration
    resp = await sm_handle_registration(session, "Accra, Makola", db_session)
    assert "complete" in resp.lower() or "Registration" in resp or "Wɔahyehyɛ" in resp
    assert session.business_id is not None
    assert session.user_id is not None
    assert session.state == "MAIN_MENU"


@pytest.mark.asyncio
async def test_registration_invalid_type_re_prompts(db_session, noop_save):
    session = _make_session(phone="+233244777666", state="REGISTER_TYPE")
    session.data = {"business_name": "Test Biz"}

    resp = await sm_handle_registration(session, "9", db_session)
    assert resp.startswith("CON")
    # State should not advance past REGISTER_TYPE
    assert session.state == "REGISTER_TYPE"
