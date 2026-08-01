"""
Async SQLAlchemy engine + session factory.
All database interaction goes through AsyncSession obtained via get_db().
"""

import os
import sys
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncAttrs,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from apps.api.core.config import get_settings

settings = get_settings()

# Celery runs each task via a fresh `asyncio.run()` event loop, so a persistent
# async connection pool hands the 2nd+ task in a fork a connection bound to a
# closed loop ("got Future attached to a different loop"). Use NullPool in the
# worker (and in tests) so every session opens/closes its own connection within
# the current loop. The API keeps a real pool — it has one long-lived loop.
_running_under_celery = bool(sys.argv) and os.path.basename(sys.argv[0] or "").startswith(
    "celery"
)
_use_nullpool = settings.APP_ENV == "test" or _running_under_celery

engine_kwargs: dict[str, Any] = {
    "echo": settings.is_development,
    "pool_pre_ping": True,
}

if _use_nullpool:
    engine_kwargs["poolclass"] = NullPool
else:
    engine_kwargs.update(
        {
            "pool_size": settings.DATABASE_POOL_SIZE,
            "max_overflow": settings.DATABASE_MAX_OVERFLOW,
            "pool_recycle": settings.DATABASE_POOL_RECYCLE,
        }
    )

db_engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    db_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(AsyncAttrs, DeclarativeBase):
    """Base class for all ORM models."""

    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yields an async DB session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def check_db_connection() -> bool:
    """Health check — verifies DB connectivity."""
    try:
        async with db_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
