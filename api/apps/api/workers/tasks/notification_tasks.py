"""Celery tasks for notifications (WhatsApp, SMS, Push)."""

import asyncio
from uuid import UUID

import structlog

from apps.api.workers.celery_app import celery

logger = structlog.get_logger()

TEMPLATES: dict[str, str] = {
    "stock.low": "⚠️ Low stock alert: {item_name} has only {current_stock} units left. Restock soon!",
    "stock.low.digest": "⚠️ Low stock digest:\n{item_lines}\nPlease restock the items above as soon as possible.",
    "sale.recorded": "✅ Sale recorded: GHS {total}. Invoice is being generated.",
    "sales.daily.summary": "📊 Daily Sales Summary ({date}):\n• Total Sales: {total_sales}\n• Revenue: GHS {total_revenue}\n• Cash: GHS {cash_revenue}\n• MoMo: GHS {momo_revenue}\n• Credit: GHS {credit_revenue}\nTop Items:\n{top_items}",
    "payment.confirmed": "💰 Payment of GHS {amount} confirmed via {provider}. Reference: {reference}",
    "payment.failed": "⚠️ Payment failed: GHS {amount} via {provider}. Reference: {reference}. Please retry or collect another way.",
    "invoice.sent": "Invoice #{invoice_number} for GHS {total} is ready. {pdf_url}",
    "invoice.payment_reminder": "Reminder: Invoice #{invoice_number} for GHS {total} is still unpaid. {payment_url}",
    "receivable.payment_reminder": "Reminder: {customer_name} owes GHS {amount_due}. Follow up today to keep cashflow healthy.",
    "sync.failed": "⚠️ SMEflow sync failed for {business_name}. Open the app when online and retry sync.",
    "tax.deadline": "📋 Reminder: VAT return for {period} is due in {days_left} days.",
    "credit.offer": "🎉 You qualify for a GHS {amount} business loan! Reply LOAN to apply.",
    "payroll.run_complete": "💼 Payroll for {period} complete. {count} employees paid GHS {total_net}.",
    # ── Billing / dunning templates ───────────────────────────────────────────
    "billing.payment_failed": (
        "⚠️ SMEFlow payment failed: GHS {amount} could not be charged to {momo_phone}. "
        "Your {plan} subscription remains active for {grace_days} more days. "
        "Please ensure funds are available on your MoMo line."
    ),
    "billing.payment_failed_final_warning": (
        "🚨 SMEFlow final warning: Your {plan} subscription renewal has failed a second time. "
        "If payment is not resolved within {retry_days} days your account will be downgraded to free."
    ),
    "billing.subscription_downgraded": (
        "😔 Your SMEFlow {plan} subscription has ended due to repeated payment failures. "
        "Your account is now on the free plan. Tap here to renew: {renewal_url}"
    ),
    "billing.subscription_renewed": (
        "✅ SMEFlow {plan} subscription renewed successfully! "
        "Your next billing date is {next_billing_date}. Thank you for staying with SMEFlow."
    ),
    "billing.referral_reward": (
        "🎁 Congratulations! You've earned 1 month of SMEFlow Starter free for referring {count} friends. "
        "Enjoy premium features until {expiry_date}!"
    ),
    # ── Key business event templates ─────────────────────────────────────────
    "kyc_reviewed": "{message}",
    "loan_status_changed": "{message}",
    "commission_earned": "{message}",
    "subscription_changed": "{message}",
}


@celery.task(bind=True, max_retries=3)
def send_notification(self, business_id: str, event_type: str, data: dict) -> None:
    """Dispatch a notification via the appropriate channel for a business."""

    async def _run() -> None:
        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.notifications.service import NotificationService

        async with AsyncSessionLocal() as db:
            events = await NotificationService(db).dispatch_event(
                UUID(business_id), event_type, data
            )
            await db.commit()
            logger.info("notification.dispatched", business_id=business_id, count=len(events))

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("notification.failed", business_id=business_id, error=str(exc))
        raise self.retry(exc=exc) from exc


@celery.task(bind=True, max_retries=2)
def deliver_customer_message(self, message_id: str) -> None:
    """Deliver a customer message with bounded WhatsApp retries and SMS fallback."""

    async def _run() -> None:
        from uuid import UUID

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.notifications.delivery_service import CustomerDeliveryService

        async with AsyncSessionLocal() as db:
            service = CustomerDeliveryService(db)
            message = await service.get_message_by_id(UUID(message_id))
            await service.deliver_message(message)
            await db.commit()

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("customer_message.delivery_failed", message_id=message_id, error=str(exc))
        raise self.retry(exc=exc) from exc


