from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from apps.api.modules.agent_network.service import AgentNetworkService


def _make_db_with_result(scalar_value=None, scalars_value=None):
    """
    Build a mock AsyncSession where db.execute() is awaitable and returns a
    synchronous result object (matching SQLAlchemy async session behaviour:
    only the execute() call itself is awaited; the result methods are sync).
    """
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = scalar_value
    if scalars_value is not None:
        execute_result.scalars.return_value.all.return_value = scalars_value

    mock_db = AsyncMock()
    # Make execute() return the synchronous result mock when awaited
    mock_db.execute.return_value = execute_result
    return mock_db


class TestCommissionRates:
    @pytest.mark.asyncio
    async def test_get_commission_rate_uses_db_config(self):
        mock_config = MagicMock()
        mock_config.rate = Decimal("7.50")
        mock_db = _make_db_with_result(scalar_value=mock_config)

        service = AgentNetworkService(mock_db)
        rate = await service.get_commission_rate("onboarding")
        assert rate == Decimal("7.50")

    @pytest.mark.asyncio
    async def test_get_commission_rate_falls_back_to_default(self):
        mock_db = _make_db_with_result(scalar_value=None)

        service = AgentNetworkService(mock_db)
        rate = await service.get_commission_rate("onboarding")
        assert rate == Decimal("5.00")  # default fallback

    @pytest.mark.asyncio
    async def test_upsert_commission_rate_creates_new(self):
        mock_db = _make_db_with_result(scalar_value=None)

        service = AgentNetworkService(mock_db)
        await service.upsert_commission_rate("onboarding", Decimal("8.00"))
        mock_db.add.assert_called_once()
        mock_db.flush.assert_called_once()

    @pytest.mark.asyncio
    async def test_upsert_commission_rate_updates_existing(self):
        existing = MagicMock()
        existing.rate = Decimal("5.00")
        mock_db = _make_db_with_result(scalar_value=existing)

        service = AgentNetworkService(mock_db)
        await service.upsert_commission_rate(
            "onboarding", Decimal("8.00"), updated_by="admin@test.com"
        )
        assert existing.rate == Decimal("8.00")
        assert existing.updated_by == "admin@test.com"
        mock_db.add.assert_not_called()
        mock_db.flush.assert_called_once()

    @pytest.mark.asyncio
    async def test_list_commission_rates_returns_all(self):
        mock_rates = [
            MagicMock(event_type="onboarding", rate=Decimal("5.00")),
            MagicMock(event_type="first_sale", rate=Decimal("10.00")),
        ]
        mock_db = _make_db_with_result(scalars_value=mock_rates)

        service = AgentNetworkService(mock_db)
        rates = await service.list_commission_rates()
        assert len(rates) == 2

    @pytest.mark.asyncio
    async def test_get_commission_rate_unknown_event_type_returns_zero(self):
        mock_db = _make_db_with_result(scalar_value=None)

        service = AgentNetworkService(mock_db)
        rate = await service.get_commission_rate("unknown_event_xyz")
        assert rate == Decimal("0.00")
