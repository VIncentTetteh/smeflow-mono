"""Integration tests for Phase 2 tax compliance APIs."""

from decimal import Decimal

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_tax_return_generation_listing_export_and_calendar(
    async_client: AsyncClient, auth_headers: dict
) -> None:
    await async_client.post(
        "/api/v1/billing/subscription/change",
        json={"plan": "pro"},
        headers=auth_headers,
    )

    invoice = await async_client.post(
        "/api/v1/invoices/generate",
        json={
            "invoice_type": "invoice",
            "line_items": [{"description": "Taxable sale", "qty": "1", "unit_price": "100.00"}],
        },
        headers=auth_headers,
    )
    assert invoice.status_code == 201

    generated = await async_client.post(
        "/api/v1/tax/returns/generate",
        json={"year": 2026, "month": 5},
        headers=auth_headers,
    )
    assert generated.status_code == 201
    data = generated.json()
    assert Decimal(data["vat_output"]) >= Decimal("15.00")
    assert data["payload_json"]["input_vat_source"] == "not_tracked"

    repeated = await async_client.post(
        "/api/v1/tax/returns/generate",
        json={"year": 2026, "month": 5},
        headers=auth_headers,
    )
    assert repeated.status_code == 201
    assert repeated.json()["id"] == data["id"]

    summary = await async_client.get(
        "/api/v1/tax/summary?period=monthly&year=2026&month=5",
        headers=auth_headers,
    )
    assert summary.status_code == 200
    summary_data = summary.json()
    assert summary_data["status"] == "draft"
    assert "estimated_vat_payable" in summary_data
    assert summary_data["due_date"] == "2026-06-30"
    assert "filing_readiness" in summary_data

    returns = await async_client.get("/api/v1/tax/returns", headers=auth_headers)
    assert returns.status_code == 200
    assert returns.json()[0]["id"] == data["id"]

    filed = await async_client.post(
        f"/api/v1/tax/returns/{data['id']}/file",
        headers=auth_headers,
    )
    assert filed.status_code == 200
    assert filed.json()["status"] == "exported"
    assert filed.json()["export_url"].startswith("local://tax-returns/")

    export = await async_client.get(
        f"/api/v1/tax/returns/{data['id']}/export",
        headers=auth_headers,
    )
    assert export.status_code == 200
    assert export.json()["payload"]["currency"] == "GHS"

    calendar = await async_client.get(
        "/api/v1/tax/calendar?year=2026&month=5",
        headers=auth_headers,
    )
    assert calendar.status_code == 200
    entries = {entry["tax_type"]: entry for entry in calendar.json()}
    assert entries["PAYE"]["due_date"] == "2026-06-15"
    assert entries["VAT"]["due_date"] == "2026-06-30"


@pytest.mark.asyncio
async def test_tax_summary_requires_pro_plan(async_client: AsyncClient, auth_headers: dict) -> None:
    resp = await async_client.get(
        "/api/v1/tax/summary?period=monthly&year=2026&month=5",
        headers=auth_headers,
    )

    assert resp.status_code == 402
    assert resp.json()["error"]["details"] == {
        "feature": "tax_summary",
        "required_plan": "pro",
    }
