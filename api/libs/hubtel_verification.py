"""Hubtel phone-name verification client."""

from __future__ import annotations

from dataclasses import dataclass

import httpx
import structlog

from apps.api.core.config import get_settings
from apps.api.core.phone import normalize_ghana_phone

logger = structlog.get_logger()

HUBTEL_CHANNELS = ("mtn-gh", "vodafone-gh", "tigo-gh")

_PREFIX_CHANNELS: dict[str, str] = {
    # MTN Ghana
    "24": "mtn-gh",
    "25": "mtn-gh",
    "53": "mtn-gh",
    "54": "mtn-gh",
    "55": "mtn-gh",
    "59": "mtn-gh",
    # Vodafone / Telecel Ghana
    "20": "vodafone-gh",
    "50": "vodafone-gh",
    # AirtelTigo Ghana
    "26": "tigo-gh",
    "27": "tigo-gh",
    "56": "tigo-gh",
    "57": "tigo-gh",
}


@dataclass(frozen=True)
class HubtelPhoneVerification:
    name: str
    channel: str
    provider_ref: str | None = None


def _digits_after_country_code(phone: str) -> str:
    normalized = normalize_ghana_phone(phone)
    return normalized.removeprefix("+233")


def infer_hubtel_channels(phone: str) -> list[str]:
    """Return likely Hubtel channels for a Ghana phone, preferred channel first."""
    national = _digits_after_country_code(phone)
    preferred = _PREFIX_CHANNELS.get(national[:2])
    if preferred is None:
        return list(HUBTEL_CHANNELS)
    return [preferred, *[channel for channel in HUBTEL_CHANNELS if channel != preferred]]


class HubtelPhoneVerifier:
    """Fail-open Hubtel registered-name lookup for Ghana mobile money numbers."""

    def __init__(self) -> None:
        settings = get_settings()
        self.enabled = settings.HUBTEL_VERIFY_ENABLED
        self.account_number = settings.HUBTEL_ACCOUNT_NUMBER
        self.client_id = settings.HUBTEL_CLIENT_ID
        self.client_secret = settings.HUBTEL_CLIENT_SECRET
        self.base_url = settings.HUBTEL_VERIFY_BASE_URL.rstrip("/")
        self.timeout = settings.HUBTEL_VERIFY_TIMEOUT_SECONDS

    async def lookup_name(self, phone: str) -> HubtelPhoneVerification | None:
        if not self._is_configured:
            return None

        normalized = normalize_ghana_phone(phone)
        path = f"/merchantaccount/merchants/{self.account_number}/mobilemoney/verify"

        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                auth=(self.client_id, self.client_secret),
            ) as client:
                for channel in infer_hubtel_channels(normalized):
                    result = await self._lookup_channel(client, path, channel, normalized)
                    if result is not None:
                        return result
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning(
                "hubtel.phone_lookup.failed",
                phone_suffix=normalized[-4:],
                error=exc.__class__.__name__,
            )
        return None

    async def _lookup_channel(
        self,
        client: httpx.AsyncClient,
        path: str,
        channel: str,
        phone: str,
    ) -> HubtelPhoneVerification | None:
        response = await client.get(
            path,
            params={"channel": channel, "customerMsisdn": phone},
        )
        if response.status_code in {400, 404, 422}:
            return None
        response.raise_for_status()

        payload = response.json()
        data = payload.get("Data") or payload.get("data") or {}
        response_code = payload.get("ResponseCode") or payload.get("responseCode")
        name = str(data.get("Name") or data.get("name") or "").strip()
        is_registered = data.get("IsRegistered", data.get("isRegistered"))

        if response_code == "0000" and is_registered is True and name:
            logger.info(
                "hubtel.phone_lookup.succeeded",
                phone_suffix=phone[-4:],
                channel=channel,
            )
            provider_ref = data.get("AccountNumber") or data.get("accountNumber")
            return HubtelPhoneVerification(name=name, channel=channel, provider_ref=provider_ref)
        return None

    @property
    def _is_configured(self) -> bool:
        return bool(
            self.enabled
            and self.account_number
            and self.client_id
            and self.client_secret
            and self.base_url
        )
