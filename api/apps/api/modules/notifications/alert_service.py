"""Actionable merchant alert lifecycle."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.modules.notifications.models import MerchantAlert


class MerchantAlertService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def upsert_alert(
        self,
        *,
        business_id: UUID,
        alert_type: str,
        severity: str,
        dedupe_key: str,
        title: str,
        message: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        action_path: str | None = None,
        action_label: str | None = None,
        recipient_user_id: UUID | None = None,
        recipient_role: str | None = None,
    ) -> MerchantAlert:
        alert = await self.db.scalar(
            select(MerchantAlert).where(
                MerchantAlert.business_id == business_id,
                MerchantAlert.dedupe_key == dedupe_key,
            )
        )
        now = datetime.now(timezone.utc)
        if alert:
            alert.alert_type = alert_type
            alert.severity = severity
            alert.title = title
            alert.message = message
            alert.resource_type = resource_type
            alert.resource_id = resource_id
            alert.action_path = action_path
            alert.action_label = action_label
            alert.recipient_user_id = recipient_user_id
            alert.recipient_role = recipient_role
            alert.status = "needs_attention"
            alert.resolved_at = None
            alert.dismissed_at = None
            alert.dismissal_reason = None
            alert.latest_at = now
            alert.occurrence_count += 1
        else:
            alert = MerchantAlert(
                business_id=business_id,
                recipient_user_id=recipient_user_id,
                recipient_role=recipient_role,
                alert_type=alert_type,
                severity=severity,
                dedupe_key=dedupe_key,
                title=title,
                message=message,
                resource_type=resource_type,
                resource_id=resource_id,
                action_path=action_path,
                action_label=action_label,
                latest_at=now,
            )
            self.db.add(alert)
        await self.db.flush([alert])
        if severity == "critical":
            await self._push_critical_alert(business_id, title, message)
        return alert

    async def list_alerts(
        self, business_id: UUID, user_id: UUID, role: str, view: str = "attention", limit: int = 50
    ) -> tuple[list[MerchantAlert], int]:
        statuses = ["resolved", "dismissed"] if view == "history" else ["needs_attention"]
        generic_scope = MerchantAlert.recipient_user_id.is_(None) & MerchantAlert.recipient_role.is_(None)
        if role == "owner":
            role_scope = generic_scope
        elif role == "manager":
            role_scope = generic_scope & (MerchantAlert.severity == "operational")
        else:
            role_scope = MerchantAlert.id.is_(None)
        recipient_filter = (
            role_scope
            | (MerchantAlert.recipient_user_id == user_id)
            | (MerchantAlert.recipient_role == role)
        )
        rows = (
            (
                await self.db.execute(
                    select(MerchantAlert)
                    .where(
                        MerchantAlert.business_id == business_id,
                        MerchantAlert.status.in_(statuses),
                        recipient_filter,
                    )
                    .order_by(MerchantAlert.latest_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        unread = sum(1 for row in rows if row.read_at is None) if view != "history" else 0
        return list(rows), unread

    async def get_alert(
        self,
        business_id: UUID,
        alert_id: UUID,
        user_id: UUID | None = None,
        role: str | None = None,
    ) -> MerchantAlert:
        alert = await self.db.scalar(
            select(MerchantAlert).where(
                MerchantAlert.id == alert_id, MerchantAlert.business_id == business_id
            )
        )
        if not alert or (user_id and role and not self._can_view(alert, user_id, role)):
            raise HTTPException(status_code=404, detail="Merchant alert not found")
        return alert

    async def _push_critical_alert(self, business_id: UUID, title: str, message: str) -> None:
        """Push critical alerts to the owner regardless of optional operational preferences."""
        from datetime import timedelta

        from apps.api.modules.business.models import Business
        from apps.api.modules.notifications.models import DeviceToken
        from apps.api.modules.notifications.service import (
            NotificationDispatcher,
            NotificationMessage,
        )

        owner_id = await self.db.scalar(select(Business.owner_id).where(Business.id == business_id))
        if not owner_id:
            return
        cutoff = datetime.now(timezone.utc) - timedelta(days=90)
        tokens = (
            (
                await self.db.execute(
                    select(DeviceToken.token).where(
                        DeviceToken.user_id == owner_id,
                        DeviceToken.is_active.is_(True),
                        DeviceToken.last_seen_at >= cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )
        dispatcher = NotificationDispatcher()
        for token in tokens:
            await dispatcher.send(
                NotificationMessage(phone="", text=f"{title}: {message}", device_token=token),
                channel="push",
            )

    async def mark_read(
        self, business_id: UUID, alert_id: UUID, user_id: UUID, role: str
    ) -> MerchantAlert:
        alert = await self.get_alert(business_id, alert_id, user_id, role)
        alert.read_at = alert.read_at or datetime.now(timezone.utc)
        await self.db.flush([alert])
        return alert

    async def dismiss(
        self, business_id: UUID, alert_id: UUID, user_id: UUID, role: str, reason: str
    ) -> MerchantAlert:
        alert = await self.get_alert(business_id, alert_id, user_id, role)
        now = datetime.now(timezone.utc)
        alert.status = "dismissed"
        alert.dismissed_at = now
        alert.read_at = alert.read_at or now
        alert.dismissal_reason = reason
        await self.db.flush([alert])
        return alert

    def _can_view(self, alert: MerchantAlert, user_id: UUID, role: str) -> bool:
        if alert.recipient_user_id == user_id or alert.recipient_role == role:
            return True
        if alert.recipient_user_id or alert.recipient_role:
            return False
        return role == "owner" or (role == "manager" and alert.severity == "operational")

    async def resolve(self, business_id: UUID, dedupe_key: str) -> MerchantAlert | None:
        alert = await self.db.scalar(
            select(MerchantAlert).where(
                MerchantAlert.business_id == business_id,
                MerchantAlert.dedupe_key == dedupe_key,
            )
        )
        if alert and alert.status == "needs_attention":
            alert.status = "resolved"
            alert.resolved_at = datetime.now(timezone.utc)
            await self.db.flush([alert])
        return alert