@celery.task
def purge_expired_customer_delivery_history() -> None:
    """Delete customer-message delivery records after their 12-month retention period."""

    async def _run() -> None:
        from datetime import datetime, timezone

        from sqlalchemy import delete

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.notifications.models import CustomerMessage

        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(CustomerMessage).where(
                    CustomerMessage.retention_until.is_not(None),
                    CustomerMessage.retention_until < datetime.now(timezone.utc),
                )
            )
            await db.commit()

    asyncio.run(_run())


@celery.task
def send_credit_payment_reminders() -> None:
    """Notify merchants and customers before and shortly after credit due dates."""
    async def _run() -> None:
        from datetime import datetime, timezone

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.invoicing.models import Invoice
        from apps.api.modules.sales.models import Customer, Receivable

        today = datetime.now(timezone.utc).date()
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(Receivable, Customer, Invoice)
                    .join(Customer, Customer.id == Receivable.customer_id)
                    .join(Invoice, Invoice.sale_id == Receivable.sale_id)
                    .where(
                        Receivable.status.in_(["outstanding", "partial"]),
                        Receivable.due_date.is_not(None),
                    )
                )
            ).all()
            for receivable, customer, invoice in rows:
                days_until = (receivable.due_date.date() - today).days
                if days_until not in {3, 0, -1, -3}:
                    continue
                stage = {
                    3: "three_days_before",
                    0: "due",
                    -1: "one_day_overdue",
                    -3: "three_days_overdue",
                }[days_until]
                reminder_key = f"{today.isoformat()}:{stage}"
                if receivable.last_reminder_key == reminder_key:
                    continue
                from apps.api.modules.notifications.alert_service import MerchantAlertService
                from apps.api.modules.notifications.delivery_service import CustomerDeliveryService

                if days_until == -1:
                    await MerchantAlertService(db).upsert_alert(
                        business_id=receivable.business_id,
                        alert_type="credit_overdue",
                        severity="critical",
                        dedupe_key=f"credit_overdue:{receivable.id}",
                        title="Credit repayment is overdue",
                        message=f"{customer.name or customer.phone} owes GHS {receivable.balance_due}.",
                        resource_type="invoice",
                        resource_id=str(invoice.id),
                        action_path=f"/owner/invoices?invoice_id={invoice.id}",
                        action_label="Collect payment",
                    )
                body = (
                    f"Reminder: Invoice #{invoice.invoice_number} for GHS "
                    f"{receivable.balance_due} is still unpaid."
                )
                if invoice.paystack_payment_url:
                    body = f"{body} {invoice.paystack_payment_url}"
                delivery = CustomerDeliveryService(db)
                message = await delivery.create_message(
                    business_id=receivable.business_id,
                    customer_id=customer.id,
                    message_type="credit_reminder",
                    recipient_phone=customer.phone,
                    body=body,
                    preferred_channel=customer.reminder_channel or "whatsapp",
                    idempotency_key=f"credit-reminder:{receivable.id}:{stage}",
                    consent_status=(
                        "granted"
                        if customer.reminder_consent and not customer.reminder_opt_out_at
                        else "opted_out"
                        if customer.reminder_opt_out_at
                        else "missing"
                    ),
                    consent_source=customer.reminder_consent_source,
                    consent_at=customer.reminder_consent_at,
                    related_resource_type="receivable",
                    related_resource_id=str(receivable.id),
                )
                if message.status == "requested":
                    await delivery.deliver_message(message)
                receivable.last_reminder_key = reminder_key
            await db.commit()

    asyncio.run(_run())


@celery.task
def send_daily_digests() -> None:
    """Send daily business summaries for low-stock items."""
    logger.info("task.daily_digests.started")

    async def _run() -> None:
        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.analytics.service import AnalyticsService
        from apps.api.modules.business.models import Business
        from apps.api.modules.notifications.service import NotificationService

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Business.id))
            business_ids = result.scalars().all()
            for business_id in business_ids:
                low_items = await AnalyticsService(db).low_stock_items(business_id)
                if not low_items:
                    continue
                lines = []
                for item in low_items[:20]:
                    lines.append(f"• {item['name']}: {item['current_stock']} {item['unit']}")
                if len(low_items) > 20:
                    lines.append(f"...and {len(low_items) - 20} more items")
                await NotificationService(db).dispatch_event(
                    business_id,
                    "stock.low.digest",
                    {
                        "item_lines": "\n".join(lines),
                        "count": len(low_items),
                    },
                )
                await db.commit()

    try:
        asyncio.run(_run())
        logger.info("task.daily_digests.completed")
    except Exception as exc:
        logger.error("task.daily_digests.failed", error=str(exc))
        raise


