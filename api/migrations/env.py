"""
Alembic environment — async SQLAlchemy with asyncpg.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

# Import Base so all models are registered
from apps.api.core.database import Base
from apps.api.core.config import get_settings

# Import all models to populate Base.metadata
from apps.api.modules.auth.models import User  # noqa: F401
from apps.api.modules.business.models import Business, BusinessMember, MoMoAccount  # noqa: F401
from apps.api.modules.inventory.models import ItemCategory, Item, StockReservation, StockTransaction  # noqa: F401
from apps.api.modules.sales.models import Customer, Sale, SaleItem, Receivable  # noqa: F401
from apps.api.modules.invoicing.models import Invoice, InvoiceItem  # noqa: F401
from apps.api.modules.payments.models import Payment  # noqa: F401
from apps.api.modules.tax.models import TaxReturn  # noqa: F401
from apps.api.modules.payroll.models import Attendance, Employee, PayrollRun, Payslip  # noqa: F401
from apps.api.modules.billing.models import Subscription, BillingTransaction  # noqa: F401
from apps.api.modules.kyc.models import KYCVerification  # noqa: F401
from apps.api.modules.referral.models import Referral  # noqa: F401
from apps.api.modules.credit.models import CreditScore, LoanRequest, LenderConsent  # noqa: F401
from apps.api.modules.lender.models import LenderPartner  # noqa: F401
from apps.api.modules.notifications.models import DeviceToken  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
settings = get_settings()


def run_migrations_offline() -> None:
    url = settings.DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):  # type: ignore[no-untyped-def]
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(settings.DATABASE_URL, echo=False)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
