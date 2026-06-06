"""
Chat endpoints.

POST /chat/process          — Direct API chat (mobile app / web interface).
GET  /chat/webhooks/whatsapp — WhatsApp webhook verification challenge.
POST /chat/webhooks/whatsapp — Incoming WhatsApp messages.
"""

import hashlib
import hmac
import json
from datetime import datetime, timezone
from uuid import UUID

import structlog
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.config import get_settings
from apps.api.core.database import get_db
from apps.api.core.dependencies import get_current_business_id, get_current_user_id
from apps.api.core.middleware import limiter
from apps.api.modules.chat.handlers import dispatch
from apps.api.modules.chat.intent_parser import parse_intent
from libs.translation import normalize_app_language, translate_text

settings = get_settings()
router = APIRouter()
logger = structlog.get_logger()

# ── Redis-backed chat history ─────────────────────────────────────────────────
# History is stored as a Redis list per session key.
# Each entry is a JSON-encoded dict: {role, text, intent, created_at}.
# We cap at HISTORY_LIMIT messages and expire after HISTORY_TTL_SECONDS.

HISTORY_LIMIT = 50  # max messages kept per session
HISTORY_TTL_SECONDS = 86400 * 7  # 7 days


def _session_key(business_id: UUID, session_id: str | None) -> str:
    return f"chat_history:{business_id}:{session_id or 'default'}"


