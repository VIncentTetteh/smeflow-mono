"""
USSD Gateway router — Hubtel / Wigal callback handler.

Hubtel sends a POST with form-encoded fields:
  SessionID  — unique per USSD session (opaque string)
  MSISDN     — caller's phone, e.g. 0244123456 or +233244123456
  UserData   — digit(s) the subscriber just pressed (empty string on initiation)
  Type       — "Initiation" | "Response" | "Release" | "Timeout"

Response: plain text starting with "CON " (continue) or "END " (terminate).

Signature verification:
  Hubtel and Wigal both support an HMAC-SHA256 callback signature sent in the
  X-Hubtel-Signature or X-Wigal-Signature header (gateway-dependent).
  Set USSD_CALLBACK_SECRET in your environment to enable verification; leave it
  empty to skip (useful in development / when the gateway doesn't sign callbacks).

  Expected header value: hex(HMAC-SHA256(USSD_CALLBACK_SECRET, raw_body))
"""

from __future__ import annotations

import hashlib
import hmac
import re

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.config import get_settings
from apps.api.core.database import get_db
from apps.api.modules.auth.models import User
from apps.api.modules.business.models import BusinessMember
from apps.api.modules.ussd.session import USSDSession
from apps.api.modules.ussd.state_machine import handle as sm_handle
from apps.api.modules.ussd.state_machine import handle_registration as sm_handle_registration

logger = structlog.get_logger()

router = APIRouter()


# ── Signature verification ────────────────────────────────────────────────────


def _verify_ussd_signature(raw_body: bytes, request: Request) -> bool:
    """
    Verify the HMAC-SHA256 callback signature from Hubtel / Wigal.

    Returns True if:
      - USSD_CALLBACK_SECRET is not configured (skip verification in dev/sandbox), OR
      - the signature header matches the expected HMAC-SHA256 digest.

    Returns False if a secret is configured but the signature is missing or wrong.
    """
    secret = get_settings().USSD_CALLBACK_SECRET
    if not secret:
        # No secret set — skip verification (development / misconfigured gateway)
        return True

    # Accept signatures from either gateway header name
    sig = (
        request.headers.get("X-Hubtel-Signature") or request.headers.get("X-Wigal-Signature") or ""
    )
    if not sig:
        logger.warning("ussd.signature.missing_header")
        return False

    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig.lower())


# ── Phone normalisation ───────────────────────────────────────────────────────

_DIGITS = re.compile(r"\D")


def _normalise_phone(msisdn: str) -> str:
    """Return E.164 (+233...) for any Ghanaian MSISDN variant."""
    digits = _DIGITS.sub("", msisdn)
    if digits.startswith("233"):
        return f"+{digits}"
    if digits.startswith("0"):
        return f"+233{digits[1:]}"
    # Already bare 9-digit local number
    if len(digits) == 9:
        return f"+233{digits}"
    return f"+{digits}"


# ── Hubtel/Wigal USSD callback ────────────────────────────────────────────────


@router.post(
    "/callback",
    response_class=PlainTextResponse,
    summary="USSD gateway callback (Hubtel / Wigal)",
    include_in_schema=True,
)
async def ussd_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> str:
    """
    Entry-point for all USSD traffic.

    Flow:
      1. Verify HMAC-SHA256 callback signature (when USSD_CALLBACK_SECRET is set).
      2. Parse form fields from the raw body (avoids stream-consumed errors).
      3. Normalise MSISDN to E.164.
      4. On Release/Timeout: destroy session and return empty END.
      5. Load or create USSDSession from Redis.
      6. Resolve business_id / user_id from DB (phone → User → BusinessMember).
      7. Delegate to state_machine.handle() and return its response string.
    """
    if not get_settings().ENABLE_USSD:
        return "END This service is not available. Please use the SME Flow app."

    # Read body once — this caches it so form parsing below never consumes the
    # stream a second time, and the HMAC is computed on the exact bytes sent.
    raw_body = await request.body()

    if not _verify_ussd_signature(raw_body, request):
        logger.warning("ussd.callback.invalid_signature")
        return "END Service temporarily unavailable. Please try again."

    # Parse form fields manually from the cached raw body
    from urllib.parse import parse_qs

    form = parse_qs(raw_body.decode(errors="replace"), keep_blank_values=True)

    def _field(key: str, default: str = "") -> str:
        return (form.get(key) or [default])[0].strip()

    sid = _field("SessionID")
    msisdn = _field("MSISDN")
    udata = _field("UserData")
    etype = _field("Type", "Response")

    phone = _normalise_phone(msisdn)

    log = logger.bind(session_id=sid, phone=phone, type=etype)

    # ── Handle terminal events ────────────────────────────────────────────────
    if etype in ("Release", "Timeout"):
        session = await USSDSession.get_or_create(sid, phone)
        from libs.i18n import t as _t

        lang = session.language
        await session.delete()
        log.info("ussd.session_released")
        return _t("ussd.session_timeout", lang)

    # ── Load / create session ─────────────────────────────────────────────────
    session = await USSDSession.get_or_create(sid, phone)

    # ── Resolve user & business (once per session) ────────────────────────────
    if not session.business_id:
        try:
            # Look up user by phone
            user_result = await db.execute(
                select(User).where(User.phone == phone, User.is_active.is_(True))
            )
            user = user_result.scalar_one_or_none()

            if user:
                # Pick first active business membership (prefer owner)
                member_result = await db.execute(
                    select(BusinessMember)
                    .where(
                        BusinessMember.user_id == user.id,
                        BusinessMember.is_active.is_(True),
                    )
                    .order_by(
                        # owners first, then other roles
                        BusinessMember.role,
                    )
                    .limit(1)
                )
                member = member_result.scalar_one_or_none()

                if member:
                    session.business_id = str(member.business_id)
                    session.user_id = str(user.id)
                    # Propagate stored language preference to USSD session
                    session.language = getattr(user, "language_pref", None) or "en"
                    await session.save()
                    log.info(
                        "ussd.session_resolved",
                        business_id=session.business_id,
                        user_id=session.user_id,
                    )
                else:
                    log.warning("ussd.no_business_member", user_id=str(user.id))
            else:
                log.warning("ussd.unknown_phone", phone=phone)

        except Exception as exc:
            log.error("ussd.resolve_error", error=str(exc))

    # ── If user still unresolved, run lightweight USSD registration ───────────
    if not session.business_id:
        response = await sm_handle_registration(session, udata, db)
        log.info("ussd.registration_handled", state=session.state, response_prefix=response[:20])
        return response

    # ── Delegate to state machine ─────────────────────────────────────────────
    try:
        response = await sm_handle(session, udata, db)
        log.info("ussd.handled", state=session.state, response_prefix=response[:20])
        return response
    except Exception as exc:
        log.error("ussd.unhandled_error", error=str(exc))
        from libs.i18n import t as _t

        return _t("ussd.error", session.language)
