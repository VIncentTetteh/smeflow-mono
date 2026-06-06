"""Abstract payment provider interface."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

PaymentStatus = Literal["pending", "success", "failed", "reversed"]


@dataclass
class PaymentInitResponse:
    external_ref: str
    status: PaymentStatus
    provider_message: str = ""


@dataclass
class DisbursementResponse:
    external_ref: str
    status: PaymentStatus
    provider_message: str = ""


class PaymentProvider(ABC):
    """Base interface all MoMo providers must implement."""

    @abstractmethod
    async def request_payment(
        self, amount: Decimal, phone: str, reference: str, description: str
    ) -> PaymentInitResponse: ...

    @abstractmethod
    async def check_status(self, external_ref: str) -> PaymentStatus: ...

    @abstractmethod
    async def disburse(
        self, amount: Decimal, phone: str, reference: str, description: str
    ) -> DisbursementResponse: ...

    @abstractmethod
    def verify_webhook(self, payload: dict, signature: str) -> bool: ...
