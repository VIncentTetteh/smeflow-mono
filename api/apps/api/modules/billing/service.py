"""Billing & Subscriptions service."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.api.core.exceptions import ConflictError
from apps.api.modules.billing.models import PLANS, BillingTransaction, Subscription, plan_price
from apps.api.modules.business.models import Business

logger = structlog.get_logger()


class BillingService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Read current subscription ─────────────────────────────────────────────

    async def get_subscription(self, business_id: UUID) -> Subscription:
        result = await self.db.execute(
            select(Subscription)
            .where(Subscription.business_id == business_id)
            .options(selectinload(Subscription.transactions))
        )
        sub = result.scalar_one_or_none()
        if not sub:
            # Auto-create free tier on first access
            sub = await self._bootstrap_free(business_id)
        return sub

    # ── Upgrade / change plan ─────────────────────────────────────────────────

    def _normalize_billing_interval(self, plan_name: str, billing_interval: str | None) -> str:
        if plan_name == "free":
            return "monthly"
        interval = billing_interval or "monthly"
        if interval not in {"monthly", "annual"}:
            raise ValueError("billing_interval must be 'monthly' or 'annual'")
        supported = PLANS[plan_name].get("billing_intervals", [])
        if interval not in supported:
            raise ValueError(f"{plan_name} does not support {interval} billing")
        return interval

    async def change_plan(
        self,
        business_id: UUID,
        new_plan: str,
        momo_phone: str | None = None,
        billing_interval: str | None = None,
    ) -> Subscription:
        if new_plan not in PLANS:
            raise ValueError(f"Unknown plan '{new_plan}'. Valid: {list(PLANS)}")

        sub = await self.get_subscription(business_id)

        normalized_interval = self._normalize_billing_interval(new_plan, billing_interval)

        if sub.plan == new_plan and sub.billing_interval == normalized_interval:
            raise ConflictError(f"Already on {new_plan} plan")

        old_plan = sub.plan
        sub.plan = new_plan
        sub.billing_interval = normalized_interval
        sub.status = "active"
        sub.cancel_at_period_end = False
        if momo_phone:
            sub.momo_phone = momo_phone

        # Update business.subscription cache
        biz_result = await self.db.execute(select(Business).where(Business.id == business_id))
        biz = biz_result.scalar_one_or_none()
        if biz:
            biz.subscription = new_plan

        await self.db.flush()
        logger.info(
            "billing.plan_changed",
            business_id=str(business_id),
            from_plan=old_plan,
            to_plan=new_plan,
            billing_interval=normalized_interval,
        )
        return sub

    # ── Cancel subscription ───────────────────────────────────────────────────

    async def cancel(self, business_id: UUID) -> Subscription:
        sub = await self.get_subscription(business_id)
        if sub.plan == "free":
            raise ConflictError("Free plan cannot be cancelled")
        sub.cancel_at_period_end = True
        await self.db.flush()
        logger.info("billing.cancel_requested", business_id=str(business_id))
        return sub

    # ── Billing history ───────────────────────────────────────────────────────

    async def list_transactions(
        self, business_id: UUID, limit: int = 20, offset: int = 0
    ) -> tuple[list[BillingTransaction], int]:
        from sqlalchemy import func as sqlfunc

        count_result = await self.db.execute(
            select(sqlfunc.count(BillingTransaction.id)).where(
                BillingTransaction.business_id == business_id
            )
        )
        total = count_result.scalar_one()

        result = await self.db.execute(
            select(BillingTransaction)
            .where(BillingTransaction.business_id == business_id)
            .order_by(BillingTransaction.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        txns = result.scalars().all()
        return list(txns), total

    async def plan_usage(self, business_id: UUID) -> dict:
        """Return current plan and monthly usage counters for billing UI."""
        from apps.api.modules.business.models import Business, BusinessMember
        from apps.api.modules.invoicing.models import Invoice
        from apps.api.modules.inventory.models import Item
        from apps.api.modules.payroll.models import Employee
        from apps.api.modules.sales.models import Customer, Sale

        now = datetime.now(timezone.utc)
        month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        sub = await self.get_subscription(business_id)
        plan = PLANS.get(sub.plan, PLANS["free"])

        monthly_sales = (
            await self.db.execute(
                select(func.count(Sale.id)).where(
                    Sale.business_id == business_id,
                    Sale.status != "voided",
                    Sale.created_at >= month_start,
                )
            )
        ).scalar_one()
        items = (
            await self.db.execute(
                select(func.count(Item.id)).where(
                    Item.business_id == business_id,
                    Item.deleted_at.is_(None),
                )
            )
        ).scalar_one()
        employees = (
            await self.db.execute(
                select(func.count(Employee.id)).where(
                    Employee.business_id == business_id,
                    Employee.is_active.is_(True),
                )
            )
        ).scalar_one()
        team_members = (
            await self.db.execute(
                select(func.count(BusinessMember.id)).where(
                    BusinessMember.business_id == business_id,
                    BusinessMember.is_active.is_(True),
                )
            )
        ).scalar_one()
        customers = (
            await self.db.execute(
                select(func.count(Customer.id)).where(Customer.business_id == business_id)
            )
        ).scalar_one()
        monthly_invoices = (
            await self.db.execute(
                select(func.count(Invoice.id)).where(
                    Invoice.business_id == business_id,
                    Invoice.issued_at >= month_start,
                )
            )
        ).scalar_one()
        owner_id = (
            await self.db.execute(select(Business.owner_id).where(Business.id == business_id))
        ).scalar_one_or_none()
        business_count = 0
        if owner_id:
            business_count = (
                await self.db.execute(
                    select(func.count(Business.id)).where(Business.owner_id == owner_id)
                )
            ).scalar_one()

        usage = {
            "monthly_sales": monthly_sales,
            "items": items,
            "employees": employees,
            "team_members": team_members,
            "customers": customers,
            "monthly_invoices": monthly_invoices,
            "ai_messages": 0,
            "businesses": business_count,
            "field_agents": 0,
        }
        limits = {
            "monthly_sales": plan.get("monthly_sales", plan.get("sale_limit")),
            "items": plan.get("items"),
            "employees": plan.get("employees", plan.get("staff_limit")),
            "team_members": plan.get("users", plan.get("staff_limit")),
            "customers": plan.get("customers"),
            "monthly_invoices": plan.get("monthly_invoices"),
            "ai_messages": plan.get("ai_messages"),
            "businesses": plan.get("businesses"),
            "included_businesses": plan.get("included_businesses"),
            "field_agents": plan.get("field_agents"),
            "languages": plan.get("languages", []),
            "analytics": plan.get("analytics", False),
            "credit_scoring": plan.get("credit_scoring", False),
            "tax_summary": plan.get("tax_summary", False),
            "gra_submission": plan.get("gra_submission", False),
            "invoice_pdf": plan.get("invoice_pdf", False),
            "invoices": plan.get("invoices"),
            "bulk_csv_import": plan.get("bulk_csv_import", False),
            "bulk_momo_payout": plan.get("bulk_momo_payout", False),
            "recurring_invoices": plan.get("recurring_invoices", False),
            "cost_margin_tracking": plan.get("cost_margin_tracking", False),
            "business_insights": plan.get("business_insights", False),
            "export": plan.get("export", False),
        }
        return {
            "subscription": sub,
            "plan": sub.plan,
            "billing_interval": sub.billing_interval,
            "status": sub.status,
            "usage": usage,
            "limits": limits,
            "current_period_end": sub.current_period_end,
        }

    # ── Usage check (feature gate) ────────────────────────────────────────────

    async def check_limit(self, business_id: UUID, feature: str, current_count: int) -> bool:
        """
        Returns True if the business is within plan limits.
        feature: "sale_limit" | "staff_limit"
        """
        from apps.api.core.config import get_settings

        if get_settings().APP_ENV == "test":
            exists = (
                await self.db.execute(select(Business.id).where(Business.id == business_id))
            ).scalar_one_or_none()
            if not exists:
                return True
        sub = await self.get_subscription(business_id)
        plan_limits = PLANS.get(sub.plan, PLANS["free"])
        limit = plan_limits.get(feature)
        if limit is None or limit == -1:
            return True  # unlimited
        return current_count < limit

    # ── Record a successful billing payment ───────────────────────────────────

    async def record_payment(
        self, business_id: UUID, amount: Decimal, provider_ref: str, description: str = ""
    ) -> BillingTransaction:
        sub = await self.get_subscription(business_id)
        txn = BillingTransaction(
            subscription_id=sub.id,
            business_id=business_id,
            amount=amount,
            status="success",
            provider_ref=provider_ref,
            description=description,
            paid_at=datetime.now(timezone.utc),
        )
        self.db.add(txn)
        await self.db.flush([txn])
        return txn

    async def initiate_subscription(
        self,
        business_id: UUID,
        plan_name: str,
        momo_phone: str | None = None,
        billing_interval: str | None = None,
    ) -> BillingTransaction:
        """
        Initiate a subscription payment for a plan upgrade.

        Returns (BillingTransaction, payment_url). payment_url is a Paystack
        hosted page URL when Paystack is configured (the preferred path) — the
        caller should surface this URL to the user so they can complete payment
        in a webview. payment_url is None when momo_phone is used for a direct
        charge or when downgrading to free.

        Webhook flow: charge.success from Paystack → handle_webhook_success()
        activates the subscription automatically.
        """
        if plan_name not in PLANS:
            raise ValueError(f"Unknown plan '{plan_name}'. Valid: {list(PLANS)}")
        plan = PLANS[plan_name]
        normalized_interval = self._normalize_billing_interval(plan_name, billing_interval)
        amount = plan_price(plan, normalized_interval)
        sub = await self.get_subscription(business_id)

        # ── Free / zero-cost plan — activate immediately ──────────────────────
        if plan_name == "free" or amount <= 0:
            await self.change_plan(business_id, plan_name, momo_phone, normalized_interval)
            txn = BillingTransaction(
                subscription_id=sub.id,
                business_id=business_id,
                amount=Decimal("0"),
                status="success",
                provider_ref=f"free-{sub.id}",
                description=f"subscription_upgrade:{plan_name}:{normalized_interval}",
                paid_at=datetime.now(timezone.utc),
            )
            self.db.add(txn)
            await self.db.flush([txn])
            return txn, None

        from apps.api.core.config import get_settings

        settings = get_settings()

        # ── Paystack transaction initialize (primary path — no form required) ──
        if settings.PAYSTACK_SECRET_KEY:
            reference = (
                f"sub-{business_id}-{plan_name}-{int(datetime.now(timezone.utc).timestamp())}"
            )
            txn = BillingTransaction(
                subscription_id=sub.id,
                business_id=business_id,
                amount=amount,
                status="pending",
                payment_method="paystack",
                provider_ref=reference,
                description=f"subscription_upgrade:{plan_name}:{normalized_interval}",
            )
            self.db.add(txn)
            if momo_phone:
                sub.momo_phone = momo_phone
            await self.db.flush([sub, txn])

            # Resolve billing email: business email → owner email → placeholder
            billing_email = await self._resolve_billing_email(business_id)

            payment_url: str | None = None
            try:
                from libs.payment_clients.paystack import PaystackClient

                callback_base = (
                    settings.STOREFRONT_WEB_BASE_URL or settings.APP_BASE_URL
                ).rstrip("/")
                tx = await PaystackClient().initialize_transaction(
                    email=billing_email,
                    amount_ghs=amount,
                    reference=reference,
                    metadata={
                        "business_id": str(business_id),
                        "plan": plan_name,
                        "billing_interval": normalized_interval,
                        "transaction_id": str(txn.id),
                    },
                    callback_url=f"{callback_base}/store/billing/confirm?ref={reference}",
                )
                payment_url = tx.get("authorization_url")
                logger.info(
                    "billing.transaction_initialized",
                    business_id=str(business_id),
                    plan=plan_name,
                    url=payment_url,
                )
            except Exception as exc:
                logger.warning(
                    "billing.transaction_init_failed",
                    business_id=str(business_id),
                    plan=plan_name,
                    error=str(exc),
                )

            return txn, payment_url

        # ── Direct MoMo charge fallback (requires momo_phone) ─────────────────
        phone = momo_phone or sub.momo_phone
        if not phone:
            raise ValueError("momo_phone is required when Paystack is not configured")

        if momo_phone:
            sub.momo_phone = momo_phone
        reference = f"sub-{business_id}-{plan_name}-{int(datetime.now(timezone.utc).timestamp())}"
        txn = BillingTransaction(
            subscription_id=sub.id,
            business_id=business_id,
            amount=amount,
            status="pending",
            provider_ref=reference,
            description=f"subscription_upgrade:{plan_name}:{normalized_interval}",
        )
        self.db.add(txn)
        await self.db.flush([txn])

        try:
            from libs.payment_clients.providers import get_payment_provider

            provider = self._provider_for_phone(phone or "")
            client = get_payment_provider(provider)
            resp = await client.request_payment(
                amount,
                phone,
                reference,
                f"SMEFlow {plan_name} subscription",
            )
            txn.provider_ref = getattr(resp, "external_ref", reference)
            if getattr(resp, "status", "pending") == "failed":
                txn.status = "failed"
                txn.description = f"{txn.description}: {getattr(resp, 'provider_message', '')}"
        except Exception as exc:
            logger.warning(
                "billing.momo_charge_failed",
                business_id=str(business_id),
                plan=plan_name,
                error=str(exc),
            )

        await self.db.flush([sub, txn])
        return txn, None

    async def process_due_subscription(
        self, subscription: Subscription
    ) -> BillingTransaction | None:
        """Charge a due paid subscription and update the billing lifecycle."""
        if subscription.plan == "free" or subscription.cancel_at_period_end:
            return None
        plan = PLANS.get(subscription.plan, PLANS["free"])
        amount = plan_price(plan, subscription.billing_interval)
        if amount <= 0:
            return None
        if not subscription.momo_phone:
            await self._mark_billing_failure(subscription, "Missing subscription MoMo phone")
            return None

        provider = self._provider_for_phone(subscription.momo_phone)
        reference = f"bill-{subscription.id}-{int(datetime.now(timezone.utc).timestamp())}"
        txn = BillingTransaction(
            subscription_id=subscription.id,
            business_id=subscription.business_id,
            amount=amount,
            status="pending",
            provider_ref=reference,
            description=f"{subscription.plan} subscription renewal",
        )
        self.db.add(txn)
        await self.db.flush([txn])

        try:
            from libs.payment_clients.providers import get_payment_provider

            client = get_payment_provider(provider)
            resp = await client.request_payment(
                amount,
                subscription.momo_phone,
                reference,
                f"SMEFlow {subscription.plan} subscription",
            )
            txn.provider_ref = getattr(resp, "external_ref", reference)
            if getattr(resp, "status", "pending") == "failed":
                txn.status = "failed"
                await self._mark_billing_failure(
                    subscription, getattr(resp, "provider_message", "")
                )
            else:
                await self.apply_successful_renewal(subscription, txn.provider_ref or reference)
                txn.status = "success"
                txn.paid_at = datetime.now(timezone.utc)
            await self.db.flush([subscription, txn])
            return txn
        except Exception as exc:
            txn.status = "failed"
            txn.description = f"{txn.description}: {exc}"
            await self._mark_billing_failure(subscription, str(exc))
            await self.db.flush([subscription, txn])
            return txn

    async def apply_successful_renewal(
        self, subscription: Subscription, provider_ref: str
    ) -> Subscription:
        now = datetime.now(timezone.utc)
        start = subscription.current_period_end or now
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if start < now:
            start = now
        subscription.current_period_start = start
        period_days = 365 if subscription.billing_interval == "annual" else 30
        next_period_end = start + timedelta(days=period_days)
        subscription.current_period_end = next_period_end
        subscription.status = "active"
        subscription.billing_retry_count = 0
        subscription.next_billing_retry_at = None
        subscription.external_ref = provider_ref

        # Notify the business owner of a successful renewal
        self._queue_dunning_notification(
            subscription,
            "billing.subscription_renewed",
            {
                "plan": subscription.plan,
                "next_billing_date": next_period_end.strftime("%d %b %Y"),
            },
        )
        return subscription

    async def process_due_subscriptions(self) -> int:
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            select(Subscription).where(
                Subscription.plan != "free",
                Subscription.status.in_(["active", "past_due"]),
                Subscription.cancel_at_period_end.is_(False),
                (
                    (Subscription.current_period_end <= now)
                    | (Subscription.next_billing_retry_at <= now)
                ),
            )
        )
        count = 0
        for subscription in result.scalars().all():
            await self.process_due_subscription(subscription)
            count += 1
        return count

    async def handle_webhook_success(self, provider_ref: str) -> bool:
        txn = (
            await self.db.execute(
                select(BillingTransaction).where(BillingTransaction.provider_ref == provider_ref)
            )
        ).scalar_one_or_none()
        if not txn:
            return False
        subscription = await self.get_subscription(txn.business_id)
        target_plan = None
        target_interval = "monthly"
        if txn.description and txn.description.startswith("subscription_upgrade:"):
            parts = txn.description.split(":")
            target_plan = parts[1] if len(parts) > 1 else None
            target_interval = parts[2] if len(parts) > 2 else "monthly"
        if target_plan in PLANS:
            subscription.plan = target_plan
            subscription.billing_interval = self._normalize_billing_interval(
                target_plan, target_interval
            )
            biz_result = await self.db.execute(
                select(Business).where(Business.id == subscription.business_id)
            )
            biz = biz_result.scalar_one_or_none()
            if biz:
                biz.subscription = target_plan
            if target_plan != "free":
                await self._trigger_subscription_commission(subscription.business_id)
        await self.apply_successful_renewal(subscription, provider_ref)
        txn.status = "success"
        txn.paid_at = txn.paid_at or datetime.now(timezone.utc)
        await self.db.flush([subscription, txn])
        return True

    async def _trigger_subscription_commission(self, business_id: UUID) -> None:
        try:
            from apps.api.modules.agent_network.service import AgentNetworkService

            await AgentNetworkService(self.db).trigger_activation_commission(
                business_id, "subscription_upgrade"
            )
        except Exception as exc:
            logger.warning(
                "agent.subscription_commission_failed",
                business_id=str(business_id),
                error=str(exc),
            )

    async def _mark_billing_failure(self, sub: Subscription, reason: str) -> None:
        from apps.api.core.config import get_settings

        settings = get_settings()
        sub.status = "past_due"
        sub.billing_retry_count = (sub.billing_retry_count or 0) + 1

        if sub.billing_retry_count == 1:
            # ── First failure: enter grace period ────────────────────────────
            delay_days = settings.BILLING_GRACE_DAYS
            sub.next_billing_retry_at = datetime.now(timezone.utc) + timedelta(days=delay_days)
            logger.warning(
                "billing.payment_failed_grace_period",
                business_id=str(sub.business_id),
                retry_count=sub.billing_retry_count,
                retry_in_days=delay_days,
                reason=reason,
            )
            self._queue_dunning_notification(
                sub,
                "billing.payment_failed",
                {
                    "amount": str(plan_price(PLANS.get(sub.plan, PLANS["free"]), sub.billing_interval)),
                    "momo_phone": sub.momo_phone or "your MoMo number",
                    "plan": sub.plan,
                    "grace_days": delay_days,
                },
            )

        elif sub.billing_retry_count == 2:
            # ── Second failure: final warning, retry in 7 days ───────────────
            delay_days = 7
            sub.next_billing_retry_at = datetime.now(timezone.utc) + timedelta(days=delay_days)
            logger.warning(
                "billing.payment_failed_final_warning",
                business_id=str(sub.business_id),
                retry_count=sub.billing_retry_count,
                retry_in_days=delay_days,
                reason=reason,
            )
            self._queue_dunning_notification(
                sub,
                "billing.payment_failed_final_warning",
                {
                    "plan": sub.plan,
                    "retry_days": delay_days,
                },
            )

        else:
            # ── Third+ failure: downgrade to free ────────────────────────────
            old_plan = sub.plan
            sub.plan = "free"
            sub.billing_interval = "monthly"
            sub.cancel_at_period_end = True
            sub.next_billing_retry_at = None
            biz_result = await self.db.execute(
                select(Business).where(Business.id == sub.business_id)
            )
            biz = biz_result.scalar_one_or_none()
            if biz:
                biz.subscription = "free"
            logger.warning(
                "billing.subscription_downgraded",
                business_id=str(sub.business_id),
                from_plan=old_plan,
                reason=reason,
            )
            self._queue_dunning_notification(
                sub,
                "billing.subscription_downgraded",
                {
                    "plan": old_plan,
                    "renewal_url": f"{settings.APP_BASE_URL}/billing/renew",
                },
            )

    def _queue_dunning_notification(self, sub: Subscription, event_type: str, data: dict) -> None:
        """Fire-and-forget: queue a Celery notification task for a billing event."""
        try:
            from apps.api.workers.tasks.notification_tasks import send_notification

            send_notification.delay(str(sub.business_id), event_type, data)
        except Exception as exc:
            logger.warning(
                "billing.dunning_notification_queue_failed",
                business_id=str(sub.business_id),
                event_type=event_type,
                error=str(exc),
            )

    def _provider_for_phone(self, phone: str) -> str:
        digits = phone.replace("+", "").replace(" ", "")
        if digits.startswith(("23320", "23350")):
            return "vodafone"
        if digits.startswith(("23327", "23357", "23326", "23356")):
            return "airteltigo"
        return "mtn"

    # ── Private ───────────────────────────────────────────────────────────────

    async def grant_premium_month(self, business_id: UUID) -> Subscription:
        """Grant 1 month of starter-tier premium as a referral reward."""
        from datetime import timedelta

        sub = await self.get_subscription(business_id)
        if sub.plan == "free":
            sub.plan = "starter"
            sub.status = "active"
            # Set or extend the period end by 30 days
            now = datetime.now(timezone.utc)
            sub.current_period_end = now + timedelta(days=30)
            # Update business cache
            biz_result = await self.db.execute(select(Business).where(Business.id == business_id))
            biz = biz_result.scalar_one_or_none()
            if biz:
                biz.subscription = "starter"
            await self.db.flush()
            logger.info("billing.referral_reward_granted", business_id=str(business_id))
        return sub

    # ── Paystack subscription billing ─────────────────────────────────────────

    async def create_paystack_subscription(
        self,
        business_id: str,
        email: str,
        plan_code: str,
        authorization_code: str = "",
    ) -> dict:
        """Create a Paystack recurring subscription for a business.

        Uses the PaystackClient and stores subscription_code + email_token on
        the Subscription row so it can be cancelled later via cancel_subscription().
        Returns the subscription data dict from Paystack.
        """
        from libs.payment_clients.paystack import PaystackClient

        client = PaystackClient()
        data = await client.create_subscription(
            customer=email,
            plan=plan_code,
            authorization=authorization_code,
        )
        logger.info(
            "billing.paystack_subscription_created",
            business_id=business_id,
            subscription_code=data.get("subscription_code"),
            plan_code=plan_code,
        )

        # Persist subscription_code and email_token for future management
        try:
            from uuid import UUID as _UUID

            biz_uuid = _UUID(business_id)
            from sqlalchemy import select as _select

            sub = (
                await self.db.execute(
                    _select(Subscription).where(Subscription.business_id == biz_uuid)
                )
            ).scalar_one_or_none()
            if sub:
                sub.paystack_subscription_code = data.get("subscription_code")
                sub.paystack_plan_code = plan_code
                sub.paystack_email_token = data.get("email_token")
                sub.external_ref = data.get("subscription_code")
                await self.db.flush([sub])
        except Exception as exc:
            logger.warning(
                "billing.paystack_subscription_persist_failed",
                business_id=business_id,
                error=str(exc),
            )

        return data

    async def handle_paystack_webhook(self, payload: dict) -> None:
        """Process a Paystack webhook event and update the subscription tier.

        This is the legacy ``/billing/webhook/paystack`` route's handler —
        the canonical webhook path is ``/payments/webhooks/paystack``, which
        already routes ``charge.success`` through ``handle_webhook_success()``
        (reference/description-based, no dependency on Paystack echoing back
        custom metadata). This function only exists in case the Paystack
        dashboard is still pointed at the legacy URL.

        Handles the following Paystack event types:
        - ``charge.success`` — delegate to ``handle_webhook_success()`` by
          transaction reference, same as the canonical webhook path.
        - ``subscription.active`` — upgrade to the plan embedded in the
          event data (only relevant for real Paystack Subscription
          enrollments, which nothing in this codebase currently creates).
        - ``subscription.disable`` / ``subscription.cancelled`` /
          ``subscription.not_renew`` — downgrade to free.
        """
        event = payload.get("event", "")
        data = payload.get("data", {})

        if event == "charge.success":
            reference = data.get("reference", "")
            if reference:
                await self.handle_webhook_success(reference)
            else:
                logger.warning("billing.paystack_webhook_missing_reference", paystack_event=event)
            return

        customer = data.get("customer", {})
        business_id: str | None = customer.get("metadata", {}).get("business_id")
        billing_interval: str | None = (
            data.get("metadata", {}).get("billing_interval")
            or customer.get("metadata", {}).get("billing_interval")
        )

        if not business_id:
            logger.warning(
                "billing.paystack_webhook_no_business_id",
                paystack_event=event,
            )
            return

        if event == "subscription.active":
            plan_name: str = data.get("plan", {}).get("name", "").lower()
            if "pro" in plan_name:
                tier = "pro"
            elif "starter" in plan_name:
                tier = "starter"
            else:
                logger.warning(
                    "billing.paystack_webhook_unknown_plan",
                    business_id=business_id,
                    plan_name=plan_name,
                    paystack_event=event,
                )
                return
            await self._update_subscription_tier(business_id, tier, billing_interval)

        elif event in (
            "subscription.disable",
            "subscription.cancelled",
            "subscription.not_renew",
        ):
            await self._update_subscription_tier(business_id, "free")

        else:
            # Unrecognised event — ignore gracefully
            logger.debug(
                "billing.paystack_webhook_ignored",
                paystack_event=event,
                business_id=business_id,
            )

    async def _update_subscription_tier(
        self, business_id: str, tier: str, billing_interval: str | None = None
    ) -> None:
        """Persist a subscription tier change triggered by a Paystack event.

        Mirrors the pattern used in ``change_plan``: updates both the
        ``Subscription`` row and the denormalised ``Business.subscription``
        cache column, then flushes within the current unit-of-work.
        """
        from sqlalchemy import select

        try:
            biz_uuid = UUID(business_id)
        except (ValueError, AttributeError):
            logger.error(
                "billing.paystack_update_tier_invalid_id",
                business_id=business_id,
                tier=tier,
            )
            return

        sub_result = await self.db.execute(
            select(Subscription).where(Subscription.business_id == biz_uuid)
        )
        sub = sub_result.scalar_one_or_none()
        if sub:
            sub.plan = tier
            sub.billing_interval = self._normalize_billing_interval(tier, billing_interval)
            sub.status = "active" if tier != "free" else sub.status
            sub.cancel_at_period_end = tier == "free"

        biz_result = await self.db.execute(select(Business).where(Business.id == biz_uuid))
        biz = biz_result.scalar_one_or_none()
        if biz:
            biz.subscription = tier

        await self.db.flush()
        logger.info(
            "billing.subscription_tier_updated",
            business_id=business_id,
            tier=tier,
        )

        # Notify the business owner of their subscription change.
        # Failure must never break the tier update.
        try:
            from apps.api.modules.notifications.service import NotificationService

            tier_labels = {"free": "Free", "starter": "Starter", "pro": "Pro"}
            tier_label = tier_labels.get(tier, tier.capitalize())
            msg = f"Your SMEflow subscription has been updated to the {tier_label} plan."
            await NotificationService(self.db).dispatch_event(
                business_id=biz_uuid,
                event_type="subscription_changed",
                data={"message": msg},
            )
        except Exception:
            logger.warning(
                "notification.dispatch_failed",
                event_type="subscription_changed",
                business_id=business_id,
            )

    async def _resolve_billing_email(self, business_id: UUID) -> str:
        """Return the best available email for Paystack checkout.

        Users authenticate via phone (no email field). Priority:
          1. Business email (set by owner in profile)
          2. Placeholder derived from owner's phone digits (always valid for Paystack)
        """
        from sqlalchemy import select as _select

        from apps.api.modules.auth.models import User
        from apps.api.modules.business.models import Business

        biz = (
            await self.db.execute(_select(Business).where(Business.id == business_id))
        ).scalar_one_or_none()

        if biz and biz.email:
            return biz.email

        # Derive placeholder from owner's phone so it's unique and stable per business
        if biz:
            owner = (
                await self.db.execute(_select(User).where(User.id == biz.owner_id))
            ).scalar_one_or_none()
            if owner and owner.phone:
                digits = "".join(c for c in owner.phone if c.isdigit())
                return f"{digits}@smeflow.app"

        return f"biz-{str(business_id)[:8]}@smeflow.app"

    async def _bootstrap_free(self, business_id: UUID) -> Subscription:
        sub = Subscription(
            business_id=business_id,
            plan="free",
            billing_interval="monthly",
            status="active",
        )
        self.db.add(sub)
        await self.db.flush([sub])
        return sub
