"""Referral service — invite tracking, conversion, and reward granting."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.exceptions import ConflictError
from apps.api.core.phone import normalize_ghana_phone
from apps.api.modules.auth.models import User
from apps.api.modules.referral.models import Referral

logger = structlog.get_logger()

REFERRAL_CODE_LENGTH = 8
REFERRALS_NEEDED_FOR_REWARD = 3


class ReferralService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Code management ───────────────────────────────────────────────────────

    async def get_or_create_code(self, user_id: UUID) -> str:
        """Return the user's referral code, generating one lazily if needed."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("User not found")
        if user.referral_code:
            return user.referral_code
        # Generate a unique code
        for _ in range(10):
            code = secrets.token_urlsafe(REFERRAL_CODE_LENGTH)[:REFERRAL_CODE_LENGTH].upper()
            existing = await self.db.execute(select(User).where(User.referral_code == code))
            if not existing.scalar_one_or_none():
                user.referral_code = code
                await self.db.flush([user])
                logger.info("referral.code_generated", user_id=str(user_id), code=code)
                return code
        raise RuntimeError("Could not generate a unique referral code")

    # ── Invite management ─────────────────────────────────────────────────────

    async def invite(self, referrer_id: UUID, referee_phone: str) -> Referral:
        """Create a pending referral. Idempotent — returns existing if already invited."""
        phone = normalize_ghana_phone(referee_phone)
        existing = await self.db.execute(
            select(Referral).where(
                Referral.referrer_id == referrer_id,
                Referral.referee_phone == phone,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(f"Already invited {phone}")

        referral = Referral(referrer_id=referrer_id, referee_phone=phone)
        self.db.add(referral)
        await self.db.flush([referral])
        logger.info("referral.invited", referrer_id=str(referrer_id), phone=phone)
        return referral

    # ── Conversion hook (called after new user registers) ─────────────────────

    async def on_user_registered(self, new_user: User) -> None:
        """Mark any pending referral for this phone as converted, then check reward."""
        result = await self.db.execute(
            select(Referral).where(
                Referral.referee_phone == new_user.phone,
                Referral.status == "pending",
            )
        )
        referral = result.scalar_one_or_none()
        if not referral:
            return  # No pending referral for this phone

        referral.referee_user_id = new_user.id
        referral.status = "converted"
        referral.converted_at = datetime.now(timezone.utc)
        await self.db.flush([referral])
        logger.info(
            "referral.converted",
            referral_id=str(referral.id),
            referrer_id=str(referral.referrer_id),
        )
        await self._check_and_grant_reward(referral.referrer_id)

    # ── Reward granting ───────────────────────────────────────────────────────

    async def _check_and_grant_reward(self, referrer_id: UUID) -> None:
        """Grant 1 month premium if the referrer now has >= 3 converted referrals."""
        # Count converted + unrewarded referrals
        result = await self.db.execute(
            select(Referral)
            .where(
                Referral.referrer_id == referrer_id,
                Referral.status == "converted",
                Referral.reward_granted.is_(False),
            )
            .with_for_update()
        )
        unrewarded = list(result.scalars().all())
        if len(unrewarded) < REFERRALS_NEEDED_FOR_REWARD:
            return

        # Take exactly the first N needed
        to_reward = unrewarded[:REFERRALS_NEEDED_FOR_REWARD]
        for r in to_reward:
            r.status = "rewarded"
            r.reward_granted = True
        await self.db.flush(to_reward)

        # Grant 1 month premium to the referrer's business and notify them
        try:
            from datetime import timedelta

            from sqlalchemy import select as sa_select

            from apps.api.modules.billing.service import BillingService
            from apps.api.modules.business.models import BusinessMember

            biz_result = await self.db.execute(
                sa_select(BusinessMember.business_id)
                .where(
                    BusinessMember.user_id == referrer_id,
                    BusinessMember.role == "owner",
                )
                .limit(1)
            )
            row = biz_result.one_or_none()
            if row:
                business_id = row[0]
                sub = await BillingService(self.db).grant_premium_month(business_id)
                logger.info("referral.reward_granted", referrer_id=str(referrer_id))

                # Fire WhatsApp/SMS notification to the referrer
                try:
                    from apps.api.workers.tasks.notification_tasks import send_notification

                    expiry = sub.current_period_end or (
                        datetime.now(timezone.utc) + timedelta(days=30)
                    )
                    send_notification.delay(
                        str(business_id),
                        "billing.referral_reward",
                        {
                            "count": REFERRALS_NEEDED_FOR_REWARD,
                            "expiry_date": expiry.strftime("%d %b %Y"),
                        },
                    )
                except Exception as notif_exc:
                    logger.warning(
                        "referral.reward_notification_failed",
                        referrer_id=str(referrer_id),
                        error=str(notif_exc),
                    )
        except Exception as exc:
            logger.warning("referral.reward_failed", referrer_id=str(referrer_id), error=str(exc))

    # ── Status view ───────────────────────────────────────────────────────────

    async def get_status(self, user_id: UUID) -> dict:
        code = await self.get_or_create_code(user_id)
        result = await self.db.execute(
            select(Referral)
            .where(Referral.referrer_id == user_id)
            .order_by(Referral.created_at.desc())
        )
        referrals = list(result.scalars().all())
        converted = [r for r in referrals if r.status in ("converted", "rewarded")]
        pending = [r for r in referrals if r.status == "pending"]
        reward_granted = any(r.reward_granted for r in referrals)
        return {
            "referral_code": code,
            "total_invited": len(referrals),
            "converted": len(converted),
            "pending": len(pending),
            "reward_granted": reward_granted,
            "referrals": referrals,
        }
