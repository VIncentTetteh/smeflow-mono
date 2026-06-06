"""Unit tests for the email notification channel via Resend."""

from unittest.mock import patch

import pytest


class TestEmailChannel:
    @pytest.mark.asyncio
    async def test_send_email_calls_resend_when_key_configured(self, monkeypatch):
        monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
        # Clear settings cache so the monkeypatch takes effect
        from apps.api.core.config import get_settings

        get_settings.cache_clear()

        with patch("resend.Emails.send") as mock_send:
            mock_send.return_value = {"id": "abc123"}
            from apps.api.modules.notifications.service import send_email

            await send_email("test@example.com", "Hello", "<p>Hello world</p>")
            mock_send.assert_called_once()
            call_args = mock_send.call_args[0][0]
            assert call_args["to"] == ["test@example.com"]
            assert call_args["subject"] == "Hello"

        # Reset settings cache
        get_settings.cache_clear()

    @pytest.mark.asyncio
    async def test_send_email_skips_when_no_api_key(self, monkeypatch):
        monkeypatch.setenv("RESEND_API_KEY", "")
        from apps.api.core.config import get_settings

        get_settings.cache_clear()

        with patch("resend.Emails.send") as mock_send:
            from apps.api.modules.notifications.service import send_email

            await send_email("test@example.com", "Hello", "<p>Hello</p>")
            mock_send.assert_not_called()

        # Reset settings cache
        get_settings.cache_clear()
