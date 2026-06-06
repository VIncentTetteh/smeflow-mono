"""Payment provider registry.

All three Ghana MNOs (MTN, Vodafone/Telecel, AirtelTigo) are routed through
Paystack's unified mobile_money API via a single PAYSTACK_SECRET_KEY.
"""

from __future__ import annotations

from decimal import Decimal

from apps.api.core.exceptions import PaymentCapabilityError
from libs.payment_clients.base import (
    DisbursementResponse,
    PaymentInitResponse,
    PaymentProvider,
    PaymentStatus,
)

_SUPPORTED_PROVIDERS = {"mtn", "vodafone", "telecel", "airteltigo"}


class UnsupportedProvider(PaymentProvider):
    """Adapter returned when a provider is recognised but credentials are missing."""

    def __init__(self, provider: str) -> None:
        self.provider = provider

    async def request_payment(
        self, amount: Decimal, phone: str, reference: str, description: str
    ) -> PaymentInitResponse:
        raise PaymentCapabilityError(self.provider, "collections")

    async def check_status(self, external_ref: str) -> PaymentStatus:
        raise PaymentCapabilityError(self.provider, "status checks")

    async def disburse(
        self, amount: Decimal, phone: str, reference: str, description: str
    ) -> DisbursementResponse:
        raise PaymentCapabilityError(self.provider, "disbursements")

    def verify_webhook(self, payload: dict, signature: str) -> bool:
        return False


def get_payment_provider(provider: str) -> PaymentProvider:
    """
    Return the correct PaymentProvider for a given network name.

    All Ghana MNOs route through Paystack:
      mtn        → PaystackClient(provider="mtn")   → Paystack code "mtn"
      vodafone   → PaystackClient(provider="vodafone") → Paystack code "vod"
      telecel    → PaystackClient(provider="telecel")  → Paystack code "vod"
      airteltigo → PaystackClient(provider="airteltigo") → Paystack code "atl"

    Raises PaymentCapabilityError for unrecognised provider names.
    Returns UnsupportedProvider when PAYSTACK_SECRET_KEY is not configured.
    """
    from apps.api.core.config import get_settings

    normalized = provider.lower()

    if normalized not in _SUPPORTED_PROVIDERS:
        raise PaymentCapabilityError(normalized, "payments")

    settings = get_settings()
    if not settings.PAYSTACK_SECRET_KEY:
        return UnsupportedProvider(normalized)

    from libs.payment_clients.paystack import PaystackClient

    return PaystackClient(provider=normalized)