@celery.task
def send_daily_sales_summaries() -> None:
    """Send daily sales summaries for all businesses."""
    logger.info("task.daily_sales_summaries.started")

    async def _run() -> None:
        from datetime import date

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.business.models import Business
        from apps.api.modules.notifications.service import NotificationService
        from apps.api.modules.sales.service import SalesService

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Business.id))
            business_ids = result.scalars().all()
            today = date.today().isoformat()
            for business_id in business_ids:
                svc = SalesService(db)
                summary = await svc.get_daily_summary(business_id, today)
                if summary["total_sales"] == 0:
                    continue  # Skip if no sales today
                top_items_lines = []
                for item in summary["top_items"][:5]:  # Top 5 items
                    top_items_lines.append(
                        f"• {item['description']}: {item['total_qty']} sold (GHS {item['total_revenue']})"
                    )
                if not top_items_lines:
                    top_items_lines = ["• No items sold today"]
                await NotificationService(db).dispatch_event(
                    business_id,
                    "sales.daily.summary",
                    {
                        "date": summary["date"],
                        "total_sales": summary["total_sales"],
                        "total_revenue": f"{summary['total_revenue']:.2f}",
                        "cash_revenue": f"{summary['cash_revenue']:.2f}",
                        "momo_revenue": f"{summary['momo_revenue']:.2f}",
                        "credit_revenue": f"{summary['credit_revenue']:.2f}",
                        "top_items": "\n".join(top_items_lines),
                    },
                )
                await db.commit()

    try:
        asyncio.run(_run())
        logger.info("task.daily_sales_summaries.completed")
    except Exception as exc:
        logger.error("task.daily_sales_summaries.failed", error=str(exc))
        raise


@celery.task
def send_tax_deadline_reminders() -> None:
    """Send GRA filing deadline reminders (runs on specific dates)."""
    logger.info("task.tax_reminders.started")

    async def _run() -> None:
        from datetime import date, timedelta

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.business.models import Business
        from apps.api.modules.notifications.service import NotificationService

        today = date.today()
        # Check for upcoming deadlines (VAT returns are due by 15th of following month)
        # For simplicity, send reminders 7 days before deadline
        reminder_date = today + timedelta(days=7)

        # Ghana VAT filing deadlines (simplified - 15th of month following transaction month)
        if reminder_date.day == 8:  # 7 days before 15th
            # This is a monthly reminder for the upcoming month's filing
            target_month = reminder_date.month
            target_year = reminder_date.year

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Business.id))
                business_ids = result.scalars().all()
                for business_id in business_ids:
                    await NotificationService(db).dispatch_event(
                        business_id,
                        "tax.deadline",
                        {
                            "period": f"{target_year}-{target_month:02d}",
                            "days_left": 7,
                        },
                    )
                    await db.commit()

    try:
        asyncio.run(_run())
        logger.info("task.tax_reminders.completed")
    except Exception as exc:
        logger.error("task.tax_reminders.failed", error=str(exc))
        raise


@celery.task
def send_low_stock_push_alerts() -> None:
    """Fire per-item push alerts for businesses with items at or below low-stock threshold.

    Runs every 30 minutes during business hours. Uses a deduplication key so a
    merchant only gets one push per item per hour, preventing alert fatigue.
    """
    logger.info("task.low_stock_push.started")

    async def _run() -> None:
        from datetime import datetime, timezone

        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.analytics.service import AnalyticsService
        from apps.api.modules.business.models import Business
        from apps.api.modules.notifications.service import NotificationService

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Business.id))
            business_ids = result.scalars().all()

            for business_id in business_ids:
                try:
                    low_items = await AnalyticsService(db).low_stock_items(business_id)
                    if not low_items:
                        continue

                    svc = NotificationService(db)
                    # Dedupe key: only push once per item per hour
                    current_hour = datetime.now(timezone.utc).strftime("%Y%m%d%H")

                    for item in low_items[:5]:  # Cap at 5 push notifications per business per run
                        dedupe_key = f"low_stock_push:{business_id}:{item['id']}:{current_hour}"
                        # Use MerchantAlertService to check/upsert so we don't spam
                        from apps.api.modules.notifications.alert_service import MerchantAlertService
                        await MerchantAlertService(db).upsert_alert(
                            business_id=business_id,
                            alert_type="low_stock",
                            severity="warning",
                            dedupe_key=dedupe_key,
                            title="Low stock",
                            message=f"{item['name']} has only {item['current_stock']} {item['unit']} left.",
                            resource_type="inventory_item",
                            resource_id=str(item["id"]),
                            action_path="/owner/inventory?filter=low_stock",
                            action_label="View stock",
                        )
                        await svc.dispatch_event(
                            business_id,
                            "stock.low",
                            {
                                "item_name": item["name"],
                                "current_stock": item["current_stock"],
                                "unit": item["unit"],
                            },
                        )

                    await db.commit()
                except Exception as exc:
                    logger.warning(
                        "task.low_stock_push.business_failed",
                        business_id=str(business_id),
                        error=str(exc),
                    )

    try:
        asyncio.run(_run())
        logger.info("task.low_stock_push.completed")
    except Exception as exc:
        logger.error("task.low_stock_push.failed", error=str(exc))
        raise
