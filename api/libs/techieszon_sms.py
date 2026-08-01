"""Techieszon SMS client — GET-based send + balance check."""

from __future__ import annotations

import httpx
import structlog

from apps.api.core.config import get_settings

logger = structlog.get_logger()


class TechieszonSmsClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.api_key = settings.TECHIESZON_SMS_API_KEY
        self.sender_id = settings.TECHIESZON_SMS_SENDER_ID
        self.base_url = settings.TECHIESZON_SMS_BASE_URL.rstrip("/")

    async def send(self, to: str, content: str, *, unicode: bool = False, **extra: str) -> dict:
        """Send an SMS via GET request.

        `extra` passes through untested query params (voice=1, mms=1, media_url=...,
        schedule=...) documented by the provider but not exercised by this v1 client.
        """
        params: dict[str, str] = {
            "action": "send-sms",
            "api_key": self.api_key,
            "to": to,
            "from": self.sender_id,
            "sms": content,
        }
        if unicode:
            params["unicode"] = "1"
        params.update(extra)

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(self.base_url, params=params)
            resp.raise_for_status()
            data = self._parse_response(resp)
        logger.info("techieszon.sms.sent", to=to[-4:])
        return data

    async def get_balance(self) -> dict:
        """Check remaining SMS credit balance."""
        params = {"action": "check-balance", "api_key": self.api_key, "response": "json"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(self.base_url, params=params)
            resp.raise_for_status()
            return self._parse_response(resp)

    @staticmethod
    def _parse_response(resp: httpx.Response) -> dict:
        """Response shape is undocumented beyond 'json' — parse defensively."""
        try:
            return resp.json()
        except ValueError:
            return {"raw": resp.text}
