"""
GRA e-VAT HTTP client.

Usage::

    from libs.gra_client import GRAClient

    async with GRAClient() as client:
        result = await client.submit_vat_return(
            tin="C0123456789",
            business_name="Kofi Traders Ltd",
            period_start=date(2025, 1, 1),
            period_end=date(2025, 1, 31),
            vat_output=Decimal("1500.00"),
            vat_input=Decimal("200.00"),
            nhil=Decimal("75.00"),
            getfund=Decimal("75.00"),
            covid_levy=Decimal("30.00"),
            total_tax=Decimal("1480.00"),
        )
        if result.success:
            print("GRA ref:", result.gra_ref)

The client is a thin async wrapper around httpx.  It:
  - Injects the GRA API key as a Bearer token
  - Retries transient 5xx / network errors up to 3 times with exponential back-off
  - Parses the response via libs.gra_client.response_parser
  - Raises GRAClientError for permanent failures

Set ``GRA_API_BASE_URL`` and ``GRA_API_KEY`` in .env to point at the real GRA
endpoint.  Leave them at their defaults to get a dry-run log (no real HTTP call)
which is useful during development.
"""

from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
import structlog

from libs.gra_client.payload_builder import build_vat_return_payload
from libs.gra_client.response_parser import GRASubmissionResult, parse_submission_response

logger = structlog.get_logger()

_DEFAULT_BASE_URL = "https://api.gra.gov.gh/v1"
_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
_MAX_RETRIES = 3
_RETRY_STATUSES = {500, 502, 503, 504}


class GRAClientError(Exception):
    """Raised when the GRA API returns a permanent (non-retryable) error."""


class GRAClient:
    """
    Async HTTP client for the Ghana Revenue Authority e-VAT API.

    Designed for use as an async context manager::

        async with GRAClient() as client:
            result = await client.submit_vat_return(...)
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> None:
        from apps.api.core.config import get_settings

        settings = get_settings()
        self._base_url = (base_url or settings.GRA_API_BASE_URL or _DEFAULT_BASE_URL).rstrip("/")
        self._api_key = api_key or settings.GRA_API_KEY
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> GRAClient:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=headers,
            timeout=_TIMEOUT,
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    # ── Public API ─────────────────────────────────────────────────────────────

    async def submit_vat_return(
        self,
        *,
        tin: str,
        business_name: str,
        period_start: date,
        period_end: date,
        vat_output: Decimal,
        vat_input: Decimal,
        nhil: Decimal,
        getfund: Decimal,
        covid_levy: Decimal,
        total_tax: Decimal,
        form_type: str = "SVR",
    ) -> GRASubmissionResult:
        """
        Submit a VAT return to the GRA e-VAT portal.

        If ``GRA_API_KEY`` is not configured, the call is dry-run: the payload
        is logged but no HTTP request is made, and a synthetic "simulated" result
        is returned.  This matches the ``ENABLE_GRA_DIRECT_FILING=false`` default.
        """
        payload = build_vat_return_payload(
            tin=tin,
            business_name=business_name,
            period_start=period_start,
            period_end=period_end,
            vat_output=vat_output,
            vat_input=vat_input,
            nhil=nhil,
            getfund=getfund,
            covid_levy=covid_levy,
            total_tax=total_tax,
            form_type=form_type,
        )

        if not self._api_key:
            logger.info(
                "gra_client.dry_run",
                tin=tin,
                period=f"{period_start}-{period_end}",
                total_tax=str(total_tax),
            )
            return GRASubmissionResult(
                success=True,
                gra_ref=f"DRY-RUN-{period_start:%Y%m}",
                status="accepted",
                message="Dry run — no GRA_API_KEY configured",
                raw={"dry_run": True, "payload": payload},
            )

        return await self._post_with_retry("/returns/vat", payload)

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _post_with_retry(self, path: str, payload: dict) -> GRASubmissionResult:
        assert self._client is not None, "Must be used as async context manager"

        last_exc: Exception | None = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                resp = await self._client.post(path, json=payload)
                body: dict = {}
                try:
                    body = resp.json()
                except Exception:
                    body = {"raw": resp.text}

                logger.info(
                    "gra_client.response",
                    status_code=resp.status_code,
                    attempt=attempt,
                    path=path,
                )

                if resp.status_code in _RETRY_STATUSES and attempt < _MAX_RETRIES:
                    delay = 2**attempt  # 2, 4, 8 seconds
                    logger.warning(
                        "gra_client.retry",
                        status_code=resp.status_code,
                        attempt=attempt,
                        delay=delay,
                    )
                    await asyncio.sleep(delay)
                    continue

                return parse_submission_response(resp.status_code, body)

            except httpx.TimeoutException as exc:
                last_exc = exc
                logger.warning("gra_client.timeout", attempt=attempt, path=path)
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(2**attempt)
            except httpx.RequestError as exc:
                last_exc = exc
                logger.error("gra_client.request_error", error=str(exc), attempt=attempt)
                break  # Non-recoverable network error

        raise GRAClientError(f"GRA API unavailable after {_MAX_RETRIES} attempts: {last_exc}")
