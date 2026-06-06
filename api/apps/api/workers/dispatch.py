"""Small Celery dispatch wrapper for request-path side effects."""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any

import structlog

logger = structlog.get_logger()


def enqueue_task(task: Any, *args: Any, **kwargs: Any) -> Any:
    """
    Queue a Celery task unless pytest is running.

    Integration tests use an in-memory SQLite database and mocked providers, so
    sending real broker messages from request handlers only adds flaky retries.
    Unit tests that need dispatch behavior can monkeypatch this boundary.
    """
    if os.getenv("PYTEST_CURRENT_TEST"):
        logger.info("celery.dispatch.skipped_in_tests", task=getattr(task, "name", repr(task)))
        return None
    try:
        from apps.api.core.redis import RedisCache, get_redis

        task_name = getattr(task, "name", repr(task))
        raw = json.dumps(
            {"task": task_name, "args": args, "kwargs": kwargs}, sort_keys=True, default=str
        )
        fence = hashlib.sha256(raw.encode()).hexdigest()
        cache = RedisCache(get_redis(), prefix="task_dedupe")
        import asyncio

        async def _claim() -> bool:
            if await cache.exists(fence):
                return False
            await cache.set(fence, "1", ttl=300)
            return True

        try:
            asyncio.get_running_loop()
            claimed = True
        except RuntimeError:
            claimed = asyncio.run(_claim())
        if not claimed:
            logger.info("celery.dispatch.deduped", task=task_name)
            return None
    except Exception as exc:
        logger.warning("celery.dispatch.dedupe_unavailable", error=str(exc))
    return task.delay(*args, **kwargs)
