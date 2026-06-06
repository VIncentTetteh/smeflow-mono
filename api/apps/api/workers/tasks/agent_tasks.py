"""Celery tasks for agent commission calculation."""

from __future__ import annotations

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()


@celery.task(name="apps.api.workers.tasks.agent_tasks.calculate_monthly_agent_commissions")
def calculate_monthly_agent_commissions() -> None:
    """
    Monthly Celery Beat task: calculate activity-based commissions for all agents.

    For each active agent, count the number of their attributed businesses that
    had at least one sale in the previous calendar month, and create a
    ``monthly_activity`` commission for each active business.

    Runs on the 1st of each month (configured in beat_schedule below).
    """
    import asyncio

    async def _run() -> None:
        from calendar import monthrange
        from datetime import date

        from sqlalchemy import func, select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.agent_network.models import Agent, AgentCommission, OnboardingReferral
        from apps.api.modules.agent_network.service import COMMISSION_RATES
        from apps.api.modules.sales.models import Sale

        today = date.today()
        # Previous month boundaries
        first_of_this_month = today.replace(day=1)
        last_of_prev = first_of_this_month.replace(day=1) - __import__("datetime").timedelta(days=1)
        prev_year = last_of_prev.year
        prev_month = last_of_prev.month
        _, last_day = monthrange(prev_year, prev_month)
        period_start = date(prev_year, prev_month, 1)
        period_end = date(prev_year, prev_month, last_day)

        async with AsyncSessionLocal() as db:
            # Fetch all active agents
            agents_result = await db.execute(select(Agent).where(Agent.is_active.is_(True)))
            agents = agents_result.scalars().all()

            total_commissions = 0
            for agent in agents:
                # Find businesses attributed to this agent that had sales last month
                active_biz_result = await db.execute(
                    select(OnboardingReferral.business_id)
                    .join(Sale, Sale.business_id == OnboardingReferral.business_id)
                    .where(
                        OnboardingReferral.agent_id == agent.id,
                        OnboardingReferral.status.in_(["registered", "active"]),
                        func.date(Sale.created_at) >= period_start,
                        func.date(Sale.created_at) <= period_end,
                    )
                    .group_by(OnboardingReferral.business_id)
                    .having(func.count(Sale.id) > 0)
                )
                active_business_ids = [row[0] for row in active_biz_result.all()]

                for business_id in active_business_ids:
                    # Avoid duplicate commissions for the same agent/business/month
                    dupe = await db.execute(
                        select(AgentCommission).where(
                            AgentCommission.agent_id == agent.id,
                            AgentCommission.business_id == business_id,
                            AgentCommission.trigger == "monthly_activity",
                            func.date_trunc("month", AgentCommission.created_at)
                            == func.date_trunc("month", func.now()),
                        )
                    )
                    if dupe.scalar_one_or_none():
                        continue

                    amount = COMMISSION_RATES["monthly_activity"]
                    commission = AgentCommission(
                        agent_id=agent.id,
                        business_id=business_id,
                        trigger="monthly_activity",
                        amount=amount,
                        notes=f"Auto: period {period_start} - {period_end}",
                    )
                    db.add(commission)
                    from decimal import Decimal

                    agent.total_commission_earned = (
                        agent.total_commission_earned or Decimal("0")
                    ) + amount
                    total_commissions += 1

            await db.commit()
            logger.info(
                "task.agent_commissions.calculated",
                period=f"{period_start}-{period_end}",
                total_commissions=total_commissions,
                agents_processed=len(agents),
            )

    asyncio.get_event_loop().run_until_complete(_run())


