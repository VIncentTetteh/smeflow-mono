"""Unit tests for Paystack subscription billing integration."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestCreatePaystackSubscription:
    @pytest.mark.asyncio
    async def test_create_paystack_subscription_calls_api(self):
        """create_paystack_subscription should POST to Paystack and return subscription data."""
        mock_db = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "status": True,
            "data": {
                "subscription_code": "SUB_testxyz",
                "customer": {"customer_code": "CUS_testabc"},
            },
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            from apps.api.modules.billing.service import BillingService

            service = BillingService(mock_db)
            result = await service.create_paystack_subscription(
                business_id="biz-123",
                email="owner@example.com",
                plan_code="PLN_starter",
            )
            assert result["subscription_code"] == "SUB_testxyz"


class TestHandlePaystackWebhook:
    @pytest.mark.asyncio
    async def test_handle_paystack_webhook_subscription_active_upgrades_tier(self):
        """handle_paystack_webhook with subscription.active event should upgrade business tier."""
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock()

        from apps.api.modules.billing.service import BillingService

        service = BillingService(mock_db)

        payload = {
            "event": "subscription.active",
            "data": {
                "subscription_code": "SUB_testxyz",
                "customer": {
                    "metadata": {"business_id": "biz-123"},
                    "customer_code": "CUS_testabc",
                },
                "plan": {"name": "starter"},
            },
        }

        # Should not raise; internally calls _update_subscription_tier
        with patch.object(
            service, "_update_subscription_tier", new_callable=AsyncMock
        ) as mock_update:
            await service.handle_paystack_webhook(payload)
            mock_update.assert_called_once_with("biz-123", "starter")

    @pytest.mark.asyncio
    async def test_handle_paystack_webhook_subscription_disabled_downgrades_to_free(self):
        """handle_paystack_webhook with subscription.disable should downgrade to free."""
        mock_db = AsyncMock()

        from apps.api.modules.billing.service import BillingService

        service = BillingService(mock_db)

        payload = {
            "event": "subscription.disable",
            "data": {
                "subscription_code": "SUB_testxyz",
                "customer": {
                    "metadata": {"business_id": "biz-456"},
                    "customer_code": "CUS_testabc",
                },
                "plan": {"name": "pro"},
            },
        }

        with patch.object(
            service, "_update_subscription_tier", new_callable=AsyncMock
        ) as mock_update:
            await service.handle_paystack_webhook(payload)
            mock_update.assert_called_once_with("biz-456", "free")

    @pytest.mark.asyncio
    async def test_handle_paystack_webhook_missing_business_id_is_noop(self):
        """handle_paystack_webhook with no business_id in metadata should silently no-op."""
        mock_db = AsyncMock()

        from apps.api.modules.billing.service import BillingService

        service = BillingService(mock_db)

        payload = {
            "event": "subscription.active",
            "data": {
                "customer": {"metadata": {}},
                "plan": {"name": "starter"},
            },
        }

        with patch.object(
            service, "_update_subscription_tier", new_callable=AsyncMock
        ) as mock_update:
            await service.handle_paystack_webhook(payload)
            mock_update.assert_not_called()
