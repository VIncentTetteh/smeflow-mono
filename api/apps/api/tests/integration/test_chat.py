"""Integration tests for direct chat and WhatsApp Phase 1 flows."""

import json
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_direct_chat_records_sale_checks_stock_and_persists_history(
    async_client: AsyncClient, auth_headers: dict, seeded_item
):
    session_id = f"chat-{uuid4()}"

    sale_resp = await async_client.post(
        "/api/v1/chat/process",
        json={
            "message": "I sold 2 Test Tomatoes at 12 cedis",
            "session_id": session_id,
        },
        headers=auth_headers,
    )
    assert sale_resp.status_code == 200
    assert sale_resp.json()["intent"] == "record_sale"
    assert sale_resp.json()["entities"]["item_name"] == "test tomatoes"
    assert sale_resp.json()["entities"]["qty"] == 2.0
    assert sale_resp.json()["entities"]["unit_price"] == 12.0
    assert "sale.recorded" in sale_resp.json()["actions_taken"]

    stock_resp = await async_client.post(
        "/api/v1/chat/process",
        json={"message": "how many tomatoes do I have", "session_id": session_id},
        headers=auth_headers,
    )
    assert stock_resp.status_code == 200
    assert stock_resp.json()["intent"] == "check_stock"
    assert "98.0" in stock_resp.json()["reply"]

    history_resp = await async_client.get(
        f"/api/v1/chat/history?session_id={session_id}",
        headers=auth_headers,
    )
    assert history_resp.status_code == 200
    messages = history_resp.json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]


@pytest.mark.asyncio
async def test_direct_chat_refuses_sale_when_item_is_not_in_inventory(
    async_client: AsyncClient,
    auth_headers: dict,
    db_session,
):
    from sqlalchemy import func, select

    from apps.api.modules.sales.models import Sale

    before_count = await db_session.scalar(select(func.count(Sale.id)))

    sale_resp = await async_client.post(
        "/api/v1/chat/process",
        json={"message": "I sold 2 Dragon Fruit at 12 cedis"},
        headers=auth_headers,
    )

    assert sale_resp.status_code == 200
    data = sale_resp.json()
    assert data["intent"] == "record_sale"
    assert "sale.item_not_found" in data["actions_taken"]
    assert "did not record the sale" in data["reply"]

    after_count = await db_session.scalar(select(func.count(Sale.id)))
    assert after_count == before_count


@pytest.mark.asyncio
async def test_direct_chat_translates_selected_language_before_and_after_dispatch(
    async_client: AsyncClient,
    auth_headers: dict,
    seeded_item,
    monkeypatch,
):
    from apps.api.modules.chat import router as chat_router

    calls: list[tuple[str, str, str | None]] = []

    async def fake_translate(
        text: str, target_language: str, *, source_language: str | None = None
    ):
        calls.append((text, target_language, source_language))
        if target_language == "en":
            return "I sold 2 Test Tomatoes at 12 cedis"
        if target_language == "ak":
            return f"AK::{text}"
        return text

    monkeypatch.setattr(chat_router, "translate_text", fake_translate)

    response = await async_client.post(
        "/api/v1/chat/process",
        json={
            "message": "Metɔn Test Tomatoes mmienu 12 cedis",
            "language": "ak",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["intent"] == "record_sale"
    assert data["entities"]["item_name"] == "test tomatoes"
    assert data["reply"].startswith("AK::")
    assert calls[0] == ("Metɔn Test Tomatoes mmienu 12 cedis", "en", "ak")
    assert calls[-1][1:] == ("ak", "en")


@pytest.mark.asyncio
async def test_direct_chat_summaries_and_receivables(
    async_client: AsyncClient, auth_headers: dict, seeded_item
):
    credit_resp = await async_client.post(
        "/api/v1/sales/record",
        json={
            "items": [{"item_id": str(seeded_item.id), "qty": "3", "unit_price": "12.00"}],
            "payment_method": "credit",
            "customer_name": "Ama Owusu",
            "customer_phone": "+233200111222",
            "credit_due_date": "2026-12-31",
            "idempotency_key": str(uuid4()),
        },
        headers=auth_headers,
    )
    assert credit_resp.status_code == 201

    summary_resp = await async_client.post(
        "/api/v1/chat/process",
        json={"message": "show me today's sales"},
        headers=auth_headers,
    )
    assert summary_resp.status_code == 200
    assert summary_resp.json()["intent"] == "get_report"
    assert "Revenue" in summary_resp.json()["reply"]

    receivables_resp = await async_client.post(
        "/api/v1/chat/process",
        json={"message": "who owes me money"},
        headers=auth_headers,
    )
    assert receivables_resp.status_code == 200
    assert receivables_resp.json()["intent"] == "list_receivables"
    assert "Ama Owusu" in receivables_resp.json()["reply"]
    assert "36.00" in receivables_resp.json()["reply"]


@pytest.mark.asyncio
async def test_whatsapp_payload_lookup_dispatch_and_reply(db_session, seeded_business, monkeypatch):
    from apps.api.modules.chat import router as chat_router

    replies: list[tuple[str, str]] = []

    async def fake_send(to: str, text: str) -> None:
        replies.append((to, text))

    monkeypatch.setattr(chat_router, "_send_whatsapp_reply", fake_send)

    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": "233244999001",
                                    "type": "text",
                                    "text": {"body": "show me today's sales"},
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }

    await chat_router._process_whatsapp_payload(json.dumps(payload).encode(), db_session)

    assert replies
    assert replies[0][0] == "233244999001"
    assert "Summary" in replies[0][1]


@pytest.mark.asyncio
async def test_whatsapp_webhook_rejects_invalid_signature(async_client: AsyncClient, monkeypatch):
    from apps.api.modules.chat.router import settings

    monkeypatch.setattr(settings, "WHATSAPP_APP_SECRET", "secret")
    resp = await async_client.post(
        "/api/v1/chat/webhooks/whatsapp",
        content=b'{"entry":[]}',
        headers={"X-Hub-Signature-256": "sha256=bad"},
    )
    assert resp.status_code == 403
