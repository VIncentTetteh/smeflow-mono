"""
Audit logging — append-only record of every financial mutation.
The audit_logs table has UPDATE/DELETE revoked at the DB level.
"""

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()


async def audit(
    db: AsyncSession,
    action: str,
    resource_type: str,
    resource_id: UUID | None = None,
    user_id: UUID | None = None,
    business_id: UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> None:
    """
    Write an audit log entry. Never raises — failures are logged to Sentry.
    Import the AuditLog model here (lazy) to avoid circular imports.
    """
    try:
        from apps.api.modules.admin.models import AuditLog

        log = AuditLog(
            user_id=user_id,
            business_id=business_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            before_state=before,
            after_state=after,
            ip_address=ip_address,
        )
        db.add(log)
        # Flush but don't commit — commit happens in the outer transaction
        await db.flush([log])
    except Exception as exc:
        # Audit failure must NEVER break the main transaction
        logger.error("audit.write_failed", action=action, resource_type=resource_type, exc=str(exc))
