"""
Admin service — platform-level operations (cross-tenant).

All methods require the caller to have role == "platform_admin".
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.audit import audit
from apps.api.core.exceptions import ConflictError, NotFoundError
from apps.api.core.security import hash_password
from apps.api.modules.admin.models import AuditLog, PendingAdminAction, PlatformAdmin
from apps.api.modules.auth.models import User
from apps.api.modules.business.models import Business
from apps.api.modules.credit.models import CreditScore, LoanRequest
from apps.api.modules.payments.models import Payment
from apps.api.modules.sales.models import Sale

logger = structlog.get_logger()


class AdminService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Platform admin account management ────────────────────────────────────

    async def create_platform_admin(
        self,
        email: str,
        password: str,
        allowed_ips: list[str] | None = None,
        hashed_password: str | None = None,
    ) -> PlatformAdmin:
        """Create a new platform admin account.

        Intended for use from a secure CLI / seed script, not from a public
        endpoint.  The caller is responsible for ensuring only legitimate
        operators create admin accounts.
        """
        existing = (
            await self.db.execute(
                select(PlatformAdmin).where(PlatformAdmin.email == email.lower().strip())
            )
        ).scalar_one_or_none()
        if existing:
            raise ConflictError(f"Platform admin with email {email!r} already exists")

        admin = PlatformAdmin(
            email=email.lower().strip(),
            hashed_password=hashed_password or hash_password(password),
            allowed_ips=allowed_ips or [],
        )
        self.db.add(admin)
        await self.db.flush([admin])
        await audit(
            self.db,
            action="admin_created",
            resource_type="platform_admin",
            resource_id=admin.id,
            after={"email": admin.email, "allowed_ips": admin.allowed_ips},
        )
        logger.info("admin.created", admin_id=str(admin.id), email=admin.email)
        return admin

    async def deactivate_platform_admin(self, admin_id: UUID, actor_id: UUID) -> PlatformAdmin:
        """Deactivate a platform admin (soft-delete)."""
        admin = (
            await self.db.execute(select(PlatformAdmin).where(PlatformAdmin.id == admin_id))
        ).scalar_one_or_none()
        if not admin:
            raise NotFoundError("PlatformAdmin", str(admin_id))
        admin.is_active = False
        await self.db.flush([admin])
        await audit(
            self.db,
            action="admin_deactivated",
            resource_type="platform_admin",
            resource_id=admin.id,
            user_id=actor_id,
            before={"email": admin.email, "is_active": True},
            after={"email": admin.email, "is_active": False},
        )
        logger.warning("admin.deactivated", admin_id=str(admin_id), actor_id=str(actor_id))
        return admin

    # ── Two-person high-impact approvals ─────────────────────────────────────

    async def request_pending_action(
        self,
        action_type: str,
        payload: dict,
        actor_id: UUID,
        ttl_minutes: int = 15,
    ) -> PendingAdminAction:
        action = PendingAdminAction(
            action_type=action_type,
            payload=payload,
            requested_by=actor_id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes),
        )
        self.db.add(action)
        await self.db.flush([action])
        logger.info(
            "admin.pending_action_created",
            action_id=str(action.id),
            action_type=action_type,
            actor_id=str(actor_id),
        )
        return action

    async def approve_pending_action(self, action_id: UUID, approver_id: UUID) -> dict:
        action = (
            await self.db.execute(
                select(PendingAdminAction).where(PendingAdminAction.id == action_id)
            )
        ).scalar_one_or_none()
        if not action:
            raise NotFoundError("PendingAdminAction", str(action_id))
        if action.status != "pending":
            raise ConflictError(f"Pending action is already {action.status}")
        if action.requested_by == approver_id:
            raise ConflictError("A second platform admin must approve this action")
        now = datetime.now(timezone.utc)
        expires_at = action.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            action.status = "expired"
            await self.db.flush([action])
            raise ConflictError("Pending action expired")

        result: dict
        if action.action_type == "credit_override":
            payload = action.payload
            cs = await self.override_credit_score(
                UUID(payload["business_id"]),
                float(payload["score"]),
                str(payload["band"]),
                float(payload["max_loan_amount"]),
                approver_id,
            )
            result = {"credit_score_id": str(cs.id), "business_id": str(cs.business_id)}
        elif action.action_type == "lender_deactivate":
            from apps.api.modules.lender.service import LenderService

            partner, _api_key = await LenderService(self.db).update_partner(
                str(action.payload["lender_id"]),
                is_active=False,
            )
            result = {"lender_id": partner.lender_id, "is_active": partner.is_active}
        elif action.action_type == "admin_create":
            payload = action.payload
            admin = await self.create_platform_admin(
                str(payload["email"]),
                "",
                list(payload.get("allowed_ips") or []),
                hashed_password=str(payload["hashed_password"]),
            )
            await audit(
                self.db,
                action="admin_create_approved",
                resource_type="platform_admin",
                resource_id=admin.id,
                user_id=approver_id,
                after={"email": admin.email},
            )
            result = {"admin_id": str(admin.id), "email": admin.email}
        elif action.action_type == "admin_deactivate":
            admin = await self.deactivate_platform_admin(
                UUID(str(action.payload["admin_id"])),
                approver_id,
            )
            result = {"admin_id": str(admin.id), "email": admin.email, "is_active": admin.is_active}
        else:
            raise ConflictError(f"Unsupported pending action '{action.action_type}'")

        action.status = "approved"
        action.approved_by = approver_id
        action.approved_at = now
        await self.db.flush([action])
        return {"pending_action_id": str(action.id), "status": action.status, "result": result}

    # ── Business management ───────────────────────────────────────────────────

    async def list_businesses(
        self,
        limit: int = 50,
        offset: int = 0,
        search: str | None = None,
        is_active: bool | None = None,
    ) -> tuple[list[Business], int]:
        query = select(Business)
        count_query = select(func.count(Business.id))

        if search:
            like = f"%{search}%"
            query = query.where(Business.name.ilike(like))
            count_query = count_query.where(Business.name.ilike(like))
        if is_active is not None:
            query = query.where(Business.is_active == is_active)
            count_query = count_query.where(Business.is_active == is_active)

        total = (await self.db.execute(count_query)).scalar_one()
        businesses = (
            (
                await self.db.execute(
                    query.order_by(Business.created_at.desc()).limit(limit).offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(businesses), total

    async def business_detail(self, business_id: UUID) -> dict:
        """Full business detail for internal admin review."""
        from apps.api.modules.billing.models import Subscription
        from apps.api.modules.business.models import BusinessMember

        biz = await self._get_business(business_id)
        members = (
            (
                await self.db.execute(
                    select(BusinessMember).where(BusinessMember.business_id == business_id)
                )
            )
            .scalars()
            .all()
        )
        subscription = (
            await self.db.execute(
                select(Subscription).where(Subscription.business_id == business_id)
            )
        ).scalar_one_or_none()
        sales_count = (
            await self.db.execute(
                select(func.count(Sale.id)).where(
                    Sale.business_id == business_id,
                    Sale.status != "voided",
                )
            )
        ).scalar_one()
        tpv = (
            await self.db.execute(
                select(func.sum(Sale.total)).where(
                    Sale.business_id == business_id,
                    Sale.status != "voided",
                )
            )
        ).scalar_one() or 0
        return {
            "id": str(biz.id),
            "name": biz.name,
            "type": biz.type,
            "tin": biz.tin,
            "subscription": biz.subscription,
            "is_active": biz.is_active,
            "created_at": biz.created_at.isoformat(),
            "members": [
                {
                    "user_id": str(member.user_id),
                    "role": member.role,
                    "is_active": member.is_active,
                    "joined_at": member.joined_at.isoformat(),
                }
                for member in members
            ],
            "billing": {
                "plan": subscription.plan if subscription else biz.subscription,
                "status": subscription.status if subscription else "active",
                "current_period_end": subscription.current_period_end.isoformat()
                if subscription and subscription.current_period_end
                else None,
            },
            "sales": {"count": sales_count, "tpv_ghs": tpv},
        }

    # ── Loan review actions ──────────────────────────────────────────────────

    async def action_loan(
        self,
        loan_id: UUID,
        action: str,
        actor_id: UUID,
        reason: str | None = None,
    ) -> LoanRequest:
        """Apply an admin review action to a loan request and audit the change."""
        loan = (
            await self.db.execute(select(LoanRequest).where(LoanRequest.id == loan_id))
        ).scalar_one_or_none()
        if not loan:
            raise NotFoundError("LoanRequest", str(loan_id))

        before = {
            "status": loan.status,
            "amount_approved": str(loan.amount_approved) if loan.amount_approved else None,
            "interest_rate": str(loan.interest_rate) if loan.interest_rate else None,
            "term_days": loan.term_days,
            "rejection_reason": loan.rejection_reason,
        }

        now = datetime.now(timezone.utc)
        if action == "approve":
            if loan.status not in {"pending_partner", "pending"}:
                raise ConflictError(f"Loan is '{loan.status}', not pending approval")
            if loan.status == "pending_partner":
                loan.transition("approved")
            else:
                loan.status = "approved"
            loan.amount_approved = loan.amount_approved or loan.amount_requested
            loan.interest_rate = loan.interest_rate or Decimal("0.00")
            loan.term_days = loan.term_days or 30
            loan.decided_at = now
            audit_action = "admin.loan.approved"
        elif action == "reject":
            if loan.status not in {"pending_partner", "pending"}:
                raise ConflictError(f"Loan is '{loan.status}', not pending rejection")
            if not reason:
                raise ConflictError("A rejection reason is required")
            if loan.status == "pending_partner":
                loan.transition("rejected")
            else:
                loan.status = "rejected"
            loan.rejection_reason = reason
            loan.decided_at = now
            audit_action = "admin.loan.rejected"
        elif action == "flag":
            if not reason:
                raise ConflictError("A flag reason is required")
            await audit(
                self.db,
                action="admin.loan.flagged",
                resource_type="LoanRequest",
                resource_id=loan.id,
                user_id=actor_id,
                business_id=loan.business_id,
                before=before,
                after={"status": loan.status, "reason": reason},
            )
            return loan
        else:
            raise ConflictError(f"Unsupported loan action '{action}'")

        await self.db.flush([loan])
        await audit(
            self.db,
            action=audit_action,
            resource_type="LoanRequest",
            resource_id=loan.id,
            user_id=actor_id,
            business_id=loan.business_id,
            before=before,
            after={
                "status": loan.status,
                "amount_approved": str(loan.amount_approved) if loan.amount_approved else None,
                "interest_rate": str(loan.interest_rate) if loan.interest_rate else None,
                "term_days": loan.term_days,
                "reason": reason,
            },
        )
        return loan

    async def suspend_business(self, business_id: UUID, actor_id: UUID) -> Business:
        biz = await self._get_business(business_id)
        if not biz.is_active:
            raise ConflictError("Business is already suspended")
        biz.is_active = False
        await self.db.flush([biz])
        logger.info(
            "admin.business_suspended", business_id=str(business_id), actor_id=str(actor_id)
        )
        return biz

    async def unsuspend_business(self, business_id: UUID, actor_id: UUID) -> Business:
        biz = await self._get_business(business_id)
        if biz.is_active:
            raise ConflictError("Business is already active")
        biz.is_active = True
        await self.db.flush([biz])
        logger.info(
            "admin.business_unsuspended", business_id=str(business_id), actor_id=str(actor_id)
        )
        return biz

    # ── Credit score override ─────────────────────────────────────────────────

    async def override_credit_score(
        self,
        business_id: UUID,
        score: float,
        band: str,
        max_loan_amount: float,
        actor_id: UUID,
    ) -> CreditScore:
        from decimal import Decimal

        cs = CreditScore(
            business_id=business_id,
            score=Decimal(str(score)),
            band=band,
            max_loan_amount=Decimal(str(max_loan_amount)),
            factors={"manual_override": True, "overridden_by": str(actor_id)},
        )
        self.db.add(cs)
        await self.db.flush([cs])
        logger.info(
            "admin.credit_score_overridden",
            business_id=str(business_id),
            score=score,
            actor_id=str(actor_id),
        )
        return cs

    # ── Audit log browser ─────────────────────────────────────────────────────

    async def list_audit_logs(
        self,
        business_id: UUID | None = None,
        action: str | None = None,
        from_dt: datetime | None = None,
        to_dt: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[AuditLog], int]:
        query = select(AuditLog)
        count_query = select(func.count(AuditLog.id))

        if business_id is not None:
            query = query.where(AuditLog.business_id == business_id)
            count_query = count_query.where(AuditLog.business_id == business_id)
        if action:
            like = f"%{action}%"
            query = query.where(AuditLog.action.ilike(like))
            count_query = count_query.where(AuditLog.action.ilike(like))
        if from_dt:
            query = query.where(AuditLog.created_at >= from_dt)
            count_query = count_query.where(AuditLog.created_at >= from_dt)
        if to_dt:
            query = query.where(AuditLog.created_at <= to_dt)
            count_query = count_query.where(AuditLog.created_at <= to_dt)

        total = (await self.db.execute(count_query)).scalar_one()
        logs = (
            (
                await self.db.execute(
                    query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(logs), total

    async def list_transactions(
        self,
        business_id: UUID | None = None,
        payment_method: str | None = None,
        status: str | None = None,
        from_dt: datetime | None = None,
        to_dt: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Sale], int]:
        query = select(Sale)
        count_query = select(func.count(Sale.id))
        filters = []
        if business_id:
            filters.append(Sale.business_id == business_id)
        if payment_method:
            filters.append(Sale.payment_method == payment_method)
        if status:
            filters.append(Sale.status == status)
        if from_dt:
            filters.append(Sale.created_at >= from_dt)
        if to_dt:
            filters.append(Sale.created_at <= to_dt)
        if filters:
            query = query.where(*filters)
            count_query = count_query.where(*filters)

        total = (await self.db.execute(count_query)).scalar_one()
        rows = (
            (
                await self.db.execute(
                    query.order_by(Sale.created_at.desc()).limit(limit).offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(rows), total

    async def fraud_queue(
        self, lookback_minutes: int = 60, min_transactions: int = 20
    ) -> list[dict]:
        """Flag businesses with high transaction velocity in a recent window."""
        since = datetime.now(timezone.utc) - timedelta(minutes=lookback_minutes)
        rows = (
            await self.db.execute(
                select(
                    Business.id,
                    Business.name,
                    func.count(Sale.id).label("transaction_count"),
                    func.sum(Sale.total).label("tpv"),
                )
                .join(Sale, Sale.business_id == Business.id)
                .where(Sale.created_at >= since, Sale.status != "voided")
                .group_by(Business.id, Business.name)
                .having(func.count(Sale.id) >= min_transactions)
                .order_by(func.count(Sale.id).desc())
                .limit(100)
            )
        ).all()
        return [
            {
                "business_id": str(row.id),
                "business_name": row.name,
                "signal": "High transaction velocity",
                "detail": (
                    f"{row.transaction_count} transactions worth "
                    f"GH₵ {float(row.tpv or 0):,.2f} in {lookback_minutes} minutes"
                ),
                "severity": "high"
                if row.transaction_count >= max(min_transactions * 3, 60)
                else "med"
                if row.transaction_count >= max(min_transactions * 2, 40)
                else "low",
                "flagged_at": datetime.now(timezone.utc).isoformat(),
                "transaction_count": row.transaction_count,
                "tpv_ghs": float(row.tpv or 0),
                "lookback_minutes": lookback_minutes,
                "reason": "high_velocity_transactions",
            }
            for row in rows
        ]

    # ── Platform metrics ──────────────────────────────────────────────────────

    async def platform_metrics(self) -> dict:
        """High-level platform KPIs (admin dashboard)."""
        total_businesses = (await self.db.execute(select(func.count(Business.id)))).scalar_one()
        active_businesses = (
            await self.db.execute(
                select(func.count(Business.id)).where(Business.is_active.is_(True))
            )
        ).scalar_one()
        total_users = (await self.db.execute(select(func.count(User.id)))).scalar_one()
        total_sales = (
            await self.db.execute(select(func.count(Sale.id)).where(Sale.status != "voided"))
        ).scalar_one()
        total_revenue = (
            await self.db.execute(select(func.sum(Sale.total)).where(Sale.status != "voided"))
        ).scalar_one() or 0
        from apps.api.modules.billing.models import BillingTransaction

        subscription_revenue = (
            await self.db.execute(
                select(func.sum(BillingTransaction.amount)).where(
                    BillingTransaction.status == "success"
                )
            )
        ).scalar_one() or 0

        return {
            "total_businesses": total_businesses,
            "active_businesses": active_businesses,
            "suspended_businesses": total_businesses - active_businesses,
            "total_users": total_users,
            "total_sales": total_sales,
            "total_revenue_ghs": subscription_revenue,
            "tpv_ghs": total_revenue,
        }

    async def sync_queue(self) -> list[dict]:
        """Offline-originated sales grouped by business (last 24h)."""
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        rows = (
            await self.db.execute(
                select(
                    Business.id,
                    Business.name,
                    func.count(Sale.id).label("sales_count"),
                    func.sum(Sale.total).label("total_amount"),
                    func.max(Sale.created_at).label("latest_at"),
                )
                .join(Sale, Sale.business_id == Business.id)
                .where(
                    Sale.client_created_at.is_not(None),
                    Sale.created_at >= since,
                )
                .group_by(Business.id, Business.name)
                .order_by(func.max(Sale.created_at).desc())
                .limit(50)
            )
        ).all()
        return [
            {
                "id": f"SQ-{str(row.id)[:8].upper()}",
                "business_name": row.name,
                "sales_count": row.sales_count,
                "total_amount": float(row.total_amount or 0),
                "queued_at": row.latest_at.isoformat() if row.latest_at else None,
                "status": "synced",
            }
            for row in rows
        ]

    async def payment_settlements(self) -> list[dict]:
        """MoMo collection payments aggregated by provider per day (last 7 days)."""
        from sqlalchemy import Date, cast

        since = datetime.now(timezone.utc) - timedelta(days=7)
        rows = (
            await self.db.execute(
                select(
                    Payment.provider,
                    cast(Payment.created_at, Date).label("settle_date"),
                    func.sum(Payment.amount).label("total_amount"),
                    func.count(func.distinct(Payment.business_id)).label("business_count"),
                    func.max(Payment.status).label("status"),
                )
                .where(
                    Payment.type == "collection",
                    Payment.status == "success",
                    Payment.created_at >= since,
                )
                .group_by(Payment.provider, cast(Payment.created_at, Date))
                .order_by(cast(Payment.created_at, Date).desc(), Payment.provider)
                .limit(20)
            )
        ).all()
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        results = []
        for i, row in enumerate(rows):
            if row.settle_date == today:
                settled_label = f"Today {row.settle_date.strftime('%H:%M') if hasattr(row.settle_date, 'strftime') else '09:00'}"
            elif row.settle_date == yesterday:
                settled_label = "Yest. 09:00"
            else:
                settled_label = str(row.settle_date)
            results.append(
                {
                    "ref": f"SET-{8841 - i}",
                    "provider": row.provider.upper(),
                    "amount": float(row.total_amount or 0),
                    "businesses": row.business_count,
                    "status": "settled",
                    "settled_at": settled_label,
                }
            )
        return results

    # ── Private ───────────────────────────────────────────────────────────────

    async def _get_business(self, business_id: UUID) -> Business:
        result = await self.db.execute(select(Business).where(Business.id == business_id))
        biz = result.scalar_one_or_none()
        if not biz:
            raise NotFoundError("Business", str(business_id))
        return biz
