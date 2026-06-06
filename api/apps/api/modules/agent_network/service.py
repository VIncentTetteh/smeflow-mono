"""Agent Network service."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.api.core.exceptions import ConflictError, NotFoundError
from apps.api.modules.agent_network.models import (
    COMMISSION_HOLD_HOURS,
    Agent,
    AgentApplication,
    AgentCommission,
    AgentPayoutBatch,
    CommissionRateConfig,
    OnboardingReferral,
)
from apps.api.modules.auth.models import User

logger = structlog.get_logger()

# Default commission rates (GHS) — used as fallback when DB config is absent
_DEFAULT_COMMISSION_RATES: dict[str, Decimal] = {
    "onboarding": Decimal("5.00"),
    "first_sale": Decimal("10.00"),
    "subscription_upgrade": Decimal("20.00"),
    "first_loan": Decimal("30.00"),
    "monthly_activity": Decimal("3.00"),
}

# Alias for backward-compat imports
COMMISSION_RATES = _DEFAULT_COMMISSION_RATES


class AgentNetworkService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Agent registration ────────────────────────────────────────────────────

    async def register_agent(
        self,
        user_id: UUID,
        region: str | None = None,
        district: str | None = None,
        momo_phone: str | None = None,
    ) -> Agent:
        # Prevent duplicate registration/application
        existing = await self.db.execute(select(Agent).where(Agent.user_id == user_id))
        if existing.scalar_one_or_none():
            raise ConflictError("User is already registered as an agent")
        existing_application = await self.db.execute(
            select(AgentApplication).where(
                AgentApplication.user_id == user_id,
                AgentApplication.status == "pending",
            )
        )
        if existing_application.scalar_one_or_none():
            raise ConflictError("User already has a pending agent application")

        # Verify user exists
        user = (await self.db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not user:
            raise NotFoundError("User", str(user_id))

        agent = Agent(
            user_id=user_id,
            region=region,
            district=district,
            momo_phone=momo_phone,
            is_active=True,
        )
        self.db.add(agent)
        await self.db.flush([agent])

        # Pre-create Paystack transfer recipient immediately so payout failures
        # surface at registration, not on payday
        if momo_phone:
            try:
                await self.ensure_recipient_code(agent)
            except Exception as exc:
                # Never block registration — just log; payout will retry lazily
                logger.warning(
                    "agent.recipient_code_prefetch_failed",
                    agent_id=str(agent.id),
                    error=str(exc),
                )

        logger.info(
            "agent.registered",
            agent_id=str(agent.id),
            user_id=str(user_id),
        )
        return agent

    async def approve_application(self, application_id: UUID, admin_id: UUID) -> Agent:
        from datetime import datetime, timezone

        application = (
            await self.db.execute(
                select(AgentApplication).where(AgentApplication.id == application_id)
            )
        ).scalar_one_or_none()
        if not application:
            raise NotFoundError("AgentApplication", str(application_id))
        if application.status != "pending":
            raise ConflictError(f"Agent application is already {application.status}")

        existing = await self.db.execute(select(Agent).where(Agent.user_id == application.user_id))
        if existing.scalar_one_or_none():
            raise ConflictError("User is already registered as an agent")

        agent = Agent(
            user_id=application.user_id,
            region=application.region,
            district=application.district,
            momo_phone=application.momo_phone,
            is_active=True,
        )
        application.status = "approved"
        application.reviewed_by = admin_id
        application.reviewed_at = datetime.now(timezone.utc)
        self.db.add(agent)
        await self.db.flush([application, agent])

        # Pre-create Paystack transfer recipient on approval
        if application.momo_phone:
            try:
                await self.ensure_recipient_code(agent)
            except Exception as exc:
                logger.warning(
                    "agent.recipient_code_prefetch_failed",
                    agent_id=str(agent.id),
                    error=str(exc),
                )

        logger.info(
            "agent.application_approved",
            application_id=str(application.id),
            agent_id=str(agent.id),
            admin_id=str(admin_id),
        )
        return agent

    async def reject_application(
        self, application_id: UUID, admin_id: UUID, reason: str | None = None
    ) -> AgentApplication:
        from datetime import datetime, timezone

        application = (
            await self.db.execute(
                select(AgentApplication).where(AgentApplication.id == application_id)
            )
        ).scalar_one_or_none()
        if not application:
            raise NotFoundError("AgentApplication", str(application_id))
        if application.status != "pending":
            raise ConflictError(f"Agent application is already {application.status}")
        application.status = "rejected"
        application.reviewed_by = admin_id
        application.reviewed_at = datetime.now(timezone.utc)
        application.rejection_reason = reason
        await self.db.flush([application])
        return application

    async def list_applications(
        self, status: str | None = "pending", limit: int = 50, offset: int = 0
    ) -> tuple[list[AgentApplication], int]:
        query = select(AgentApplication)
        count_query = select(func.count(AgentApplication.id))
        if status:
            query = query.where(AgentApplication.status == status)
            count_query = count_query.where(AgentApplication.status == status)
        total = (await self.db.execute(count_query)).scalar_one()
        rows = (
            (
                await self.db.execute(
                    query.order_by(AgentApplication.created_at.desc()).limit(limit).offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(rows), total

    # ── Merchant onboarding attribution ──────────────────────────────────────

    async def attribute_onboarding(
        self,
        agent_id: UUID,
        business_id: UUID,
        channel: str = "field",
        referral_code: str | None = None,
    ) -> OnboardingReferral:
        agent = await self._get_agent(agent_id)

        # Check not already attributed
        existing = await self.db.execute(
            select(OnboardingReferral).where(OnboardingReferral.business_id == business_id)
        )
        if existing.scalar_one_or_none():
            raise ConflictError("Business already attributed to an agent")

        referral = OnboardingReferral(
            agent_id=agent_id,
            business_id=business_id,
            channel=channel,
            referral_code=referral_code,
        )
        self.db.add(referral)
        await self.db.flush([referral])

        # Increment agent counter
        agent.onboarded_count = (agent.onboarded_count or 0) + 1
        await self.db.flush([agent])

        # Create commission
        await self._create_commission(agent_id, business_id, "onboarding")
        logger.info(
            "agent.onboarding_attributed", agent_id=str(agent_id), business_id=str(business_id)
        )
        return referral

    async def get_or_attribute_onboarding(
        self,
        agent_id: UUID,
        business_id: UUID,
        channel: str = "field",
        referral_code: str | None = None,
    ) -> OnboardingReferral:
        existing = await self.db.execute(
            select(OnboardingReferral).where(OnboardingReferral.business_id == business_id)
        )
        referral = existing.scalar_one_or_none()
        if referral:
            return referral
        return await self.attribute_onboarding(agent_id, business_id, channel, referral_code)

    # ── Commission management ─────────────────────────────────────────────────

    async def trigger_commission(
        self, agent_id: UUID, business_id: UUID, trigger: str
    ) -> AgentCommission | None:
        rate = await self.get_commission_rate(trigger)
        if rate == Decimal("0.00"):
            return None
        return await self._create_commission(agent_id, business_id, trigger)

    async def trigger_activation_commission(
        self, business_id: UUID, trigger: str
    ) -> AgentCommission | None:
        """Create one activation commission for an attributed merchant and trigger."""
        from datetime import datetime, timezone

        referral = (
            await self.db.execute(
                select(OnboardingReferral).where(OnboardingReferral.business_id == business_id)
            )
        ).scalar_one_or_none()
        if not referral:
            return None

        existing = (
            await self.db.execute(
                select(AgentCommission).where(
                    AgentCommission.agent_id == referral.agent_id,
                    AgentCommission.business_id == business_id,
                    AgentCommission.trigger == trigger,
                )
            )
        ).scalar_one_or_none()
        if existing:
            return None

        rate = await self.get_commission_rate(trigger)
        if rate == Decimal("0.00"):
            return None

        commission = await self._create_commission(referral.agent_id, business_id, trigger)
        referral.status = trigger if trigger in {"first_sale", "first_loan"} else "active"
        referral.activated_at = referral.activated_at or datetime.now(timezone.utc)
        await self.db.flush([referral])
        return commission

    async def list_commissions(
        self,
        agent_id: UUID,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[AgentCommission], int]:
        query = select(AgentCommission).where(AgentCommission.agent_id == agent_id)
        count_query = select(func.count(AgentCommission.id)).where(
            AgentCommission.agent_id == agent_id
        )

        if status:
            query = query.where(AgentCommission.status == status)
            count_query = count_query.where(AgentCommission.status == status)

        total = (await self.db.execute(count_query)).scalar_one()
        commissions = (
            (
                await self.db.execute(
                    query.order_by(AgentCommission.created_at.desc()).limit(limit).offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(commissions), total

    # ── Agent dashboard ───────────────────────────────────────────────────────

    async def agent_dashboard(self, agent_id: UUID) -> dict:
        agent = await self._get_agent(agent_id)

        # Pending commissions
        pending_result = await self.db.execute(
            select(func.sum(AgentCommission.amount)).where(
                AgentCommission.agent_id == agent_id,
                AgentCommission.status == "pending",
            )
        )
        pending_amount = pending_result.scalar_one() or Decimal("0")

        # Recent referrals
        referrals_result = await self.db.execute(
            select(func.count(OnboardingReferral.id)).where(OnboardingReferral.agent_id == agent_id)
        )
        total_referrals = referrals_result.scalar_one() or 0

        return {
            "agent_id": str(agent.id),
            "region": agent.region,
            "district": agent.district,
            "is_active": agent.is_active,
            "onboarded_count": agent.onboarded_count,
            "total_commission_earned": agent.total_commission_earned,
            "pending_commission": pending_amount,
            "total_referrals": total_referrals,
        }

    # ── Commission period summary ─────────────────────────────────────────────

    async def commission_period_summary(
        self,
        agent_id: UUID,
        year: int,
        month: int,
    ) -> dict:
        """Return commission totals broken down by trigger for a calendar month."""
        from calendar import monthrange
        from datetime import date

        _, last_day = monthrange(year, month)
        period_start = date(year, month, 1)
        period_end = date(year, month, last_day)

        rows = (
            await self.db.execute(
                select(
                    AgentCommission.trigger,
                    AgentCommission.status,
                    func.count(AgentCommission.id).label("count"),
                    func.sum(AgentCommission.amount).label("total"),
                )
                .where(
                    AgentCommission.agent_id == agent_id,
                    func.date(AgentCommission.created_at) >= period_start,
                    func.date(AgentCommission.created_at) <= period_end,
                )
                .group_by(AgentCommission.trigger, AgentCommission.status)
            )
        ).all()

        from decimal import Decimal as _Dec

        by_trigger: dict[str, dict] = {}
        grand_total = _Dec("0")
        pending_total = _Dec("0")
        for row in rows:
            key = row.trigger
            if key not in by_trigger:
                by_trigger[key] = {"paid": _Dec("0"), "pending": _Dec("0"), "count": 0}
            by_trigger[key][row.status if row.status in ("paid", "pending") else "other"] = (
                row.total or _Dec("0")
            )
            by_trigger[key]["count"] += row.count
            grand_total += row.total or _Dec("0")
            if row.status == "pending":
                pending_total += row.total or _Dec("0")

        return {
            "agent_id": str(agent_id),
            "period": f"{year}-{month:02d}",
            "grand_total": grand_total,
            "pending_total": pending_total,
            "by_trigger": by_trigger,
        }

    async def mark_commissions_paid(
        self,
        agent_id: UUID,
        commission_ids: list[UUID],
    ) -> int:
        """Mark a list of pending commissions as paid (legacy — agent-scoped).

        Deprecated in favour of mark_commissions_paid_by_admin which enforces
        platform_admin authorisation and records who/how.  Kept for internal
        use by Celery auto-payout tasks.
        """
        return await self.mark_commissions_paid_by_admin(
            commission_ids, admin_id=None, paid_via="momo", agent_id=agent_id
        )

    async def mark_commissions_paid_by_admin(
        self,
        commission_ids: list[UUID],
        admin_id: UUID | None,
        paid_via: str = "manual",
        agent_id: UUID | None = None,
    ) -> int:
        """Mark commissions paid — must be called by a platform_admin.

        admin_id:    platform_admin UUID who authorised the payment.
        paid_via:    'momo' | 'manual' | 'bank'
        agent_id:    when provided, restricts to commissions owned by that agent
                     (used by the auto-payout Celery task).

        Returns count of rows updated.
        """
        from datetime import datetime, timezone

        from sqlalchemy import update

        filters = [
            AgentCommission.id.in_(commission_ids),
            AgentCommission.status == "pending",
        ]
        if agent_id:
            filters.append(AgentCommission.agent_id == agent_id)

        values: dict = {
            "status": "paid",
            "paid_at": datetime.now(timezone.utc),
            "paid_via": paid_via,
        }
        if admin_id:
            values["paid_by"] = admin_id

        result = await self.db.execute(
            update(AgentCommission).where(*filters).values(**values).returning(AgentCommission.id)
        )
        updated = len(result.all())
        logger.info(
            "agent.commissions_marked_paid",
            count=updated,
            admin_id=str(admin_id) if admin_id else "auto",
            paid_via=paid_via,
        )
        return updated

    # ── Commission rate configuration ─────────────────────────────────────────────

    async def get_commission_rate(self, event_type: str) -> Decimal:
        """Fetch commission rate from DB config, fall back to built-in default."""
        result = await self.db.execute(
            select(CommissionRateConfig).where(CommissionRateConfig.event_type == event_type)
        )
        config = result.scalar_one_or_none()
        return config.rate if config else _DEFAULT_COMMISSION_RATES.get(event_type, Decimal("0.00"))

    async def upsert_commission_rate(
        self, event_type: str, rate: Decimal, updated_by: str = ""
    ) -> CommissionRateConfig:
        """Create or update a commission rate config entry."""
        result = await self.db.execute(
            select(CommissionRateConfig).where(CommissionRateConfig.event_type == event_type)
        )
        config = result.scalar_one_or_none()
        if config:
            config.rate = rate
            config.updated_by = updated_by
        else:
            config = CommissionRateConfig(event_type=event_type, rate=rate, updated_by=updated_by)
            self.db.add(config)
        await self.db.flush()
        return config

    async def list_commission_rates(self) -> list[CommissionRateConfig]:
        """Return all commission rate configs."""
        result = await self.db.execute(
            select(CommissionRateConfig).order_by(CommissionRateConfig.event_type)
        )
        return list(result.scalars().all())

    # ── List all agents (admin view) ──────────────────────────────────────────

    async def list_agents(
        self,
        region: str | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Agent], int]:
        query = select(Agent)
        count_query = select(func.count(Agent.id))

        if region:
            query = query.where(Agent.region == region)
            count_query = count_query.where(Agent.region == region)
        if search:
            like = f"%{search}%"
            query = query.join(User, User.id == Agent.user_id).where(
                (User.name.ilike(like)) | (User.phone.ilike(like))
            )
            count_query = count_query.join(User, User.id == Agent.user_id).where(
                (User.name.ilike(like)) | (User.phone.ilike(like))
            )

        total = (await self.db.execute(count_query)).scalar_one()
        agents = (
            (
                await self.db.execute(
                    query.order_by(Agent.total_commission_earned.desc()).limit(limit).offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(agents), total

    # ── Bulk onboarding ───────────────────────────────────────────────────────

    async def bulk_onboard_traders(
        self,
        agent_id: UUID,
        traders: list[dict],
    ) -> dict:
        """
        Onboard multiple traders in a single call.

        Each item in *traders* should be::

            {"phone": str, "name": str | None, "business_name": str,
             "business_type": str, "address": str | None, "referral_code": str | None}

        Returns a summary: {"created": [...], "skipped": [...], "errors": [...]}.
        """
        from apps.api.core.phone import normalize_ghana_phone
        from apps.api.modules.auth.repository import UserRepository
        from apps.api.modules.business.schemas import BusinessCreate
        from apps.api.modules.business.service import BusinessService

        agent = await self._get_agent(agent_id)
        created, errors = [], []

        for raw in traders:
            phone_raw = raw.get("phone", "")
            try:
                phone = normalize_ghana_phone(phone_raw)
            except Exception:
                errors.append({"phone": phone_raw, "reason": "invalid_phone"})
                continue

            try:
                user_repo = UserRepository(self.db)
                user = await user_repo.get_by_phone(phone)
                is_new_user = user is None
                if not user:
                    user = await user_repo.create(phone=phone, name=raw.get("name"))
                elif raw.get("name") and not user.name:
                    user = await user_repo.update(user, name=raw["name"])

                biz_create = BusinessCreate(
                    name=raw["business_name"],
                    type=raw.get("business_type", "other"),
                    address=raw.get("address"),
                    onboarding_channel="agent_bulk",
                )
                business_svc = BusinessService(self.db)
                business, _token = await business_svc.create_business(user.id, biz_create)

                referral = await self.get_or_attribute_onboarding(
                    agent_id, business.id, "field", raw.get("referral_code")
                )

                agent.onboarded_count = (agent.onboarded_count or 0) + (1 if is_new_user else 0)
                created.append(
                    {
                        "phone": phone,
                        "business_id": str(business.id),
                        "user_id": str(user.id),
                        "referral_id": str(referral.id),
                        "is_new_user": is_new_user,
                    }
                )
                logger.info("agent.bulk_onboard.item_ok", phone=phone, business_id=str(business.id))

            except Exception as exc:
                await self.db.rollback()
                errors.append({"phone": phone_raw, "reason": str(exc)})
                logger.warning("agent.bulk_onboard.item_failed", phone=phone_raw, error=str(exc))

        await self.db.flush([agent])
        return {
            "created": created,
            "errors": errors,
            "total_created": len(created),
            "total_errors": len(errors),
        }

    async def payout_commissions_via_paystack(self, commission_ids: list[UUID]) -> dict:
        """
        Pay out pending agent commissions via Paystack Bulk Transfer.

        Creates Paystack transfer recipients for agents if not already stored,
        batches into groups of 100, fires bulk_transfer calls, and marks paid.
        Returns a summary dict.
        """
        from datetime import datetime, timezone

        from libs.payment_clients.paystack import PaystackClient

        commissions_result = await self.db.execute(
            select(AgentCommission)
            .where(AgentCommission.id.in_(commission_ids), AgentCommission.status == "pending")
            .options(selectinload(AgentCommission.agent))
        )
        pending = list(commissions_result.scalars().all())
        if not pending:
            return {"error": "No pending commissions found", "sent": 0}

        client = PaystackClient()
        transfers: list[dict] = []
        commission_map: dict[str, AgentCommission] = {}
        skipped: list[str] = []

        for commission in pending:
            agent = commission.agent
            phone = agent.momo_phone
            if not phone:
                skipped.append(str(agent.id))
                continue

            if not agent.paystack_recipient_code:
                try:
                    recipient_code = await client._get_or_create_recipient(phone)
                    agent.paystack_recipient_code = recipient_code
                    await self.db.flush([agent])
                except Exception as exc:
                    logger.warning(
                        "agent.commission.recipient_failed",
                        agent_id=str(agent.id),
                        error=str(exc),
                    )
                    skipped.append(str(agent.id))
                    continue

            ref = f"commission-{commission.id}"
            transfers.append(
                {
                    "amount_ghs": commission.amount,
                    "recipient_code": agent.paystack_recipient_code,
                    "reference": ref,
                    "reason": "SMEflow agent commission",
                }
            )
            commission_map[ref] = commission

        errors: list[str] = []
        total_sent = 0
        now = datetime.now(timezone.utc)

        for i in range(0, len(transfers), 100):
            batch = transfers[i : i + 100]
            try:
                await client.bulk_transfer(batch)
                for item in batch:
                    commission = commission_map[item["reference"]]
                    commission.status = "paid"
                    commission.paid_at = now
                    commission.paid_via = "paystack_bulk"
                    commission.agent.total_commission_earned = (
                        commission.agent.total_commission_earned or Decimal("0")
                    ) + commission.amount
                total_sent += len(batch)
                logger.info(
                    "agent.commission.bulk_transfer_sent",
                    batch=i // 100 + 1,
                    count=len(batch),
                )
            except Exception as exc:
                err = str(exc)
                errors.append(f"batch {i // 100 + 1}: {err}")
                logger.error(
                    "agent.commission.bulk_transfer_failed",
                    batch=i // 100 + 1,
                    error=err,
                )

        await self.db.flush()
        return {
            "total_commissions": len(pending),
            "sent": total_sent,
            "skipped": skipped,
            "batch_errors": errors,
        }

    async def bulk_commission_payout(
        self, agent_id: UUID, commission_ids: list[UUID], payout_method: str = "momo"
    ) -> dict:
        """
        Bulk payout multiple commissions for an agent.
        Phase 4: Enhanced bulk operations.
        """
        from datetime import datetime, timezone

        # Get agent details
        agent = await self._get_agent(agent_id)

        # Get pending commissions
        commissions = await self.db.execute(
            select(AgentCommission).where(
                AgentCommission.id.in_(commission_ids),
                AgentCommission.agent_id == agent_id,
                AgentCommission.status == "pending",
            )
        )
        pending_commissions = commissions.scalars().all()

        if not pending_commissions:
            return {"error": "No pending commissions found", "updated": 0}

        # Calculate total payout
        total_amount = sum(c.amount for c in pending_commissions)

        # Mark as paid
        now = datetime.now(timezone.utc)
        for commission in pending_commissions:
            commission.status = "paid"
            commission.paid_at = now
            commission.paid_via = payout_method

        await self.db.flush()

        # Update agent totals
        agent.total_commission_earned = (
            agent.total_commission_earned or Decimal("0")
        ) + total_amount

        return {
            "updated": len(pending_commissions),
            "total_amount": total_amount,
            "payout_method": payout_method,
            "agent_id": str(agent_id),
        }

    async def get_bulk_onboarding_template(self) -> dict:
        """
        Return template for bulk onboarding CSV/Excel format.
        Phase 4: Enhanced bulk operations.
        """
        return {
            "columns": [
                {
                    "name": "phone",
                    "required": True,
                    "description": "Customer phone number (+233XXXXXXXXX)",
                },
                {"name": "name", "required": False, "description": "Customer name"},
                {"name": "business_name", "required": True, "description": "Business/trader name"},
                {
                    "name": "business_type",
                    "required": False,
                    "description": "Type: shop, stall, artisan, etc.",
                },
                {"name": "address", "required": False, "description": "Business address"},
                {
                    "name": "referral_code",
                    "required": False,
                    "description": "Optional referral code",
                },
            ],
            "sample_data": [
                {
                    "phone": "+233244123456",
                    "name": "Kofi Asante",
                    "business_name": "Kofi's Electronics",
                    "business_type": "shop",
                    "address": "Accra Central Market",
                    "referral_code": "AGENT001",
                }
            ],
            "validation_rules": {
                "phone": "Must start with +233 and be 13 digits",
                "business_name": "Must be unique per customer",
                "business_type": "Must be one of: shop, stall, artisan, market, other",
            },
        }

    # ── Trader list (for agent dashboard) ────────────────────────────────────

    async def get_trader_list(
        self,
        agent_id: UUID,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Return a page of traders onboarded by this agent, with business info."""

        from apps.api.modules.business.models import Business

        query = (
            select(OnboardingReferral, Business)
            .join(Business, Business.id == OnboardingReferral.business_id)
            .where(OnboardingReferral.agent_id == agent_id)
        )
        count_query = select(func.count(OnboardingReferral.id)).where(
            OnboardingReferral.agent_id == agent_id
        )

        if status:
            query = query.where(OnboardingReferral.status == status)
            count_query = count_query.where(OnboardingReferral.status == status)

        total = (await self.db.execute(count_query)).scalar_one()
        rows = (
            await self.db.execute(
                query.order_by(OnboardingReferral.created_at.desc()).limit(limit).offset(offset)
            )
        ).all()

        items = [
            {
                "referral_id": str(r.OnboardingReferral.id),
                "business_id": str(r.OnboardingReferral.business_id),
                "business_name": r.Business.name,
                "business_type": r.Business.type,
                "status": r.OnboardingReferral.status,
                "channel": r.OnboardingReferral.channel,
                "activated_at": r.OnboardingReferral.activated_at.isoformat()
                if r.OnboardingReferral.activated_at
                else None,
                "created_at": r.OnboardingReferral.created_at.isoformat(),
            }
            for r in rows
        ]
        return items, total

    # ── Private ───────────────────────────────────────────────────────────────

    async def _get_agent(self, agent_id: UUID) -> Agent:
        result = await self.db.execute(select(Agent).where(Agent.id == agent_id))
        agent = result.scalar_one_or_none()
        if not agent:
            raise NotFoundError("Agent", str(agent_id))
        return agent

    async def _create_commission(
        self, agent_id: UUID, business_id: UUID, trigger: str
    ) -> AgentCommission:
        amount = await self.get_commission_rate(trigger)
        now = datetime.now(timezone.utc)
        available_at = now + timedelta(hours=COMMISSION_HOLD_HOURS)

        commission = AgentCommission(
            agent_id=agent_id,
            business_id=business_id,
            trigger=trigger,
            amount=amount,
            status="pending",
            available_at=available_at,
        )
        self.db.add(commission)

        # Update running totals on agent — increment pending_balance during hold
        agent = await self._get_agent(agent_id)
        agent.total_commission_earned = (agent.total_commission_earned or Decimal("0")) + amount
        agent.pending_balance = (agent.pending_balance or Decimal("0")) + amount
        await self.db.flush([commission, agent])
        logger.info(
            "agent.commission_created",
            agent_id=str(agent_id),
            trigger=trigger,
            amount=str(amount),
            available_at=available_at.isoformat(),
        )

        # Notify the agent of their earned commission via their own business.
        # Failure must never break commission creation.
        try:
            from apps.api.modules.business.models import Business
            from apps.api.modules.notifications.service import NotificationService

            agent_biz_result = await self.db.execute(
                select(Business).where(Business.owner_id == agent.user_id).limit(1)
            )
            agent_business = agent_biz_result.scalar_one_or_none()
            if agent_business:
                trigger_label = trigger.replace("_", " ")
                msg = (
                    f"You earned GHc {float(amount):.2f} commission for {trigger_label}. "
                    f"Funds available for payout after {COMMISSION_HOLD_HOURS}h."
                )
                await NotificationService(self.db).dispatch_event(
                    business_id=agent_business.id,
                    event_type="commission_earned",
                    data={"message": msg, "amount": str(amount), "trigger": trigger},
                )
        except Exception:
            logger.warning("notification.dispatch_failed", event_type="commission_earned")

        return commission

    # ── Virtual wallet ────────────────────────────────────────────────────────

    async def get_agent_wallet(self, agent_id: UUID) -> dict:
        """
        Return wallet summary for an agent:
          pending_balance, available_balance, total_paid_out,
          last_payout_at, next_payout_date, payout_threshold
        """

        agent = await self._get_agent(agent_id)

        # Next Friday at 10:00 WAT
        now = datetime.now(timezone.utc)
        days_until_friday = (4 - now.weekday()) % 7  # Monday=0, Friday=4
        if days_until_friday == 0 and now.hour >= 10:
            days_until_friday = 7  # already past today's payout window
        next_friday = (now + timedelta(days=days_until_friday)).replace(
            hour=10, minute=0, second=0, microsecond=0
        )

        return {
            "agent_id": str(agent_id),
            "pending_balance": str(agent.pending_balance or Decimal("0")),
            "available_balance": str(agent.available_balance or Decimal("0")),
            "total_paid_out": str(agent.total_paid_out or Decimal("0")),
            "total_commission_earned": str(agent.total_commission_earned or Decimal("0")),
            "last_payout_at": agent.last_payout_at.isoformat() if agent.last_payout_at else None,
            "next_payout_date": next_friday.isoformat(),
            "payout_threshold": str(agent.payout_threshold or Decimal("10.00")),
            "eligible_for_payout": (agent.available_balance or Decimal("0"))
            >= (agent.payout_threshold or Decimal("10.00")),
        }

    async def release_commissions_from_hold(self) -> int:
        """
        Move commissions past their 48h hold period from pending → available.
        Updates agent.pending_balance and agent.available_balance accordingly.
        Called hourly by Celery Beat.
        Returns count of commissions released.
        """
        now = datetime.now(timezone.utc)

        # Fetch all commissions whose hold has expired
        result = await self.db.execute(
            select(AgentCommission).where(
                AgentCommission.status == "pending",
                AgentCommission.available_at <= now,
            )
        )
        ready = list(result.scalars().all())
        if not ready:
            return 0

        # Group by agent to batch balance updates
        agent_amounts: dict[UUID, Decimal] = {}
        for commission in ready:
            commission.status = "available"
            agent_amounts[commission.agent_id] = (
                agent_amounts.get(commission.agent_id, Decimal("0")) + commission.amount
            )

        # Update agent balances and notify each agent their funds are now available
        for agent_id, amount in agent_amounts.items():
            agent = await self._get_agent(agent_id)
            agent.pending_balance = max(
                Decimal("0"), (agent.pending_balance or Decimal("0")) - amount
            )
            agent.available_balance = (agent.available_balance or Decimal("0")) + amount

            # commission.available notification
            try:
                from apps.api.modules.business.models import Business
                from apps.api.modules.notifications.service import NotificationService

                agent_biz = (
                    await self.db.execute(
                        select(Business).where(Business.owner_id == agent.user_id).limit(1)
                    )
                ).scalar_one_or_none()
                if agent_biz:
                    await NotificationService(self.db).dispatch_event(
                        business_id=agent_biz.id,
                        event_type="commission_available",
                        data={
                            "message": (
                                f"GHc {float(amount):.2f} in commissions is now available "
                                f"for payout. You will receive it on the next Friday payout."
                            ),
                            "amount": str(amount),
                            "available_balance": str(
                                agent.available_balance or Decimal("0")
                            ),
                        },
                    )
            except Exception:
                logger.warning(
                    "notification.dispatch_failed",
                    event_type="commission_available",
                    agent_id=str(agent_id),
                )

        await self.db.flush()

        # Audit log for the hold release batch
        from apps.api.core.audit import audit
        await audit(
            self.db,
            action="payout.hold_release",
            resource_type="AgentCommission",
            after={
                "commissions_released": len(ready),
                "agents_affected": len(agent_amounts),
            },
        )

        logger.info(
            "agent.commissions_released_from_hold",
            count=len(ready),
            agents_affected=len(agent_amounts),
        )
        return len(ready)

    async def ensure_recipient_code(self, agent: Agent) -> str:
        """
        Return agent's Paystack transfer recipient_code.
        Creates one via Paystack API if not already stored.
        Raises ValueError if agent has no momo_phone or momo_provider.
        """
        if agent.paystack_recipient_code:
            return agent.paystack_recipient_code

        if not agent.momo_phone:
            raise ValueError(f"Agent {agent.id} has no momo_phone — cannot create recipient")

        provider = agent.momo_provider or "mtn"
        from libs.payment_clients.paystack import PaystackClient

        client = PaystackClient(provider=provider)
        try:
            recipient_code = await client._get_or_create_recipient(agent.momo_phone)
        finally:
            await client._close()

        agent.paystack_recipient_code = recipient_code
        await self.db.flush([agent])
        logger.info(
            "agent.recipient_code_created",
            agent_id=str(agent.id),
            provider=provider,
        )
        return recipient_code

    # ── Payout batch ──────────────────────────────────────────────────────────

    async def prepare_payout_batch(self) -> list[dict]:
        """
        Select all agents with available_balance >= payout_threshold.
        Ensures each has a valid Paystack recipient_code.
        Returns list of transfer dicts ready for PaystackClient.bulk_transfer().
        Skips agents with no momo_phone — logs a warning per skip.
        """
        result = await self.db.execute(
            select(Agent).where(
                Agent.is_active.is_(True),
                Agent.available_balance >= Agent.payout_threshold,
            )
        )
        eligible = list(result.scalars().all())

        transfers: list[dict] = []
        skipped: list[str] = []

        for agent in eligible:
            try:
                recipient_code = await self.ensure_recipient_code(agent)
                amount = agent.available_balance

                # Deterministic reference prevents duplicate transfers
                ref_date = datetime.now(timezone.utc).strftime("%Y%m%d")
                reference = f"payout-{str(agent.id)[:12]}-{ref_date}"

                transfers.append(
                    {
                        "agent_id": str(agent.id),
                        "amount_ghs": amount,
                        "recipient_code": recipient_code,
                        "reference": reference,
                        "reason": f"SMEflow agent commission payout — {ref_date}",
                    }
                )
            except ValueError as exc:
                skipped.append(str(agent.id))
                logger.warning(
                    "agent.payout_prep_skipped",
                    agent_id=str(agent.id),
                    reason=str(exc),
                )

        logger.info(
            "agent.payout_batch_prepared",
            eligible=len(eligible),
            transfers=len(transfers),
            skipped=len(skipped),
        )
        return transfers

    async def finalize_agent_payout_success(
        self,
        *,
        agent_id: UUID,
        amount: Decimal,
        batch_id: UUID,
        transfer_code: str | None,
        paid_via: str = "momo",
    ) -> None:
        """Mark available commissions paid and deduct agent balance (idempotent)."""
        now = datetime.now(timezone.utc)
        agent = await self._get_agent(agent_id)

        comm_result = await self.db.execute(
            select(AgentCommission).where(
                AgentCommission.agent_id == agent_id,
                AgentCommission.status == "available",
                AgentCommission.payout_batch_id.is_(None),
            )
        )
        commissions = list(comm_result.scalars().all())
        if not commissions:
            return

        for commission in commissions:
            commission.status = "paid"
            commission.paid_at = now
            commission.paid_via = paid_via
            commission.payout_batch_id = batch_id

        agent.available_balance = max(
            Decimal("0"), (agent.available_balance or Decimal("0")) - amount
        )
        agent.total_paid_out = (agent.total_paid_out or Decimal("0")) + amount
        agent.last_payout_at = now
        await self.db.flush([agent, *commissions])

        await self._notify_payout_sent(agent, amount)
        from apps.api.core.audit import audit

        await audit(
            self.db,
            action="payout.commission.paid",
            resource_type="Agent",
            resource_id=agent_id,
            after={
                "amount": str(amount),
                "transfer_code": transfer_code,
                "batch_id": str(batch_id),
            },
        )

    async def record_payout_batch_result(
        self,
        batch: AgentPayoutBatch,
        transfer_results: list[dict],
    ) -> AgentPayoutBatch:
        """
        Update agent balances and commission statuses based on Paystack bulk transfer results.
        Each result dict: { agent_id, transfer_code, status ('success'|'failed'|'pending'), error? }
        Updates the batch record with per-agent outcomes and sets final status.
        """
        now = datetime.now(timezone.utc)
        results: dict[str, dict] = {}
        success_count = 0
        fail_count = 0
        pending_count = 0

        for item in transfer_results:
            agent_id_str = item["agent_id"]
            status = item.get("status", "pending")
            transfer_code = item.get("transfer_code")

            results[agent_id_str] = {
                "amount": str(item.get("amount_ghs", "0")),
                "transfer_code": transfer_code,
                "reference": item.get("reference"),
                "status": status,
                "error": item.get("error"),
            }

            try:
                agent_id = UUID(agent_id_str)
                agent = await self._get_agent(agent_id)
                amount = Decimal(str(item.get("amount_ghs", "0")))

                if status == "success":
                    await self.finalize_agent_payout_success(
                        agent_id=agent_id,
                        amount=amount,
                        batch_id=batch.id,
                        transfer_code=transfer_code,
                        paid_via="momo",
                    )
                    success_count += 1

                elif status == "pending":
                    pending_count += 1

                else:
                    # Transfer failed — leave commissions as available for next cycle
                    fail_count += 1
                    logger.warning(
                        "agent.payout_transfer_failed",
                        agent_id=agent_id_str,
                        error=item.get("error"),
                    )
                    # payout.failed notification to agent + admin
                    await self._notify_payout_failed(agent, amount, item.get("error"))

            except Exception as exc:
                fail_count += 1
                results[agent_id_str]["error"] = str(exc)
                logger.error(
                    "agent.payout_record_error",
                    agent_id=agent_id_str,
                    error=str(exc),
                )

        # Determine batch final status
        if fail_count == 0 and pending_count == 0:
            batch.status = "completed"
        elif success_count == 0 and pending_count == 0:
            batch.status = "failed"
        else:
            batch.status = "partial_failed"

        batch.results = results
        batch.completed_at = now
        await self.db.flush([batch])

        # Audit log for the batch itself
        from apps.api.core.audit import audit
        await audit(
            self.db,
            action="payout.batch.completed",
            resource_type="AgentPayoutBatch",
            resource_id=batch.id,
            after={
                "status": batch.status,
                "total_amount": str(batch.total_amount),
                "success_count": success_count,
                "fail_count": fail_count,
            },
        )

        logger.info(
            "agent.payout_batch_recorded",
            batch_id=str(batch.id),
            status=batch.status,
            success=success_count,
            failed=fail_count,
        )
        return batch

    async def _notify_payout_sent(self, agent: Agent, amount: Decimal) -> None:
        """SMS + in-app notification when an agent payout transfer is dispatched."""
        try:
            from apps.api.modules.business.models import Business
            from apps.api.modules.notifications.service import NotificationService

            agent_biz = (
                await self.db.execute(
                    select(Business).where(Business.owner_id == agent.user_id).limit(1)
                )
            ).scalar_one_or_none()
            if agent_biz:
                phone_hint = (agent.momo_phone or "")[-4:]
                await NotificationService(self.db).dispatch_event(
                    business_id=agent_biz.id,
                    event_type="payout_sent",
                    data={
                        "message": (
                            f"GHc {float(amount):.2f} has been sent to your MoMo "
                            f"wallet ending {phone_hint}. "
                            f"It should arrive within a few minutes."
                        ),
                        "amount": str(amount),
                        "phone_hint": phone_hint,
                    },
                )
        except Exception:
            logger.warning(
                "notification.dispatch_failed",
                event_type="payout_sent",
                agent_id=str(agent.id),
            )

    # ── New service methods (gap fixes) ──────────────────────────────────────

    async def count_traders_by_status(self, agent_id: UUID, status: str) -> int:
        """Count referrals for this agent with a given lifecycle status."""
        result = await self.db.execute(
            select(func.count(OnboardingReferral.id)).where(
                OnboardingReferral.agent_id == agent_id,
                OnboardingReferral.status == status,
            )
        )
        return result.scalar_one() or 0

    async def get_agent_target(self, agent_id: UUID, year: int, month: int) -> int:
        """Return monthly onboarding target. Falls back to platform default of 20."""
        from apps.api.modules.agent_network.models import AgentTarget

        try:
            async with self.db.begin_nested():
                result = await self.db.execute(
                    select(AgentTarget).where(
                        AgentTarget.agent_id == agent_id,
                        AgentTarget.year == year,
                        AgentTarget.month == month,
                    )
                )
                t = result.scalar_one_or_none()
                return t.target_count if t else 20
        except Exception:
            # Savepoint is rolled back; outer transaction remains usable.
            # Table may not exist before migration runs.
            return 20

    async def update_agent(self, agent_id: UUID, updates: dict) -> Agent:
        """Update allowed agent profile fields."""
        agent = await self._get_agent(agent_id)
        allowed = {"region", "district", "momo_phone", "momo_provider", "payout_threshold"}
        for key, value in updates.items():
            if key in allowed:
                setattr(agent, key, value)
        await self.db.flush([agent])
        logger.info("agent.profile_updated", agent_id=str(agent_id), fields=list(updates.keys()))
        return agent

    async def initiate_agent_withdrawal(self, agent_id: UUID, amount: Decimal) -> dict:
        """On-demand withdrawal: validates balance, initiates Paystack transfer, debits wallet."""
        agent = await self._get_agent(agent_id)
        available = agent.available_balance or Decimal("0")
        threshold = agent.payout_threshold or Decimal("10.00")

        if amount <= Decimal("0"):
            raise ValueError("Withdrawal amount must be greater than zero")
        if amount > available:
            raise ValueError(f"Amount exceeds available balance of GHS {available:.2f}")
        if available < threshold:
            raise ValueError(
                f"Available balance GHS {available:.2f} is below the payout threshold of GHS {threshold:.2f}"
            )

        try:
            recipient_code = await self.ensure_recipient_code(agent)
        except Exception as exc:
            raise ValueError(f"Could not set up MoMo payout account: {exc}") from exc

        from apps.api.core.config import get_settings
        from libs.payment_clients.paystack import PaystackClient

        settings = get_settings()
        if not settings.PAYSTACK_SECRET_KEY:
            raise ValueError("Paystack is not configured — contact support")

        import secrets

        ref = f"withdraw-{str(agent_id)[:12]}-{secrets.token_hex(4)}"
        client = PaystackClient()
        try:
            result = await client.initiate_transfer(
                amount_kobo=int(amount * 100),
                recipient_code=recipient_code,
                reference=ref,
                reason="SMEflow agent on-demand withdrawal",
            )
        finally:
            await client._close()

        agent.available_balance = available - amount
        agent.total_paid_out = (agent.total_paid_out or Decimal("0")) + amount
        agent.last_payout_at = datetime.now(timezone.utc)
        await self.db.flush([agent])

        logger.info("agent.withdrawal.initiated", agent_id=str(agent_id), amount=str(amount), ref=ref)

        transfer_code = result.get("transfer_code") if isinstance(result, dict) else None
        return {
            "status": "pending",
            "transfer_code": transfer_code,
            "amount": float(amount),
            "message": f"GHS {amount:.2f} withdrawal initiated to your registered MoMo account.",
        }

    async def get_trader_detail(self, agent_id: UUID, business_id: UUID) -> dict:
        """Full detail for one trader in this agent's pipeline."""
        from apps.api.modules.business.models import Business, MoMoAccount
        from apps.api.modules.kyc.models import KYCVerification
        from apps.api.modules.sales.models import Sale

        referral_result = await self.db.execute(
            select(OnboardingReferral).where(
                OnboardingReferral.agent_id == agent_id,
                OnboardingReferral.business_id == business_id,
            )
        )
        referral = referral_result.scalar_one_or_none()
        if not referral:
            raise NotFoundError("Trader", str(business_id))

        biz = (await self.db.execute(select(Business).where(Business.id == business_id))).scalar_one_or_none()
        if not biz:
            raise NotFoundError("Business", str(business_id))

        kyc = (
            await self.db.execute(
                select(KYCVerification)
                .where(KYCVerification.business_id == business_id)
                .order_by(KYCVerification.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        wallet = (
            await self.db.execute(
                select(MoMoAccount)
                .where(MoMoAccount.business_id == business_id, MoMoAccount.is_primary.is_(True))
                .limit(1)
            )
        ).scalar_one_or_none()

        sales_count = (await self.db.execute(select(func.count(Sale.id)).where(Sale.business_id == business_id))).scalar_one() or 0
        total_revenue = (await self.db.execute(select(func.sum(Sale.total)).where(Sale.business_id == business_id))).scalar_one() or Decimal("0")
        last_sale_at = (await self.db.execute(select(Sale.created_at).where(Sale.business_id == business_id).order_by(Sale.created_at.desc()).limit(1))).scalar_one_or_none()

        commissions_earned = (
            await self.db.execute(
                select(func.sum(AgentCommission.amount)).where(
                    AgentCommission.agent_id == agent_id,
                    AgentCommission.business_id == business_id,
                )
            )
        ).scalar_one() or Decimal("0")

        return {
            "business_id": str(business_id),
            "business_name": biz.name,
            "business_type": biz.type,
            "address": biz.address,
            "owner_user_id": str(biz.owner_id),
            "referral_status": referral.status,
            "referral_channel": referral.channel,
            "activated_at": referral.activated_at.isoformat() if referral.activated_at else None,
            "onboarded_at": referral.created_at.isoformat(),
            "kyc_status": kyc.status if kyc else "not_submitted",
            "kyc_submitted_at": kyc.created_at.isoformat() if kyc else None,
            "wallet_phone": wallet.phone if wallet else None,
            "wallet_provider": wallet.provider if wallet else None,
            "wallet_verified": wallet.is_verified if wallet else False,
            "sales_count": sales_count,
            "total_revenue_ghs": str(total_revenue),
            "last_sale_at": last_sale_at.isoformat() if last_sale_at else None,
            "commissions_earned_ghs": str(commissions_earned),
        }

    async def _notify_payout_failed(
        self, agent: Agent, amount: Decimal, error: str | None
    ) -> None:
        """Notify agent and platform admin when a payout transfer fails."""
        try:
            from apps.api.modules.business.models import Business
            from apps.api.modules.notifications.service import NotificationService

            agent_biz = (
                await self.db.execute(
                    select(Business).where(Business.owner_id == agent.user_id).limit(1)
                )
            ).scalar_one_or_none()
            if agent_biz:
                await NotificationService(self.db).dispatch_event(
                    business_id=agent_biz.id,
                    event_type="payout_failed",
                    data={
                        "message": (
                            f"Your payout of GHc {float(amount):.2f} could not be sent. "
                            f"We will retry on the next payout cycle. "
                            f"Contact support if this persists."
                        ),
                        "amount": str(amount),
                        "error": error,
                    },
                )
        except Exception:
            logger.warning(
                "notification.dispatch_failed",
                event_type="payout_failed",
                agent_id=str(agent.id),
            )