async def _append_history(key: str, role: str, text: str, intent: str | None = None) -> None:
    """Push a message into the Redis list and trim to HISTORY_LIMIT."""
    from apps.api.core.redis import get_redis

    entry = json.dumps(
        {
            "role": role,
            "text": text,
            "intent": intent,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    try:
        redis = get_redis()
        await redis.rpush(key, entry)
        await redis.ltrim(key, -HISTORY_LIMIT, -1)
        await redis.expire(key, HISTORY_TTL_SECONDS)
    except Exception as exc:
        logger.warning("chat.history.redis_write_failed", key=key, error=str(exc))


async def _get_history(key: str) -> list[dict]:
    """Retrieve the last HISTORY_LIMIT messages for a session."""
    from apps.api.core.redis import get_redis

    try:
        redis = get_redis()
        raw = await redis.lrange(key, 0, -1)
        return [json.loads(r) for r in raw]
    except Exception as exc:
        logger.warning("chat.history.redis_read_failed", key=key, error=str(exc))
        return []


class ChatMessage(BaseModel):
    message: str
    session_id: str | None = None
    language: str | None = None


class ChatResponse(BaseModel):
    reply: str
    intent: str | None = None
    confidence: float | None = None
    entities: dict = {}
    actions_taken: list[str] = []
    media_url: str | None = None


async def _get_user_language(user_id: UUID, db: AsyncSession) -> str:
    """Fetch the user's stored language preference (default 'en')."""
    from sqlalchemy import select

    from apps.api.modules.auth.models import User

    result = await db.execute(select(User.language_pref).where(User.id == user_id))
    pref = result.scalar_one_or_none()
    return normalize_app_language(pref)


async def _check_and_record_ai_usage(business_id: UUID, db: AsyncSession) -> None:
    from apps.api.core.exceptions import LimitExceededError
    from apps.api.core.redis import get_redis
    from apps.api.modules.billing.models import PLANS
    from apps.api.modules.billing.service import BillingService

    now = datetime.now(timezone.utc)
    key = f"billing:ai_messages:{business_id}:{now:%Y%m}"
    billing = BillingService(db)
    try:
        redis = get_redis()
        current = int(await redis.get(key) or 0)
        if not await billing.check_limit(business_id, "ai_messages", current):
            sub = await billing.get_subscription(business_id)
            limit = PLANS.get(sub.plan, PLANS["free"]).get("ai_messages", 0)
            raise LimitExceededError("AI messages", limit)
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 60 * 60 * 24 * 40)
    except LimitExceededError:
        raise
    except Exception as exc:
        logger.warning("chat.ai_usage_counter_failed", business_id=str(business_id), error=str(exc))


@router.post("/process", response_model=ChatResponse)
@limiter.limit("60/minute")
async def process_chat(
    request: Request,
    body: ChatMessage,
    business_id: UUID = Depends(get_current_business_id),
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> ChatResponse:
    """
    Process a chat command from the mobile app or web interface.
    Parses intent, dispatches to appropriate handler, returns structured reply.
    """
    await _check_and_record_ai_usage(business_id, db)
    language = (
        normalize_app_language(body.language)
        if body.language
        else await _get_user_language(user_id, db)
    )
    canonical_message = await translate_text(body.message, "en", source_language=language)
    intent = await parse_intent(canonical_message)
    logger.info(
        "chat.intent_parsed",
        intent=intent.name,
        confidence=intent.confidence,
        llm_used=intent.llm_used,
    )

    result = await dispatch(intent, business_id, user_id, db, language="en")
    reply_language = normalize_app_language(result.get("language") or language)
    reply = await translate_text(result["reply"], reply_language, source_language="en")
    history_key = _session_key(business_id, body.session_id)
    await _append_history(history_key, "user", body.message, intent.name)
    await _append_history(history_key, "assistant", reply, intent.name)
    return ChatResponse(
        reply=reply,
        intent=intent.name,
        confidence=round(intent.confidence, 3),
        entities=intent.entities,
        actions_taken=result.get("actions_taken", []),
    )


@router.get("/history")
async def chat_history(
    session_id: str | None = None,
    limit: int = Query(20, ge=1, le=50, description="Number of recent messages to return"),
    business_id: UUID = Depends(get_current_business_id),
) -> dict:
    """Return the latest Redis-persisted chat messages for a session.

    History survives server restarts and is shared across all API workers.
    Messages are kept for 7 days and capped at 50 per session.
    """
    key = _session_key(business_id, session_id)
    messages = await _get_history(key)
    # Return the last `limit` messages in chronological order
    return {
        "session_id": session_id or "default",
        "messages": messages[-limit:],
        "total": len(messages),
    }


@router.delete("/history", status_code=204)
async def clear_chat_history(
    session_id: str | None = None,
    business_id: UUID = Depends(get_current_business_id),
) -> None:
    """Clear the chat history for a session (e.g. on logout or explicit reset)."""
    from apps.api.core.redis import get_redis

    key = _session_key(business_id, session_id)
    try:
        redis = get_redis()
        await redis.delete(key)
    except Exception as exc:
        logger.warning("chat.history.clear_failed", key=key, error=str(exc))


@router.get("/webhooks/whatsapp")
async def whatsapp_webhook_verify(
    request: Request,
) -> int:
    """WhatsApp webhook verification challenge (GET)."""
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode == "subscribe" and token == settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN:
        return int(challenge or 0)
    raise HTTPException(status_code=403, detail="Webhook verification failed")


@router.post("/webhooks/whatsapp", include_in_schema=False)
async def whatsapp_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict:
    """
    WhatsApp Business Cloud API incoming message webhook.
    Verifies X-Hub-Signature-256, then queues processing as a background task.
    Must return 200 immediately per WhatsApp's retry policy.
    """
    body = await request.body()
    sig_header = request.headers.get("X-Hub-Signature-256", "")

    if not settings.WHATSAPP_APP_SECRET:
        # Refuse all inbound webhook calls when the secret is not configured — fail closed.
        # Set WHATSAPP_APP_SECRET in your environment to enable this endpoint.
        logger.error("whatsapp.webhook.secret_not_configured")
        raise HTTPException(status_code=503, detail="Webhook not configured")

    expected = (
        "sha256="
        + hmac.new(
            settings.WHATSAPP_APP_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
    )
    if not hmac.compare_digest(expected, sig_header):
        raise HTTPException(status_code=403, detail="Invalid signature")

    background_tasks.add_task(_process_whatsapp_payload, body)
    return {"status": "ok"}


async def _process_whatsapp_payload(body: bytes, db: AsyncSession | None = None) -> None:
    """
    Parse an incoming WhatsApp Cloud API payload and route to the intent pipeline.
    Runs as a background task -- errors are logged but never surface to WhatsApp.
    """
    log = structlog.get_logger()
    try:
        payload = json.loads(body)
        entry = payload.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})
        messages = value.get("messages", [])
        if not messages:
            return

        msg = messages[0]
        from_phone = msg.get("from", "")
        msg_type = msg.get("type", "text")
        text = msg.get("text", {}).get("body", "") if msg_type == "text" else ""

        if not text:
            log.debug("whatsapp.non_text_message", type=msg_type, phone=from_phone[-4:])
            return

        log.info("whatsapp.message_received", phone=from_phone[-4:], text_preview=text[:30])

        from sqlalchemy import select

        from apps.api.modules.auth.models import User
        from apps.api.modules.business.models import BusinessMember

        if db is None:
            from apps.api.core.database import AsyncSessionLocal

            async with AsyncSessionLocal() as session:
                await _process_whatsapp_payload(body, session)
            return

        user_result = await db.execute(
            select(User).where(User.phone == _normalise_phone(from_phone))
        )
        user = user_result.scalar_one_or_none()
        if not user:
            log.warning("whatsapp.unknown_sender", phone=from_phone[-4:])
            await _send_whatsapp_reply(
                from_phone,
                "I don't recognise this number. Please register via the SME Flow app first.",
            )
            return

        member_result = await db.execute(
            select(BusinessMember)
            .where(BusinessMember.user_id == user.id, BusinessMember.is_active.is_(True))
            .limit(1)
        )
        member = member_result.scalar_one_or_none()
        if not member:
            log.warning("whatsapp.no_business", user_id=str(user.id))
            await _send_whatsapp_reply(
                from_phone,
                "You don't have an active business linked. Please set one up in the SME Flow app.",
            )
            return

        user_language = normalize_app_language(getattr(user, "language_pref", None))
        canonical_text = await translate_text(text, "en", source_language=user_language)
        intent = await parse_intent(canonical_text)
        result = await dispatch(intent, member.business_id, user.id, db, language="en")
        reply_language = normalize_app_language(result.get("language") or user_language)
        reply_text = await translate_text(result["reply"], reply_language, source_language="en")
        history_key = _session_key(member.business_id, from_phone)
        await _append_history(history_key, "user", text, intent.name)
        await _append_history(history_key, "assistant", reply_text, intent.name)

        await _send_whatsapp_reply(from_phone, reply_text)

    except Exception as exc:
        log.error("whatsapp.parse_failed", error=str(exc))


def _normalise_phone(phone: str) -> str:
    """Normalise a WhatsApp-format phone number to +233XXXXXXXXX."""
    import re

    phone = re.sub(r"\s+|-", "", phone)
    if not phone.startswith("+"):
        phone = "+" + phone
    return phone


async def _send_whatsapp_reply(to: str, text: str) -> None:
    """Send a text message reply via WhatsApp Business Cloud API."""
    import httpx

    if not settings.WHATSAPP_ACCESS_TOKEN or not settings.WHATSAPP_PHONE_NUMBER_ID:
        logger.debug("whatsapp.reply_skipped_no_credentials")
        return

    url = f"https://graph.facebook.com/v18.0/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": text, "preview_url": False},
    }
    headers = {
        "Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            logger.info("whatsapp.reply_sent", to=to[-4:])
    except Exception as exc:
        logger.error("whatsapp.reply_failed", error=str(exc))


# ── Voice transcription ────────────────────────────────────────────────────────

# Only languages Groq's Whisper large-v3-turbo actually supports.
# Unsupported codes map to None — Whisper auto-detects, which works better than a bad hint.
_WHISPER_LANG_MAP: dict[str, str | None] = {
    "en": "en",
    "tw": None,  # Old Twi code — auto-detect handles it better than a bad hint
    "ak": None,  # Twi/Akan — auto-detect
    "ew": None,  # Old Ewe code — auto-detect
    "ee": None,  # Ewe — auto-detect
    "gaa": None,  # Ga — auto-detect
    "ha": "ha",  # Hausa
    "pid": "en",  # Old Pidgin code — transcribe as English
}


@router.post("/voice")
async def transcribe_voice(
    audio: UploadFile = File(...),
    language: str = Form(default="en"),
    _user_id: UUID = Depends(get_current_user_id),
) -> dict:
    """Transcribe an audio file using Groq Whisper and return the text."""
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty audio file")

    if not settings.GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="Voice transcription not configured")

    whisper_lang: str | None = _WHISPER_LANG_MAP.get(language, None)

    try:
        import io

        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=settings.GROQ_API_KEY,
            base_url=settings.GROQ_BASE_URL,
        )
        audio_file = io.BytesIO(content)
        audio_file.name = audio.filename or "voice.m4a"
        kwargs: dict = {"model": settings.GROQ_WHISPER_MODEL, "file": audio_file}
        if whisper_lang:
            kwargs["language"] = whisper_lang
        transcript = await client.audio.transcriptions.create(**kwargs)
        return {"text": transcript.text}
    except Exception as exc:
        logger.warning("chat.voice_transcription_failed", error=str(exc))
        raise HTTPException(status_code=500, detail="Transcription failed") from exc
