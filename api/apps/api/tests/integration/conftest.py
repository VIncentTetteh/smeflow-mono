"""
Integration test fixtures using aiosqlite (in-memory SQLite).

This overrides the session-scoped fixtures from the top-level conftest so
integration tests run without a real PostgreSQL instance — useful in CI and
local sandbox environments.

SQLite differences we work around:
  - No PGUUID type: we map UUID columns to String(36)
  - No partial indexes: silently ignored via render_as_batch
  - No RETURNING on UPDATE: handled by flush + expire pattern
"""

import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from limits.storage import storage_from_string
from sqlalchemy import event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.compiler import compiles

from apps.api.core.database import Base, get_db
from apps.api.core.middleware import limiter
from apps.api.main import app
from apps.api.modules.admin.models import AuditLog  # noqa: F401
from apps.api.modules.agent_network.models import (  # noqa: F401
    Agent,
    AgentCommission,
    OnboardingReferral,
)
from apps.api.modules.billing.models import BillingTransaction, Subscription  # noqa: F401
from apps.api.modules.credit.models import CreditScore, LoanRequest  # noqa: F401
from apps.api.modules.kyc.models import KYCVerification
from apps.api.modules.lender.models import LenderLoanRevenue  # noqa: F401
from apps.api.modules.notifications.models import (  # noqa: F401
    NotificationEvent,
    NotificationPreference,
)
from apps.api.modules.payroll.models import Employee, PayrollRun, Payslip  # noqa: F401
from apps.api.modules.tax.models import TaxReturn  # noqa: F401

# ── SQLite engine ──────────────────────────────────────────────────────────��──
SQLITE_URL = "sqlite+aiosqlite:///:memory:?check_same_thread=False"


def _sqlite_uuid_patch():
    """Replace PostgreSQL UUID columns with String(36) for SQLite compat."""
    from sqlalchemy import String
    from sqlalchemy.dialects.postgresql import UUID as PGUUID

    PGUUID.impl = String  # type: ignore[attr-defined]


_sqlite_uuid_patch()


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def integration_engine():
    """Create a shared in-memory SQLite engine for the integration test session."""
    engine = create_async_engine(
        SQLITE_URL,
        connect_args={"check_same_thread": False},
        echo=False,
    )

    # Enable FK enforcement in SQLite
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        import uuid

        dbapi_conn.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(integration_engine) -> AsyncGenerator[AsyncSession, None]:
    """Each test gets a fresh session that rolls back all changes."""
    async with integration_engine.connect() as conn:
        await conn.begin_nested()
        session = AsyncSession(bind=conn, expire_on_commit=False)
        yield session
        await session.close()
        await conn.rollback()


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    limiter._storage = storage_from_string("memory://")
    limiter.limiter.storage = limiter._storage
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def seeded_business(db_session: AsyncSession):
    from apps.api.core.security import hash_password
    from apps.api.modules.admin.models import PlatformAdmin
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business, BusinessMember

    user = User(phone="+233244999001", name="Test Owner")
    db_session.add(user)
    await db_session.flush([user])

    admin = PlatformAdmin(
        id=user.id,
        email="admin@example.com",
        hashed_password=hash_password("admin-password"),
        allowed_ips=[],
        is_active=True,
    )
    db_session.add(admin)
    await db_session.flush([admin])

    biz = Business(owner_id=user.id, name="Test Shop", type="shop")
    db_session.add(biz)
    await db_session.flush([biz])

    member = BusinessMember(business_id=biz.id, user_id=user.id, role="owner")
    db_session.add(member)
    await db_session.flush()

    kyc = KYCVerification(
        business_id=biz.id,
        user_id=user.id,
        ghana_card_id="GHA-123456789-1",
        tin="C0012345678",
        status="verified",
        provider="test",
        provider_ref="seeded",
    )
    db_session.add(kyc)
    await db_session.flush([kyc])
    return {"business": biz, "user": user, "member": member}


@pytest_asyncio.fixture
async def seeded_item(db_session: AsyncSession, seeded_business):
    from decimal import Decimal

    from apps.api.modules.inventory.models import Item

    item = Item(
        business_id=seeded_business["business"].id,
        name="Test Tomatoes",
        unit="kg",
        cost_price=Decimal("8.00"),
        sell_price=Decimal("12.00"),
        current_stock=Decimal("100"),
        low_stock_threshold=Decimal("10"),
    )
    db_session.add(item)
    await db_session.flush([item])
    return item


@pytest.fixture
def auth_headers(seeded_business) -> dict[str, str]:
    from apps.api.core.security import create_access_token

    biz = seeded_business["business"]
    user = seeded_business["user"]
    token = create_access_token(user_id=user.id, business_id=biz.id, role="owner")
    return {"Authorization": f"Bearer {token}"}
