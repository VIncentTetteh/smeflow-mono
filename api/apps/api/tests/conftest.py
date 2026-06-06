"""
Pytest fixtures shared across all test modules.
Uses an in-memory SQLite-compatible test DB via asyncpg test containers,
or a dedicated test PostgreSQL DB specified by TEST_DATABASE_URL env var.
"""

import asyncio
import os
from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("ADMIN_ALLOWED_IPS", "127.0.0.1/32")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("FREE_TIER_MONTHLY_SALES", "50")
os.environ.setdefault("PAYSTACK_SECRET_KEY", "")

from apps.api.core.database import Base, get_db
from apps.api.main import app

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://smeflow:smeflow@localhost:5432/smeflow_test",
)

# ── Test engine ───────────────────────────────────────────────────────────────
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest.fixture(scope="session")
def event_loop():
    """Create a single event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def create_tables():
    """Create all tables once per session, drop them after.
    Only requested by integration tests that need a live DB.
    """
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session(create_tables) -> AsyncGenerator[AsyncSession, None]:
    """Provide a test DB session that rolls back after each test."""
    async with test_engine.connect() as conn:
        await conn.begin()
        session = AsyncSession(bind=conn, expire_on_commit=False)
        yield session
        await session.close()
        await conn.rollback()


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """HTTPX async client with the test DB injected via FastAPI dependency override."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


# ── Auth helpers ──────────────────────────────────────────────────────────────
@pytest.fixture
def test_phone() -> str:
    return "+233244123456"


@pytest_asyncio.fixture
async def auth_headers(async_client: AsyncClient, test_phone: str) -> dict[str, str]:
    """Get auth headers for a test user (creates user + business if needed)."""
    from apps.api.core.security import create_access_token

    user_id = uuid4()
    business_id = uuid4()
    token = create_access_token(user_id=user_id, business_id=business_id, role="owner")
    return {"Authorization": f"Bearer {token}"}


# ── Data factories ────────────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def seeded_business(db_session: AsyncSession):
    """Create a test business and return it."""
    from apps.api.modules.auth.models import User
    from apps.api.modules.business.models import Business, BusinessMember
    from apps.api.modules.kyc.models import KYCVerification

    user = User(phone="+233244999001", name="Test Owner")
    db_session.add(user)
    await db_session.flush([user])

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

    return biz


@pytest_asyncio.fixture
async def seeded_item(db_session: AsyncSession, seeded_business):
    """Create a test inventory item with 100 units."""
    from decimal import Decimal

    from apps.api.modules.inventory.models import Item

    item = Item(
        business_id=seeded_business.id,
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
