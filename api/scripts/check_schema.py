"""Deploy smoke check: database revision and required runtime tables."""

import asyncio
import json
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from apps.api.core.database import db_engine
from apps.api.core.schema import check_required_schema_tables


def _alembic_heads() -> set[str]:
    api_root = Path(__file__).resolve().parents[1]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "migrations"))
    return set(ScriptDirectory.from_config(config).get_heads())


async def _alembic_current() -> set[str]:
    try:
        async with db_engine.connect() as conn:
            rows = await conn.execute(text("SELECT version_num FROM alembic_version"))
            return {str(row[0]) for row in rows}
    except SQLAlchemyError:
        return set()


async def main() -> int:
    heads = _alembic_heads()
    current = await _alembic_current()
    revision_ok = current == heads
    schema = await check_required_schema_tables()
    ok = revision_ok and bool(schema["ok"])
    report = {
        "ok": ok,
        "alembic": {
            "ok": revision_ok,
            "current": sorted(current),
            "heads": sorted(heads),
        },
        "schema": schema,
    }
    print(json.dumps(report, sort_keys=True))
    await db_engine.dispose()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