@celery.task(name="apps.api.workers.tasks.agent_tasks.auto_payout_agent_commissions")
def auto_payout_agent_commissions() -> None:
    """
    DEPRECATED — use weekly_agent_payout (Paystack bulk + 48h hold).

    Disabled unless ENABLE_LEGACY_AGENT_MOMO_PAYOUT=true.
    """
    import asyncio

    async def _run() -> None:
        from apps.api.core.config import get_settings

        if not get_settings().ENABLE_LEGACY_AGENT_MOMO_PAYOUT:
            logger.info("agent.legacy_auto_payout.disabled")
            return
        from datetime import datetime, timezone
        from decimal import Decimal

        from sqlalchemy import func, select

        from apps.api.core.config import get_settings
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.agent_network.models import Agent, AgentCommission
        from apps.api.modules.agent_network.service import AgentNetworkService
        from libs.payment_clients.providers import get_payment_provider

        threshold = Decimal(str(get_settings().AGENT_COMMISSION_MIN_PAYOUT_GHS))
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(Agent, func.sum(AgentCommission.amount).label("total"))
                    .join(AgentCommission, AgentCommission.agent_id == Agent.id)
                    .where(
                        Agent.is_active.is_(True),
                        Agent.momo_phone.isnot(None),
                        AgentCommission.status == "pending",
                    )
                    .group_by(Agent.id)
                    .having(func.sum(AgentCommission.amount) >= threshold)
                )
            ).all()

            paid_agents = 0
            for row in rows:
                agent = row.Agent
                amount = row.total
                pending = (
                    await db.execute(
                        select(AgentCommission.id).where(
                            AgentCommission.agent_id == agent.id,
                            AgentCommission.status == "pending",
                        )
                    )
                ).all()
                commission_ids = [item[0] for item in pending]
                if not commission_ids:
                    continue

                provider = _provider_for_phone(agent.momo_phone or "")
                reference = (
                    f"agent-pay-{str(agent.id)[:8]}-{int(datetime.now(timezone.utc).timestamp())}"
                )
                client = get_payment_provider(provider)
                resp = await client.disburse(
                    amount,
                    agent.momo_phone,
                    reference,
                    "SMEFlow agent commission payout",
                )
                if getattr(resp, "status", "pending") in {"success", "pending"}:
                    await AgentNetworkService(db).mark_commissions_paid_by_admin(
                        commission_ids,
                        admin_id=None,
                        paid_via="momo",
                        agent_id=agent.id,
                    )
                    paid_agents += 1

            await db.commit()
            logger.info("agent.auto_payout.completed", paid_agents=paid_agents)

    asyncio.get_event_loop().run_until_complete(_run())


def _provider_for_phone(phone: str) -> str:
    digits = phone.replace("+", "").replace(" ", "")
    if digits.startswith(("23320", "23350")):
        return "vodafone"
    if digits.startswith(("23327", "23357", "23326", "23356")):
        return "airteltigo"
    return "mtn"


@celery.task(name="apps.api.workers.tasks.agent_tasks.flag_agent_ghost_businesses")
def flag_agent_ghost_businesses() -> None:
    """Flag agents whose onboarded businesses have >30% zero-sales after 30 days."""
    import asyncio

    async def _run() -> None:
        from datetime import datetime, timedelta, timezone

        from sqlalchemy import func, select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.agent_network.models import Agent, OnboardingReferral
        from apps.api.modules.sales.models import Sale

        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        async with AsyncSessionLocal() as db:
            agents = (
                (await db.execute(select(Agent).where(Agent.is_active.is_(True)))).scalars().all()
            )
            flagged = 0
            for agent in agents:
                referrals = (
                    (
                        await db.execute(
                            select(OnboardingReferral).where(
                                OnboardingReferral.agent_id == agent.id,
                                OnboardingReferral.created_at <= cutoff,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                if len(referrals) < 5:
                    continue
                zero_sales = 0
                for referral in referrals:
                    count = (
                        await db.execute(
                            select(func.count(Sale.id)).where(
                                Sale.business_id == referral.business_id
                            )
                        )
                    ).scalar_one()
                    zero_sales += 1 if count == 0 else 0
                if zero_sales / len(referrals) > 0.30:
                    logger.warning(
                        "agent.fraud_signal.ghost_businesses",
                        agent_id=str(agent.id),
                        zero_sales=zero_sales,
                        total=len(referrals),
                    )
                    flagged += 1
            logger.info("agent.fraud_signal.completed", flagged=flagged)

    asyncio.get_event_loop().run_until_complete(_run())


# ── Beat schedule entry (added to celery_app.py's beat_schedule) ─────────────
# Runs at 02:00 WAT on the 1st of each month.
BEAT_SCHEDULE_ENTRY = {
    "calculate-monthly-agent-commissions": {
        "task": "apps.api.workers.tasks.agent_tasks.calculate_monthly_agent_commissions",
        "schedule": __import__("celery.schedules", fromlist=["crontab"]).crontab(
            minute="0", hour="2", day_of_month="1"
        ),
    }
}
