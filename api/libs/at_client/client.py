"""Africa's Talking API client implementation."""

from typing import Any

import httpx
import structlog
from pydantic import BaseModel, Field

from .exceptions import (
    ATAuthenticationError,
    ATError,
    ATInsufficientBalanceError,
    ATValidationError,
)

logger = structlog.get_logger()


class SMSMessage(BaseModel):
    """SMS message model."""

    to: str = Field(..., description="Recipient phone number in international format")
    message: str = Field(..., description="SMS message content")
    from_: str | None = Field(None, alias="from", description="Sender ID")


class SMSResponse(BaseModel):
    """Response from SMS API."""

    SMSMessageData: dict[str, Any] = Field(..., description="SMS message data")


class SMSRecipients(BaseModel):
    """SMS recipient information."""
    number: str
    cost: str
    status: str
    statusCode: int
    messageId: str


class BulkSMSResponse(BaseModel):
    """Response from bulk SMS API."""

    SMSMessageData: dict[str, Any] = Field(..., description="Bulk SMS message data")


class ATClient:
    """Africa's Talking API client."""

    def __init__(
        self,
        api_key: str,
        username: str,
        base_url: str = "https://api.africastalking.com",
        timeout: int = 30,
    ) -> None:
        self.api_key = api_key
        self.username = username
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers={
                "apiKey": api_key,
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self._client.aclose()

    async def _make_request(
        self,
        method: str,
        endpoint: str,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Make HTTP request to Africa's Talking API."""
        url = f"{self.base_url}{endpoint}"

        try:
            if method.upper() == "POST":
                response = await self._client.post(url, data=data)
            else:
                response = await self._client.get(url, params=data)

            response.raise_for_status()
            result = response.json()

            # Check for API-level errors
            if "SMSMessageData" in result:
                sms_data = result["SMSMessageData"]
                if "Recipients" in sms_data:
                    for recipient in sms_data["Recipients"]:
                        if recipient.get("statusCode") != 101:  # 101 = Success
                            self._handle_error(recipient.get("statusCode"), recipient.get("status"))

            return result

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise ATAuthenticationError("Invalid API key or username") from e
            elif e.response.status_code == 400:
                raise ATValidationError(f"Invalid request: {e.response.text}") from e
            elif e.response.status_code >= 500:
                raise ATError(f"Server error: {e.response.status_code}") from e
            else:
                raise ATError(
                    f"HTTP error: {e.response.status_code} - {e.response.text}"
                ) from e
        except httpx.RequestError as e:
            raise ATError(f"Request failed: {e!s}") from e

    def _handle_error(self, status_code: int, status: str) -> None:
        """Handle Africa's Talking specific error codes."""
        if status_code == 401:
            raise ATAuthenticationError("Invalid API key or username")
        elif status_code == 402:
            raise ATInsufficientBalanceError("Insufficient account balance")
        elif status_code == 403:
            raise ATValidationError("Invalid sender ID")
        elif status_code == 404:
            raise ATValidationError("Invalid phone number")
        elif status_code == 405:
            raise ATValidationError("Invalid message content")
        elif status_code == 406:
            raise ATValidationError("Invalid destination")
        elif status_code >= 500:
            raise ATError(f"Server error: {status}")
        elif status_code != 101:  # Not success
            raise ATError(f"SMS failed: {status}")

    async def send_sms(
        self,
        to: str | list[str],
        message: str,
        from_: str | None = None,
        enqueue: bool = False,
    ) -> BulkSMSResponse:
        """
        Send SMS message(s).

        Args:
            to: Phone number(s) to send to (international format)
            message: SMS message content
            from_: Sender ID (optional)
            enqueue: Whether to enqueue message if network busy

        Returns:
            BulkSMSResponse with delivery information
        """
        if isinstance(to, str):
            to = [to]

        # Validate phone numbers (basic check)
        for phone in to:
            if not phone.startswith("+"):
                logger.warning("Phone number should be in international format", phone=phone)

        data = {
            "username": self.username,
            "to": ",".join(to),
            "message": message,
        }

        if from_:
            data["from"] = from_

        if enqueue:
            data["enqueue"] = "1"

        logger.info(
            "Sending SMS",
            recipient_count=len(to),
            sender_id=from_,
            message_length=len(message),
        )

        result = await self._make_request("POST", "/version1/messaging", data)
        return BulkSMSResponse(**result)

    async def send_single_sms(
        self,
        to: str,
        message: str,
        from_: str | None = None,
    ) -> SMSResponse:
        """
        Send single SMS message.

        Args:
            to: Phone number in international format
            message: SMS message content
            from_: Sender ID (optional)

        Returns:
            SMSResponse with delivery information
        """
        return await self.send_sms([to], message, from_)

    async def get_account_balance(self) -> dict[str, Any]:
        """
        Get account balance.

        Returns:
            Account balance information
        """
        data = {"username": self.username}
        return await self._make_request("GET", "/version1/user", data)

    async def get_sms_delivery_reports(
        self,
        message_id: str | None = None,
        phone_number: str | None = None,
        last_received_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Get SMS delivery reports.

        Args:
            message_id: Specific message ID to check
            phone_number: Phone number to check
            last_received_id: Last received ID for pagination

        Returns:
            Delivery report data
        """
        data = {"username": self.username}

        if message_id:
            data["messageId"] = message_id
        if phone_number:
            data["phoneNumber"] = phone_number
        if last_received_id:
            data["lastReceivedId"] = last_received_id

        return await self._make_request("GET", "/version1/messaging/delivery-reports", data)