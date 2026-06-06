"""
KYC verification background task.

Calls the Ghana NIA API to verify Ghana Card IDs and the GRA API to verify
TINs.  Both APIs are guarded by key availability so the task degrades
gracefully in development (sandbox auto-approve) when credentials are absent.

NIA API:  POST {NIA_API_BASE_URL}/verify/ghana-card
          Body: {"id": "<GHA-XXXXXXXXX-X>", "api_key": "<NIA_API_KEY>"}
          200 OK → {"valid": true/false, "reason": "<string if false>"}

GRA API:  POST {GRA_API_BASE_URL}/tin/verify
          Body: {"tin": "<Cxxxxxxxx>", "api_key": "<GRA_API_KEY>"}
          200 OK → {"valid": true/false, "reason": "<string if false>"}

Both endpoints return 200 even for invalid IDs; non-200 means the external API
itself is unavailable (network issue, maintenance, credentials).
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger()


async def _verify_ghana_card(ghana_card_id: str) -> tuple[bool, str | None]:
    """
    Call the NIA API to verify a Ghana Card ID.

    Returns (is_valid, failure_reason).
    Raises httpx errors so the caller can decide whether to retry.
    """
    import httpx

    from apps.api.core.config import get_settings

    settings = get_settings()
    if not settings.NIA_API_KEY:
        # Sandbox / development: treat any non-empty ID as valid
        logger.warning("kyc.nia.no_api_key_configured")
        return True, None

    from apps.api.core.circuit_breaker import CircuitBreaker

    async def _call() -> dict:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.NIA_API_BASE_URL}/verify/ghana-card",
                json={"id": ghana_card_id, "api_key": settings.NIA_API_KEY},
            )
            resp.raise_for_status()
            return resp.json()

    body = await CircuitBreaker("nia").call(_call)

    if body.get("valid"):
        return True, None
    return False, body.get("reason") or "Ghana Card ID is invalid"


async def _verify_tin(tin: str) -> tuple[bool, str | None]:
    """
    Call the GRA API to verify a Tax Identification Number.

    Returns (is_valid, failure_reason).
    Raises httpx errors so the caller can decide whether to retry.
    """
    import httpx

    from apps.api.core.config import get_settings

    settings = get_settings()
    if not settings.GRA_API_KEY:
        logger.warning("kyc.gra.no_api_key_configured")
        return True, None

    from apps.api.core.circuit_breaker import CircuitBreaker

    async def _call() -> dict:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.GRA_API_BASE_URL}/tin/verify",
                json={"tin": tin, "api_key": settings.GRA_API_KEY},
            )
            resp.raise_for_status()
            return resp.json()

    body = await CircuitBreaker("gra").call(_call)

    if body.get("valid"):
        return True, None
    return False, body.get("reason") or "TIN is invalid"


async def verify_kyc_documents(user_id: str) -> None:
    """
    Verify KYC documents for a user and update kyc_status accordingly.

    Flow:
      1. Load the User from DB; bail if status is not "pending".
      2. For each present document field, call the corresponding external API.
      3. ALL documents pass  → kyc_status = "verified"
         ANY document fails  → kyc_status = "rejected" + store reason
         External API unreachable → leave as "pending" (scheduler will retry)
      4. Notify the user of the outcome via SMS/WhatsApp.
    """
    from datetime import datetime, timezone

    import httpx
    from sqlalchemy import select

    from apps.api.core.database import AsyncSessionLocal
    from apps.api.modules.auth.models import User

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user or user.kyc_status != "pending":
                return

            if not user.ghana_card_id and not user.tin:
                user.kyc_status = "rejected"
                logger.warning("kyc.rejected", user_id=user_id, reason="no_documents")
                await db.commit()
                return

            # ── Run external verifications ────────────────────────────────────
            rejection_reason: str | None = None

            try:
                if user.ghana_card_id:
                    valid, reason = await _verify_ghana_card(user.ghana_card_id)
                    if not valid:
                        rejection_reason = reason

                if user.tin and rejection_reason is None:
                    valid, reason = await _verify_tin(user.tin)
                    if not valid:
                        rejection_reason = reason

            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                if status_code in {401, 403}:
                    # Bad credentials — ops issue, not user's fault; leave pending
                    logger.error(
                        "kyc.api.auth_error",
                        user_id=user_id,
                        status=status_code,
                        url=str(exc.request.url),
                    )
                    return
                if 400 <= status_code < 500:
                    # 4xx with a meaningful rejection (e.g. 404 = ID not found)
                    rejection_reason = f"Verification service returned error {status_code}"
                else:
                    # 5xx transient — leave pending for retry
                    logger.warning(
                        "kyc.api.server_error",
                        user_id=user_id,
                        status=status_code,
                    )
                    return

            except (httpx.ConnectError, httpx.TimeoutException) as exc:
                # Network issue — leave as pending, scheduler will retry
                logger.warning("kyc.api.network_error", user_id=user_id, error=str(exc))
                return

            # ── Persist outcome ───────────────────────────────────────────────
            if rejection_reason:
                user.kyc_status = "rejected"
                logger.warning("kyc.rejected", user_id=user_id, reason=rejection_reason)
            else:
                user.kyc_status = "verified"
                user.kyc_verified_at = datetime.now(timezone.utc)
                logger.info("kyc.verified", user_id=user_id)

            await db.commit()

        # ── Notify user (outside the DB session to avoid blocking) ───────────
        await _notify_kyc_outcome(user_id, user.kyc_status, rejection_reason)

    except Exception as exc:
        logger.error("kyc.verification_failed", user_id=user_id, error=str(exc))


async def _notify_kyc_outcome(user_id: str, status: str, reason: str | None) -> None:
    """Send an SMS/WhatsApp notification to the user about their KYC result."""
    try:
        from sqlalchemy import select

        from apps.api.core.database import AsyncSessionLocal
        from apps.api.modules.auth.models import User
        from apps.api.modules.notifications.service import (
            NotificationDispatcher,
            NotificationMessage,
        )

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user or not user.phone:
                return
            phone = user.phone

        if status == "verified":
            text = (
                "Your SME Flow identity verification is complete. "
                "You now have full access to all features."
            )
        else:
            detail = f" Reason: {reason}." if reason else ""
            text = (
                f"Your SME Flow identity verification was unsuccessful.{detail} "
                "Please contact support or resubmit with correct documents."
            )

        await NotificationDispatcher().send(
            NotificationMessage(phone=phone, text=text),
            channel="sms",
        )
    except Exception as exc:
        # Notification failure must never break the KYC flow
        logger.warning("kyc.notify_failed", user_id=user_id, error=str(exc))
