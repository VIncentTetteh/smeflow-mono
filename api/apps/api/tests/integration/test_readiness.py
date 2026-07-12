"""Integration tests for system readiness checks."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_readiness_reports_schema_migration_required(async_client: AsyncClient, monkeypatch):
    async def missing_required_tables():
        return {"ok": False, "missing_tables": ["stock_reservations"]}

    async def db_ok():
        return True

    # /ready calls check_db_connection() against the real app-configured engine
    # (core.database.db_engine), not the SQLite session this test's async_client
    # is wired to — it's unreachable here, so db_ok would otherwise be False and
    # short-circuit straight to the {"missing_tables": ["unknown"]} fallback
    # without ever calling check_required_schema_tables at all.
    monkeypatch.setattr("apps.api.main.check_db_connection", db_ok)
    monkeypatch.setattr("apps.api.main.check_required_schema_tables", missing_required_tables)

    resp = await async_client.get("/ready")

    assert resp.status_code == 503
    assert resp.json()["status"] == "degraded"
    assert resp.json()["schema"] == {
        "ok": False,
        "missing_tables": ["stock_reservations"],
    }
