"""Integration tests for system readiness checks."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_readiness_reports_schema_migration_required(async_client: AsyncClient, monkeypatch):
    async def missing_required_tables():
        return {"ok": False, "missing_tables": ["stock_reservations"]}

    monkeypatch.setattr("apps.api.main.check_required_schema_tables", missing_required_tables)

    resp = await async_client.get("/ready")

    assert resp.status_code == 503
    assert resp.json()["status"] == "degraded"
    assert resp.json()["schema"] == {
        "ok": False,
        "missing_tables": ["stock_reservations"],
    }
