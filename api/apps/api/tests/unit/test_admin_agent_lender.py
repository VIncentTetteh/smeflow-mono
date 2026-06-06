"""Unit tests for admin-scoped agent and lender management."""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest


class TestAdminAgentService:
    @pytest.mark.asyncio
    async def test_list_agents_returns_paginated_result(self):
        from apps.api.modules.agent_network.service import AgentNetworkService

        mock_db = AsyncMock()
        agent = MagicMock()
        agent.id = uuid4()
        agent.region = "Greater Accra"
        agent.is_active = True
        agent.onboarded_count = 5
        agent.total_commission_earned = Decimal("25.00")

        # list_agents makes 2 execute calls: count query, then items query
        count_result = MagicMock()
        count_result.scalar_one.return_value = 1
        items_result = MagicMock()
        items_result.scalars.return_value.all.return_value = [agent]
        mock_db.execute.side_effect = [count_result, items_result]

        service = AgentNetworkService(mock_db)
        agents, total = await service.list_agents()
        assert total == 1
        assert len(agents) == 1


class TestAdminLenderService:
    @pytest.mark.asyncio
    async def test_list_all_lenders_returns_paginated(self):
        from apps.api.modules.lender.service import LenderService

        mock_db = AsyncMock()
        lender = MagicMock()
        lender.id = uuid4()
        lender.lender_id = "ghanafin"
        lender.name = "GhanaFin Ltd"
        lender.is_active = True

        count_result = MagicMock()
        count_result.scalar_one.return_value = 1
        items_result = MagicMock()
        items_result.scalars.return_value.all.return_value = [lender]
        mock_db.execute.side_effect = [count_result, items_result]

        service = LenderService(mock_db)
        lenders, total = await service.list_all_lenders()
        assert total == 1
        assert lenders[0].lender_id == "ghanafin"

    @pytest.mark.asyncio
    async def test_create_lender_partner_returns_api_key(self):
        from apps.api.modules.lender.service import LenderService

        mock_db = AsyncMock()

        service = LenderService(mock_db)
        with patch("apps.api.modules.lender.service.get_settings") as mock_settings:
            mock_settings.return_value.LENDER_API_KEY_EXPIRY_DAYS = 365
            _partner, api_key, temporary_password = await service.create_partner(
                lender_id="testlender",
                name="Test Lender",
                contact_email="admin@test.com",
            )
        assert api_key.startswith("lf_")
        assert temporary_password.startswith("Sf-")
        mock_db.add.assert_called_once()
        mock_db.flush.assert_called_once()

    @pytest.mark.asyncio
    async def test_list_agents_with_region_filter(self):
        from apps.api.modules.agent_network.service import AgentNetworkService

        mock_db = AsyncMock()
        count_result = MagicMock()
        count_result.scalar_one.return_value = 0
        items_result = MagicMock()
        items_result.scalars.return_value.all.return_value = []
        mock_db.execute.side_effect = [count_result, items_result]

        service = AgentNetworkService(mock_db)
        agents, total = await service.list_agents(region="Greater Accra")
        assert total == 0
        assert agents == []
        # Verify execute was called twice (count + items)
        assert mock_db.execute.call_count == 2

    @pytest.mark.asyncio
    async def test_list_all_lenders_empty_returns_zero(self):
        from apps.api.modules.lender.service import LenderService

        mock_db = AsyncMock()
        count_result = MagicMock()
        count_result.scalar_one.return_value = 0
        items_result = MagicMock()
        items_result.scalars.return_value.all.return_value = []
        mock_db.execute.side_effect = [count_result, items_result]

        service = LenderService(mock_db)
        lenders, total = await service.list_all_lenders()
        assert total == 0
        assert lenders == []


class TestAdminLoanActions:
    @pytest.mark.asyncio
    async def test_admin_loan_action_approve_updates_pending_loan_and_audits(self):
        from apps.api.modules.admin.service import AdminService
        from apps.api.modules.credit.models import LoanRequest

        loan = LoanRequest(
            id=uuid4(),
            business_id=uuid4(),
            amount_requested=Decimal("250.00"),
            term_days=30,
            status="pending_partner",
        )
        actor_id = uuid4()

        result = MagicMock()
        result.scalar_one_or_none.return_value = loan
        mock_db = AsyncMock()
        mock_db.execute.return_value = result

        with patch("apps.api.modules.admin.service.audit", new_callable=AsyncMock) as audit_mock:
            updated = await AdminService(mock_db).action_loan(
                loan_id=loan.id,
                action="approve",
                actor_id=actor_id,
            )

        assert updated.status == "approved"
        assert updated.amount_approved == Decimal("250.00")
        assert updated.interest_rate == Decimal("0.00")
        mock_db.flush.assert_called_once()
        audit_mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_admin_loan_action_flag_audits_without_status_change(self):
        from apps.api.modules.admin.service import AdminService
        from apps.api.modules.credit.models import LoanRequest

        loan = LoanRequest(
            id=uuid4(),
            business_id=uuid4(),
            amount_requested=Decimal("100.00"),
            term_days=14,
            status="approved",
        )
        actor_id = uuid4()

        result = MagicMock()
        result.scalar_one_or_none.return_value = loan
        mock_db = AsyncMock()
        mock_db.execute.return_value = result

        with patch("apps.api.modules.admin.service.audit", new_callable=AsyncMock) as audit_mock:
            updated = await AdminService(mock_db).action_loan(
                loan_id=loan.id,
                action="flag",
                actor_id=actor_id,
                reason="Manual risk review",
            )

        assert updated.status == "approved"
        mock_db.flush.assert_not_called()
        audit_mock.assert_called_once()
