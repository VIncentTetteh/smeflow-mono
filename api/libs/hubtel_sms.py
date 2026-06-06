"""Hubtel SMS client — Quick Send and Regular Send."""

from __future__ import annotations

import httpx
import structlog

from apps.api.core.config import get_settings

logger = structlog.get_logger()


class HubtelSmsClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.client_id = settings.HUBTEL_CLIENT_ID
        self.client_secret = settings.HUBTEL_CLIENT_SECRET
        self.sender_id = settings.HUBTEL_SMS_SENDER_ID
        self.base_url = settings.HUBTEL_SMS_BASE_URL.rstrip("/")

    async def send(self, to: str, content: str) -> dict:
        """Regular Send via POST with Basic auth."""
        async with httpx.AsyncClient(
            auth=(self.client_id, self.client_secret), timeout=10
        ) as client:
            resp = await client.post(
                f"{self.base_url}/v1/messages/send",
                json={"From": self.sender_id, "To": to, "Content": content},
            )
            resp.raise_for_status()
            data = resp.json()
        logger.info("hubtel.sms.sent", to=to[-4:], message_id=data.get("messageId"))
        return data

    async def quick_send(self, to: str, content: str) -> dict:
        """Quick Send via GET with query params."""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{self.base_url}/v1/messages/send",
                params={
                    "clientid": self.client_id,
                    "clientsecret": self.client_secret,
                    "from": self.sender_id,
                    "to": to,
                    "content": content,
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def get_status(self, message_id: str) -> dict:
        """Query message delivery status by messageId."""
        async with httpx.AsyncClient(
            auth=(self.client_id, self.client_secret), timeout=10
        ) as client:
            resp = await client.get(f"{self.base_url}/v1/messages/{message_id}")
            resp.raise_for_status()
            return resp.json()
