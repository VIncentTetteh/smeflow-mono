"""Business service — creation, member management, MoMo account linking."""

from datetime import datetime, timezone
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.exceptions import ConflictError, LimitExceededError, NotFoundError
from apps.api.core.security import create_access_token
from apps.api.modules.auth.repository import UserRepository
from apps.api.modules.business.models import Business, BusinessMember, MoMoAccount
from apps.api.modules.business.repository import BusinessRepository
from apps.api.modules.business.schemas import (
    BusinessCreate,
    BusinessUpdate,
    MemberUpdate,
    MoMoAccountAdd,
    MoMoAccountUpdate,
    MoMoAccountVerify,
)

logger = structlog.get_logger()


class BusinessService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = BusinessRepository(db)
        self.user_repo = UserRepository(db)

    async def create_business(self, owner_id: UUID, data: BusinessCreate) -> tuple[Business, str]:
        """
        Create a business, add the creator as owner, and return
        (business, new_access_token) so the client can switch context immediately.

        Raises ConflictError (409) when:
          - The owner already has a business with the same name (case-insensitive).
          - The supplied TIN is already registered to another business.
        """
        existing_businesses = (
            await self.db.execute(select(Business).where(Business.owner_id == owner_id))
        ).scalars().all()
        if existing_businesses:
            from apps.api.modules.billing.models import PLANS
            from apps.api.modules.billing.service import BillingService

            primary_business = existing_businesses[0]
            subscription = await BillingService(self.db).get_subscription(primary_business.id)
            limit = PLANS.get(subscription.plan, PLANS["free"]).get("businesses", 1)
            if limit not in (None, -1) and len(existing_businesses) >= limit:
                raise LimitExceededError("businesses", limit)

        # ── Duplicate name check ─────────────────────────────────────────────
        existing = await self.repo.get_by_owner_and_name(owner_id, data.name)
        if existing:
            raise ConflictError(f"You already have a business named '{data.name}'")

        # ── TIN uniqueness check ─────────────────────────────────────────────
        if data.tin:
            tin_owner = await self.repo.get_by_tin(data.tin)
            if tin_owner:
                raise ConflictError(f"TIN '{data.tin}' is already registered to another business")

        business = await self.repo.create(
            owner_id=owner_id,
            name=data.name,
            type=data.type,
            tin=data.tin,
            ghana_card_ref=data.ghana_card_ref,
            address=data.address,
            region=data.region,
            city=data.city,
            market=data.market,
            preferred_language=data.preferred_language,
            momo_provider=data.momo_provider,
            tax_vat_status=data.tax_vat_status,
            template_slug=data.template_slug,
            location_lat=data.location_lat,
            location_lng=data.location_lng,
        )
        await self.repo.add_member(business.id, owner_id, role="owner")

        # ── Agent onboarding commission ──────────────────────────────────────
        if data.onboarding_agent_id:
            await self._credit_onboarding_commission(
                agent_id=data.onboarding_agent_id,
                business_id=business.id,
                onboarding_channel=data.onboarding_channel or "field",
            )

        # Issue a new access token scoped to this business
        token = create_access_token(user_id=owner_id, business_id=business.id, role="owner")
        logger.info("business.created", business_id=str(business.id), owner_id=str(owner_id))
        return business, token

    async def _credit_onboarding_commission(
        self, agent_id: UUID, business_id: UUID, onboarding_channel: str
    ) -> None:
        """Create an AgentCommission record and increment the agent's onboarded_count.

        Commission amount is read from platform config; defaults to GHS 5.00 per merchant.
        This is fire-and-continue: a failure here must never block business creation.
        """
        from decimal import Decimal

        from sqlalchemy import select

        from apps.api.core.config import get_settings
        from apps.api.modules.agent_network.models import Agent, AgentCommission, OnboardingReferral

        try:
            settings = get_settings()
            commission_amount = Decimal(
                str(getattr(settings, "AGENT_ONBOARDING_COMMISSION_GHS", "5.00"))
            )

            agent_result = await self.db.execute(select(Agent).where(Agent.id == agent_id))
            agent = agent_result.scalar_one_or_none()
            if not agent or not agent.is_active:
                logger.warning(
                    "business.agent_commission_skipped",
                    agent_id=str(agent_id),
                    reason="agent not found or inactive",
                )
                return

            # Create OnboardingReferral record (idempotent via unique constraint)
            referral = OnboardingReferral(
                agent_id=agent_id,
                business_id=business_id,
                channel=onboarding_channel,
                status="registered",
            )
            self.db.add(referral)

            # Create commission record
            commission = AgentCommission(
                agent_id=agent_id,
                business_id=business_id,
                trigger="onboarding",
                amount=commission_amount,
                status="pending",
            )
            self.db.add(commission)

            # Update aggregate counter on Agent
            agent.onboarded_count = (agent.onboarded_count or 0) + 1
            agent.total_commission_earned = (
                agent.total_commission_earned or Decimal("0")
            ) + commission_amount

            await self.db.flush()
            logger.info(
                "business.agent_commission_credited",
                agent_id=str(agent_id),
                business_id=str(business_id),
                amount=str(commission_amount),
            )
        except Exception as exc:
            logger.error(
                "business.agent_commission_failed",
                agent_id=str(agent_id),
                business_id=str(business_id),
                error=str(exc),
            )

    async def update_business(
        self, business_id: UUID, user_id: UUID, data: BusinessUpdate
    ) -> Business:
        business = await self.repo.get_by_id(business_id)
        if not business:
            raise NotFoundError("Business", str(business_id))
        return await self.repo.update(business, **data.model_dump(exclude_none=True))

    async def invite_member(self, business_id: UUID, phone: str, role: str) -> BusinessMember:
        """
        Invite a user (by phone) to the business. Creates user if not yet registered.
        They complete login via OTP; membership is already active.
        Enforces the plan's staff_limit before adding a new member.
        """
        from apps.api.core.exceptions import LimitExceededError
        from apps.api.modules.billing.models import PLANS
        from apps.api.modules.billing.service import BillingService

        # ── Plan limit check ─────────────────────────────────────────────────
        billing = BillingService(self.db)
        current_members = await self.repo.get_members(business_id)
        allowed = await billing.check_limit(business_id, "staff_limit", len(current_members))
        if not allowed:
            sub = await billing.get_subscription(business_id)
            limit = PLANS.get(sub.plan, PLANS["free"]).get("staff_limit", 0)
            raise LimitExceededError("staff members", limit)

        user = await self.user_repo.get_by_phone(phone)
        if not user:
            user = await self.user_repo.create(phone=phone)

        existing = await self.repo.get_member(business_id, user.id)
        if existing:
            raise ConflictError(f"User {phone} is already a member of this business")

        member = await self.repo.add_member(business_id=business_id, user_id=user.id, role=role)
        logger.info("business.member_invited", business_id=str(business_id), phone=phone, role=role)
        return member

    async def update_member(
        self,
        business_id: UUID,
        member_id: UUID,
        data: MemberUpdate,
    ) -> BusinessMember:
        member = await self.repo.get_member_by_id(business_id, member_id)
        if not member:
            raise NotFoundError("Business member", str(member_id))
        if member.role == "owner" and data.is_active is False:
            raise ConflictError("Business owner membership cannot be deactivated")
        if member.role == "owner" and data.role and data.role != "owner":
            raise ConflictError("Business owner role cannot be changed")
        if member.role != "owner" and data.role == "owner":
            raise ConflictError("Owner role cannot be assigned through member management")
        return await self.repo.update_member(member, **data.model_dump(exclude_none=True))

    async def deactivate_member(self, business_id: UUID, member_id: UUID) -> BusinessMember:
        return await self.update_member(
            business_id,
            member_id,
            MemberUpdate(is_active=False),
        )

    async def add_momo_account(self, business_id: UUID, data: MoMoAccountAdd) -> MoMoAccount:
        return await self.repo.add_momo_account(
            business_id=business_id,
            provider=data.provider,
            phone=data.phone,
            account_name=data.account_name,
            is_primary=data.is_primary,
            status="pending",
            is_verified=False,
        )

    async def update_momo_account(
        self, business_id: UUID, account_id: UUID, data: MoMoAccountUpdate
    ) -> MoMoAccount:
        account = await self.repo.get_momo_account(business_id, account_id)
        if not account:
            raise NotFoundError("MoMo account", str(account_id))
        return await self.repo.update_momo_account(account, **data.model_dump(exclude_none=True))

    async def delete_momo_account(self, business_id: UUID, account_id: UUID) -> None:
        account = await self.repo.get_momo_account(business_id, account_id)
        if not account:
            raise NotFoundError("MoMo account", str(account_id))
        await self.repo.delete_momo_account(account)

    async def set_primary_momo_account(self, business_id: UUID, account_id: UUID) -> MoMoAccount:
        account = await self.repo.get_momo_account(business_id, account_id)
        if not account:
            raise NotFoundError("MoMo account", str(account_id))
        return await self.repo.update_momo_account(account, is_primary=True)

    async def verify_momo_account(
        self, business_id: UUID, account_id: UUID, data: MoMoAccountVerify
    ) -> MoMoAccount:
        account = await self.repo.get_momo_account(business_id, account_id)
        if not account:
            raise NotFoundError("MoMo account", str(account_id))
        is_verified = data.status == "verified"
        return await self.repo.update_momo_account(
            account,
            status=data.status,
            is_verified=is_verified,
            verified_at=datetime.now(timezone.utc) if is_verified else None,
            verification_ref=data.verification_ref,
            failure_reason=data.failure_reason,
        )

    async def owned_stores_summary(self, user_id: UUID) -> list[dict]:
        """Every business this user owns, with today's sales and staff count.

        Single authenticated request, no session/business_id switching — loops
        server-side over the user's own OWNER memberships (never another
        user's businesses), unlike the per-business endpoints which are all
        scoped to the JWT's current business_id.
        """
        from datetime import timedelta

        from sqlalchemy import func

        from apps.api.modules.sales.models import Sale

        memberships = [
            m for m in await self.repo.get_memberships_for_user(user_id) if m.role == "owner"
        ]
        if not memberships:
            return []

        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)

        summaries = []
        for membership in memberships:
            business = membership.business
            if not business:
                continue
            today_sales = (
                await self.db.scalar(
                    select(func.coalesce(func.sum(Sale.total), 0)).where(
                        Sale.business_id == business.id,
                        Sale.status != "voided",
                        Sale.created_at >= today_start,
                        Sale.created_at < today_end,
                    )
                )
            ) or 0
            staff_count = (
                await self.db.scalar(
                    select(func.count(BusinessMember.id)).where(
                        BusinessMember.business_id == business.id,
                        BusinessMember.is_active.is_(True),
                    )
                )
            ) or 0
            summaries.append(
                {
                    "business_id": business.id,
                    "business_name": business.name,
                    "subscription": business.subscription,
                    "today_sales": today_sales,
                    "staff_count": staff_count,
                }
            )
        return summaries
