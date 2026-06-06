"""
Paystack client for Ghana — single payment rail for all three MNOs.

Paystack's mobile_money charge endpoint covers MTN, Vodafone/Telecel, and
AirtelTigo through a single API key, eliminating the need for direct bilateral
MNO integrations.  This client also wraps Paystack's Transfer, Subscription,
Dedicated Virtual Account, Payment Page, Subaccount, and Split APIs.

API reference:
  https://paystack.com/docs/payments/mobile-money/
  https://paystack.com/docs/api/charge/
  https://paystack.com/docs/api/transfer/
  https://paystack.com/docs/api/dedicated-virtual-account/
  https://paystack.com/docs/api/subscription/
  https://paystack.com/docs/api/subaccount/

Provider codes (Ghana):
  mtn        → "mtn"  (MTN Mobile Money)
  vodafone   → "vod"  (Vodafone/Telecel Cash)
  telecel    → "vod"  (Telecel = rebranded Vodafone Ghana)
  airteltigo → "atl"  (AirtelTigo Money)
"""

from __future__ import annotations

import hashlib
import hmac
import json
from decimal import Decimal

import httpx
import structlog

from apps.api.core.config import get_settings
from libs.payment_clients.base import (
    DisbursementResponse,
    PaymentInitResponse,
    PaymentProvider,
    PaymentStatus,
)

logger = structlog.get_logger()

# Maps our internal provider names → Paystack provider codes
_PROVIDER_CODES: dict[str, str] = {
    "mtn": "mtn",
    "vodafone": "vod",
    "telecel": "vod",  # Telecel = rebranded Vodafone Ghana, same Paystack code
    "airteltigo": "atl",
}

# Maps Paystack transaction status strings → our internal status
_STATUS_MAP: dict[str, PaymentStatus] = {
    "success": "success",
    "failed": "failed",
    "abandoned": "failed",
    "reversed": "reversed",
    "pending": "pending",
    "ongoing": "pending",
    "processing": "pending",
}


