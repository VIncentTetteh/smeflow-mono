"""Database schema readiness checks used by API and deploy smoke tests."""

from collections.abc import Iterable

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncEngine

from apps.api.core.database import db_engine

REQUIRED_SCHEMA_TABLES = (
    "stock_reservations",
    "merchant_alerts",
    "customer_messages",
    "delivery_attempts",
)
REQUIRED_SCHEMA_COLUMNS = {
    "payments": ("processor", "channel", "provider_detail"),
    "invoices": ("due_date", "amount_paid", "balance_due"),
    "receivables": ("last_reminder_key",),
    "customers": (
        "reminder_consent",
        "reminder_channel",
        "reminder_consent_at",
        "reminder_consent_source",
        "reminder_opt_out_at",
    ),
}


async def check_required_schema_tables(
    required_tables: Iterable[str] = REQUIRED_SCHEMA_TABLES,
    engine: AsyncEngine = db_engine,
) -> dict[str, object]:
    """Return whether tables required by the currently deployed app exist."""

    async with engine.connect() as conn:
        def inspect_schema(sync_conn):
            inspector = inspect(sync_conn)
            missing_tables = [
                table for table in required_tables if not inspector.has_table(table)
            ]
            missing_columns = {
                table: [
                    column
                    for column in columns
                    if column not in {item["name"] for item in inspector.get_columns(table)}
                ]
                for table, columns in REQUIRED_SCHEMA_COLUMNS.items()
                if inspector.has_table(table)
            }
            return missing_tables, {k: v for k, v in missing_columns.items() if v}

        missing_tables, missing_columns = await conn.run_sync(inspect_schema)

    return {
        "ok": not missing_tables and not missing_columns,
        "missing_tables": missing_tables,
        "missing_columns": missing_columns,
    }


def is_missing_table_error(exc: Exception, table_name: str) -> bool:
    """Best-effort detection for dialect-specific missing-table DB errors."""

    message = str(exc).lower()
    table = table_name.lower()
    return table in message and (
        "does not exist" in message or "undefinedtable" in message or "no such table" in message
    )


def is_missing_column_error(exc: Exception, table_name: str, columns: Iterable[str]) -> bool:
    """Best-effort detection for dialect-specific missing-column DB errors."""

    message = str(exc).lower()
    return table_name.lower() in message and any(column.lower() in message for column in columns) and (
        "does not exist" in message
        or "undefinedcolumn" in message
        or "no such column" in message
        or "has no column" in message
    )
