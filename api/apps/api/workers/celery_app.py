"""
Celery application factory.
Queues:
  - default        General tasks
  - invoicing      Invoice PDF/QR generation
  - payments       Payment status polling, callback processing
  - payouts        Agent + loan disbursement payout operations
  - credit         Credit score computation
  - notifications  WhatsApp / SMS sends
"""

from celery import Celery
from celery.schedules import crontab

from apps.api.core.config import get_settings

settings = get_settings()

celery = Celery(
    "smeflow",
    broker=settings.RABBITMQ_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "apps.api.workers.tasks.invoicing_tasks",
        "apps.api.workers.tasks.payment_tasks",
        "apps.api.workers.tasks.payout_tasks",
        "apps.api.workers.tasks.credit_tasks",
        "apps.api.workers.tasks.notification_tasks",
        "apps.api.workers.tasks.inventory_tasks",
        "apps.api.workers.tasks.sales_tasks",
        "apps.api.workers.tasks.tax_tasks",
        "apps.api.workers.tasks.agent_tasks",
        "apps.api.workers.tasks.billing_tasks",
        "apps.api.workers.tasks.lender_tasks",
        "apps.api.workers.tasks.analytics_tasks",
    ],
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Africa/Accra",
    enable_utc=True,
    task_routes={
        "apps.api.workers.tasks.invoicing_tasks.*": {"queue": "invoicing"},
        "apps.api.workers.tasks.payment_tasks.*": {"queue": "payments"},
        "apps.api.workers.tasks.payout_tasks.*": {"queue": "payouts"},
        "apps.api.workers.tasks.credit_tasks.*": {"queue": "credit"},
        "apps.api.workers.tasks.notification_tasks.*": {"queue": "notifications"},
        "apps.api.workers.tasks.inventory_tasks.*": {"queue": "default"},
        "apps.api.workers.tasks.sales_tasks.*": {"queue": "default"},
        "apps.api.workers.tasks.tax_tasks.*": {"queue": "default"},
        "apps.api.workers.tasks.agent_tasks.*": {"queue": "default"},
        "apps.api.workers.tasks.billing_tasks.*": {"queue": "billing"},
        "apps.api.workers.tasks.lender_tasks.*": {"queue": "default"},
        "apps.api.workers.tasks.analytics_tasks.*": {"queue": "default"},
    },
    task_default_queue="default",
    task_create_missing_queues=True,
    task_default_exchange_type="direct",
    task_default_routing_key="default",
    task_acks_late=True,  # ack after task completes (at-least-once)
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # one task at a time per worker slot
    task_soft_time_limit=120,  # soft limit: raises SoftTimeLimitExceeded
    task_time_limit=180,  # hard limit: kills worker
    result_expires=86400,  # 24h result retention
    beat_scheduler="redbeat.RedBeatScheduler",
    redbeat_redis_url=settings.REDIS_URL,
    beat_schedule={
        # Nightly credit score refresh at 01:00 WAT
        "compute-all-credit-scores": {
            "task": "apps.api.workers.tasks.credit_tasks.compute_all_credit_scores",
            "schedule": crontab(minute="0", hour="1"),
        },
        # Monthly agent activity commissions on the 1st at 02:00 WAT
        "calculate-monthly-agent-commissions": {
            "task": "apps.api.workers.tasks.agent_tasks.calculate_monthly_agent_commissions",
            "schedule": crontab(minute="0", hour="2", day_of_month="1"),
        },
        # Hourly: release agent commissions from 48h hold period
        "release-commission-holds": {
            "task": "apps.api.workers.tasks.payout_tasks.release_commission_holds",
            "schedule": crontab(minute="0"),  # top of every hour
        },
        # Weekly agent payout: every Friday at 10:00 WAT (UTC+0 = 10:00 since Africa/Accra is GMT)
        "weekly-agent-payout": {
            "task": "apps.api.workers.tasks.payout_tasks.weekly_agent_payout",
            "schedule": crontab(minute="0", hour="10", day_of_week="5"),  # 5 = Friday
        },
        # Daily merchant auto-settlement at 08:00 WAT
        "daily-merchant-auto-settlement": {
            "task": "apps.api.workers.tasks.payout_tasks.daily_merchant_auto_settlement",
            "schedule": crontab(minute="0", hour="8"),
        },
        # Payment polling and reconciliation
        "poll-pending-payments": {
            "task": "apps.api.workers.tasks.payment_tasks.poll_pending_payments",
            "schedule": crontab(minute="*/15"),
        },
        "sweep-stuck-payments": {
            "task": "apps.api.workers.tasks.payment_tasks.sweep_stuck_payments",
            "schedule": crontab(minute="*/10"),
        },
        "daily-payment-reconciliation": {
            "task": "apps.api.workers.tasks.payment_tasks.daily_payment_reconciliation",
            "schedule": crontab(minute="0", hour="2"),
        },
        "backfill-settlement-ledger": {
            "task": "apps.api.workers.tasks.payment_tasks.backfill_settlement_ledger_credits",
            "schedule": crontab(minute="30", hour="2"),
        },
        "process-due-subscriptions": {
            "task": "apps.api.workers.tasks.billing_tasks.process_due_subscriptions",
            "schedule": crontab(minute="0", hour="3"),
        },
        "flag-agent-ghost-businesses": {
            "task": "apps.api.workers.tasks.agent_tasks.flag_agent_ghost_businesses",
            "schedule": crontab(minute="0", hour="5"),
        },
        "alert-expiring-lender-keys": {
            "task": "apps.api.workers.tasks.lender_tasks.alert_expiring_lender_keys",
            "schedule": crontab(minute="30", hour="9"),
        },
        "collect-due-repayments": {
            "task": "apps.api.workers.tasks.credit_tasks.collect_due_repayments",
            "schedule": crontab(minute="0", hour="6"),
        },
        "daily-digest": {
            "task": "apps.api.workers.tasks.notification_tasks.send_daily_digests",
            "schedule": crontab(minute="0", hour="7"),
        },
        "daily-sales-summary": {
            "task": "apps.api.workers.tasks.notification_tasks.send_daily_sales_summaries",
            "schedule": crontab(minute="15", hour="8"),
        },
        "tax-deadline-reminders": {
            "task": "apps.api.workers.tasks.notification_tasks.send_tax_deadline_reminders",
            "schedule": crontab(minute="0", hour="9"),
        },
        "credit-payment-reminders": {
            "task": "apps.api.workers.tasks.notification_tasks.send_credit_payment_reminders",
            "schedule": crontab(minute="15", hour="9"),
        },
        "purge-customer-delivery-history": {
            "task": "apps.api.workers.tasks.notification_tasks.purge_expired_customer_delivery_history",
            "schedule": crontab(minute="30", hour="1"),
        },
        "monthly-tax-draft": {
            "task": "apps.api.workers.tasks.tax_tasks.generate_monthly_tax_drafts",
            "schedule": crontab(day_of_month=1, hour="6", minute=0),
        },
        # Real-time low-stock push check — runs every 30 min during business hours (WAT 07:00–21:00)
        "low-stock-push-alerts": {
            "task": "apps.api.workers.tasks.notification_tasks.send_low_stock_push_alerts",
            "schedule": crontab(minute="*/30", hour="7-21"),
        },
    },
)