class PaystackClient(PaymentProvider):
    """
    Paystack payment provider wrapping mobile-money charge + transfer APIs.

    Collections  → POST /charge  (mobile_money)
    Status check → GET  /transaction/verify/{reference}
    Disbursements→ POST /transfer  (requires a Transfer Recipient first)
    Webhook sig  → X-Paystack-Signature: HMAC-SHA512 of raw body with secret key
    """

    def __init__(self, provider: str = "vodafone") -> None:
        settings = get_settings()
        self._secret = settings.PAYSTACK_SECRET_KEY
        self._base_url = settings.PAYSTACK_BASE_URL
        self._provider_code = _PROVIDER_CODES.get(provider.lower(), provider.lower())
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=30.0,
            headers={
                "Authorization": f"Bearer {self._secret}",
                "Content-Type": "application/json",
            },
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _kobo(self, amount: Decimal) -> int:
        """Convert GHS decimal to Paystack's integer kobo (1 GHS = 100 kobo)."""
        return int(amount * 100)

    @staticmethod
    def _derive_email(phone: str) -> str:
        """Paystack charge requires an email; derive a placeholder from phone."""
        digits = "".join(c for c in phone if c.isdigit())
        return f"{digits}@smeflow.app"

    @staticmethod
    def transaction_email(reference: str) -> str:
        """Return a transaction-specific placeholder email for unified checkout."""
        digest = hashlib.sha256(reference.encode()).hexdigest()[:24]
        return f"pay-{digest}@smeflow.app"

    async def _close(self) -> None:
        await self._http.aclose()

    # ── PaymentProvider interface ─────────────────────────────────────────────

    async def request_payment(
        self,
        amount: Decimal,
        phone: str,
        reference: str,
        description: str,
    ) -> PaymentInitResponse:
        """Initiate a mobile-money collection (debit from customer wallet)."""
        payload = {
            "amount": self._kobo(amount),
            "email": self._derive_email(phone),
            "currency": "GHS",
            "reference": reference,
            "mobile_money": {
                "phone": phone,
                "provider": self._provider_code,
            },
        }
        logger.info(
            "paystack.charge.initiating",
            provider=self._provider_code,
            phone=phone[-4:],
            amount=str(amount),
        )
        try:
            resp = await self._http.post("/charge", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text
            logger.error("paystack.charge.http_error", status=exc.response.status_code, body=body)
            raise

        status_str = data.get("data", {}).get("status", "pending")
        status: PaymentStatus = _STATUS_MAP.get(status_str, "pending")
        ext_ref = data.get("data", {}).get("reference", reference)
        msg = data.get("data", {}).get("display_text") or data.get("message", "")

        logger.info(
            "paystack.charge.initiated",
            reference=ext_ref,
            status=status,
            provider=self._provider_code,
        )
        return PaymentInitResponse(
            external_ref=ext_ref,
            status=status,
            provider_message=msg,
        )

    async def check_status(self, external_ref: str) -> PaymentStatus:
        """Verify transaction status by reference."""
        details = await self.verify_transaction_details(external_ref)
        return details["status"]

    async def verify_transaction_details(self, external_ref: str) -> dict:
        """Verify a transaction and return normalized status plus Paystack channel details."""
        try:
            resp = await self._http.get(f"/transaction/verify/{external_ref}")
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.verify.http_error",
                reference=external_ref,
                status=exc.response.status_code,
            )
            return {"status": "pending", "channel": None, "provider_detail": None}

        tx = data.get("data", {})
        authorization = tx.get("authorization") or {}
        status_str = tx.get("status", "pending")
        return {
            "status": _STATUS_MAP.get(status_str, "pending"),
            "channel": tx.get("channel") or authorization.get("channel"),
            "provider_detail": (
                authorization.get("brand")
                or authorization.get("bank")
                or authorization.get("provider")
            ),
            "raw": tx,
        }

    async def disburse(
        self,
        amount: Decimal,
        phone: str,
        reference: str,
        description: str,
    ) -> DisbursementResponse:
        """
        Send money to a mobile wallet via Paystack Transfers.

        Paystack Transfers require a Transfer Recipient object.  We create a
        single-use recipient for each disbursement (idempotent by account_number
        + bank_code on Paystack's side).
        """
        # Step 1: Create (or retrieve) a transfer recipient
        recipient_code = await self._get_or_create_recipient(phone)

        # Step 2: Initiate the transfer
        payload = {
            "source": "balance",
            "amount": self._kobo(amount),
            "recipient": recipient_code,
            "reason": description or "SMEFlow disbursement",
            "reference": reference,
            "currency": "GHS",
        }
        logger.info(
            "paystack.transfer.initiating",
            provider=self._provider_code,
            phone=phone[-4:],
            amount=str(amount),
        )
        try:
            resp = await self._http.post("/transfer", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text
            logger.error("paystack.transfer.http_error", status=exc.response.status_code, body=body)
            try:
                ps_message = exc.response.json().get("message", str(exc))
            except Exception:
                ps_message = str(exc)
            raise RuntimeError(ps_message) from exc

        status_str = data.get("data", {}).get("status", "pending")
        status: PaymentStatus = _STATUS_MAP.get(status_str, "pending")
        ext_ref = data.get("data", {}).get("transfer_code", reference)
        msg = data.get("message", "")

        logger.info(
            "paystack.transfer.initiated",
            transfer_code=ext_ref,
            status=status,
        )
        return DisbursementResponse(
            external_ref=ext_ref,
            status=status,
            provider_message=msg,
        )

    async def _get_or_create_recipient(self, phone: str) -> str:
        """Create a Paystack transfer recipient for a mobile wallet and return its code."""
        # Paystack GHS mobile money bank codes
        # (see https://paystack.com/docs/api/transfer-recipient/#create)
        gh_bank_codes = {
            "vod": "VOD",
            "atl": "ATL",
            "mtn": "MTN",
        }
        payload = {
            "type": "mobile_money",
            "name": phone,
            "account_number": phone,
            "bank_code": gh_bank_codes.get(self._provider_code, self._provider_code.upper()),
            "currency": "GHS",
        }
        try:
            resp = await self._http.post("/transferrecipient", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.recipient.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            try:
                ps_message = exc.response.json().get("message", str(exc))
            except Exception:
                ps_message = str(exc)
            raise RuntimeError(ps_message) from exc
        return data["data"]["recipient_code"]

    def verify_webhook(self, payload: dict, signature: str) -> bool:
        """
        Verify a Paystack webhook using HMAC-SHA512.

        Paystack sends X-Paystack-Signature: hex(HMAC-SHA512(secret, raw_body)).
        The caller must pass the raw request body as a JSON-serialised string, or
        call verify_webhook_raw() with the raw bytes directly.
        """
        if not self._secret or not signature:
            return False
        raw = json.dumps(payload, separators=(",", ":")).encode()
        expected = hmac.new(self._secret.encode(), raw, hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_webhook_raw(self, raw_body: bytes, signature: str) -> bool:
        """Verify Paystack webhook from the raw request body bytes."""
        if not self._secret or not signature:
            return False
        expected = hmac.new(self._secret.encode(), raw_body, hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, signature)

    # ── Customer & Dedicated Virtual Account ─────────────────────────────────

    async def create_customer(
        self, email: str, first_name: str, last_name: str, phone: str
    ) -> dict:
        """Create or retrieve a Paystack customer. Returns customer data dict."""
        payload = {
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "phone": phone,
        }
        logger.info("paystack.customer.creating", email=email)
        try:
            resp = await self._http.post("/customer", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.customer.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        logger.info(
            "paystack.customer.created", customer_code=data.get("data", {}).get("customer_code")
        )
        return data.get("data", {})

    async def create_dedicated_virtual_account(
        self, customer_code: str, preferred_bank: str = "wema-bank"
    ) -> dict:
        """Create a Dedicated Virtual Account for a customer. Returns DVA data dict."""
        payload = {"customer": customer_code, "preferred_bank": preferred_bank}
        logger.info("paystack.dva.creating", customer_code=customer_code, bank=preferred_bank)
        try:
            resp = await self._http.post("/dedicated_account", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.dva.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        dva = data.get("data", {})
        logger.info(
            "paystack.dva.created",
            account_number=dva.get("account_number"),
            bank=dva.get("bank", {}).get("name"),
        )
        return dva

    # ── Subscriptions & Plans ─────────────────────────────────────────────────

    async def create_plan(
        self, name: str, interval: str, amount_ghs: Decimal, currency: str = "GHS"
    ) -> dict:
        """Create a Paystack billing plan. interval: 'monthly'|'annually'. Returns plan data dict."""
        payload = {
            "name": name,
            "interval": interval,
            "amount": self._kobo(amount_ghs),
            "currency": currency,
        }
        logger.info(
            "paystack.plan.creating", name=name, interval=interval, amount_ghs=str(amount_ghs)
        )
        try:
            resp = await self._http.post("/plan", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.plan.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        plan = data.get("data", {})
        logger.info("paystack.plan.created", plan_code=plan.get("plan_code"))
        return plan

    async def create_subscription(self, customer: str, plan: str, authorization: str) -> dict:
        """Subscribe a customer to a plan. Returns subscription data dict."""
        payload = {"customer": customer, "plan": plan, "authorization": authorization}
        logger.info("paystack.subscription.creating", customer=customer, plan=plan)
        try:
            resp = await self._http.post("/subscription", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.subscription.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        sub = data.get("data", {})
        logger.info(
            "paystack.subscription.created",
            subscription_code=sub.get("subscription_code"),
        )
        return sub

    async def cancel_subscription(self, subscription_code: str, email_token: str) -> bool:
        """Disable (cancel) a Paystack subscription. Returns True on success."""
        payload = {"code": subscription_code, "token": email_token}
        logger.info("paystack.subscription.cancelling", subscription_code=subscription_code)
        try:
            resp = await self._http.post("/subscription/disable", json=payload)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.subscription.cancel_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            return False
        logger.info("paystack.subscription.cancelled", subscription_code=subscription_code)
        return True

    # ── Transaction Initialization ────────────────────────────────────────────

    async def initialize_transaction(
        self,
        email: str,
        amount_ghs: Decimal,
        reference: str,
        currency: str = "GHS",
        metadata: dict | None = None,
        callback_url: str | None = None,
    ) -> dict:
        """
        POST /transaction/initialize — one-time checkout link with pre-filled email.

        Unlike payment pages, this skips the customer info form entirely.
        Returns data dict with 'authorization_url', 'access_code', 'reference'.
        """
        payload: dict = {
            "email": email,
            "amount": self._kobo(amount_ghs),
            "reference": reference,
            "currency": currency,
        }
        if metadata:
            payload["metadata"] = metadata
        if callback_url:
            payload["callback_url"] = callback_url

        logger.info(
            "paystack.transaction.initializing",
            reference=reference,
            amount_ghs=str(amount_ghs),
        )
        try:
            resp = await self._http.post("/transaction/initialize", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.transaction.init_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        tx = data.get("data", {})
        logger.info(
            "paystack.transaction.initialized",
            reference=reference,
            authorization_url=tx.get("authorization_url"),
        )
        return tx

    # ── Payment Pages ─────────────────────────────────────────────────────────

    async def create_payment_page(
        self,
        name: str,
        reference: str,
        description: str = "",
        amount_ghs: Decimal | None = None,
    ) -> dict:
        """
        Create a hosted Paystack payment page.

        amount_ghs=None → customer enters amount on the page.
        Returns page data dict with an added 'url' key pointing to the hosted page.
        """
        payload: dict = {"name": name, "slug": reference, "description": description}
        if amount_ghs is not None:
            payload["amount"] = self._kobo(amount_ghs)
        logger.info("paystack.page.creating", name=name, reference=reference)
        try:
            resp = await self._http.post("/page", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.page.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        page = data.get("data", {})
        slug = page.get("slug", reference)
        page["url"] = f"https://paystack.com/pay/{slug}"
        logger.info("paystack.page.created", slug=slug, url=page["url"])
        return page

    # ── Subaccounts & Splits ──────────────────────────────────────────────────

    async def create_subaccount(
        self,
        business_name: str,
        settlement_bank: str,
        account_number: str,
        percentage_charge: float,
    ) -> dict:
        """Create a Paystack settlement subaccount for a partner. Returns subaccount data dict."""
        payload = {
            "business_name": business_name,
            "settlement_bank": settlement_bank,
            "account_number": account_number,
            "percentage_charge": percentage_charge,
        }
        logger.info(
            "paystack.subaccount.creating",
            business_name=business_name,
            pct=percentage_charge,
        )
        try:
            resp = await self._http.post("/subaccount", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.subaccount.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        sub = data.get("data", {})
        logger.info("paystack.subaccount.created", subaccount_code=sub.get("subaccount_code"))
        return sub

    async def create_split(
        self,
        name: str,
        subaccounts: list[dict],
        bearer_type: str = "account",
        currency: str = "GHS",
    ) -> dict:
        """
        Create a transaction split configuration.

        subaccounts: [{"subaccount": "ACCT_xxx", "share": 95}]  (share in %)
        Returns split data dict including split_code.
        """
        payload = {
            "name": name,
            "type": "percentage",
            "currency": currency,
            "subaccounts": subaccounts,
            "bearer_type": bearer_type,
        }
        logger.info("paystack.split.creating", name=name, count=len(subaccounts))
        try:
            resp = await self._http.post("/split", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.split.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        split = data.get("data", {})
        logger.info("paystack.split.created", split_code=split.get("split_code"))
        return split

    # ── Platform balance & recipient helpers ──────────────────────────────────

    async def get_balance(self) -> list[dict]:
        """GET /balance — returns the current Paystack balance for this account."""
        try:
            resp = await self._http.get("/balance")
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.balance.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            raise
        return data.get("data", [])

    async def verify_recipient(self, recipient_code: str) -> bool:
        """
        GET /transferrecipient/{code} — validate a recipient is still active.
        Returns True if active, False for not found / inactive.
        """
        try:
            resp = await self._http.get(f"/transferrecipient/{recipient_code}")
            if resp.status_code == 404:
                return False
            resp.raise_for_status()
            data = resp.json()
            return bool(data.get("data", {}).get("active", True))
        except httpx.HTTPStatusError:
            return False

    async def list_transfers(
        self, page: int = 1, per_page: int = 50, status: str | None = None
    ) -> dict:
        """GET /transfer — list transfers for reconciliation."""
        params: dict = {"page": page, "perPage": per_page}
        if status:
            params["status"] = status
        try:
            resp = await self._http.get("/transfer", params=params)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error("paystack.transfers.list_error", status=exc.response.status_code)
            raise

    async def get_transfer(self, transfer_code: str) -> dict:
        """GET /transfer/{code} — fetch a single transfer by code."""
        try:
            resp = await self._http.get(f"/transfer/{transfer_code}")
            resp.raise_for_status()
            return resp.json().get("data", {})
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.transfer.get_error",
                transfer_code=transfer_code,
                status=exc.response.status_code,
            )
            raise

    async def initialize_charge_with_split(
        self,
        email: str,
        amount_ghs: Decimal,
        reference: str,
        split_code: str,
        phone: str,
        provider: str,
        metadata: dict | None = None,
    ) -> "PaymentInitResponse":
        """
        Initiate a MoMo charge with a Paystack Split applied.
        Used for loan repayments so lender revenue is separated at collection time.
        """
        payload = {
            "amount": self._kobo(amount_ghs),
            "email": email or self._derive_email(phone),
            "currency": "GHS",
            "reference": reference,
            "split_code": split_code,
            "mobile_money": {
                "phone": phone,
                "provider": _PROVIDER_CODES.get(provider.lower(), provider.lower()),
            },
        }
        if metadata:
            payload["metadata"] = metadata

        logger.info(
            "paystack.charge_with_split.initiating",
            reference=reference,
            split_code=split_code,
            amount_ghs=str(amount_ghs),
        )
        try:
            resp = await self._http.post("/charge", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text
            logger.error(
                "paystack.charge_with_split.http_error",
                status=exc.response.status_code,
                body=body,
            )
            raise

        status_str = data.get("data", {}).get("status", "pending")
        status: "PaymentStatus" = _STATUS_MAP.get(status_str, "pending")
        ext_ref = data.get("data", {}).get("reference", reference)
        msg = data.get("data", {}).get("display_text") or data.get("message", "")

        logger.info(
            "paystack.charge_with_split.initiated",
            reference=ext_ref,
            status=status,
            split_code=split_code,
        )
        return PaymentInitResponse(external_ref=ext_ref, status=status, provider_message=msg)

    # ── Bulk Transfers ────────────────────────────────────────────────────────

    async def bulk_transfer(self, transfers: list[dict], currency: str = "GHS") -> dict:
        """
        Initiate up to 100 transfers in a single call.

        Each transfer dict: {amount_ghs: Decimal, recipient_code: str, reference: str, reason: str}
        Converts amount_ghs to kobo internally.
        Returns the full response data dict.
        """
        items = [
            {
                "amount": self._kobo(t["amount_ghs"]),
                "recipient": t["recipient_code"],
                "reference": t["reference"],
                "reason": t.get("reason", "SMEFlow payout"),
            }
            for t in transfers
        ]
        payload = {"source": "balance", "currency": currency, "transfers": items}
        logger.info("paystack.bulk_transfer.initiating", count=len(items))
        try:
            resp = await self._http.post("/transfer/bulk", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "paystack.bulk_transfer.http_error",
                status=exc.response.status_code,
                body=exc.response.text,
            )
            try:
                ps_message = exc.response.json().get("message", str(exc))
            except Exception:
                ps_message = str(exc)
            raise RuntimeError(ps_message) from exc
        logger.info("paystack.bulk_transfer.initiated", count=len(items))
        return data.get("data", {})


def parse_bulk_transfer_outcomes(
    response_data: dict | list | None,
    chunk: list[dict],
) -> list[dict]:
    """
    Normalize Paystack bulk_transfer response into per-chunk outcome dicts.

    Each outcome: agent_id (optional), settlement_id (optional), amount_ghs,
    transfer_code, status, reference, error.
    """
    if isinstance(response_data, list):
        items = response_data
    elif isinstance(response_data, dict):
        items = response_data.get("transfers") or response_data.get("data") or []
        if not isinstance(items, list):
            items = []
    else:
        items = []

    outcomes: list[dict] = []
    for index, chunk_item in enumerate(chunk):
        ps_item = items[index] if index < len(items) else {}
        if isinstance(ps_item, dict):
            transfer_code = ps_item.get("transfer_code") or ps_item.get("id")
            status = ps_item.get("status", "pending")
            reference = ps_item.get("reference") or chunk_item.get("reference")
        else:
            transfer_code = None
            status = "pending"
            reference = chunk_item.get("reference")

        error_msg = None
        if isinstance(ps_item, dict):
            error_msg = ps_item.get("message") or ps_item.get("reason")

        outcomes.append(
            {
                "agent_id": chunk_item.get("agent_id"),
                "settlement_id": chunk_item.get("settlement_id"),
                "amount_ghs": chunk_item.get("amount_ghs"),
                "transfer_code": transfer_code,
                "status": status,
                "reference": reference,
                "error": error_msg,
            }
        )
    return outcomes
