"""
Hubtel OTP client — send, verify, resend.

Hubtel delivers a 4-char prefix + 4-digit code to the user's phone via SMS.
The mobile app collects the 4-digit code; we retrieve the stored prefix and
requestId from Redis to call Hubtel's verify endpoint.
"""

from __future__ import annotations

import json

import httpx
import structlog

from apps.api.core.config import get_settings

logger = structlog.get_logger()

_OTP_TTL = 300  # seconds — match OTP_EXPIRE_SECONDS
_REDIS_KEY_PREFIX = "hubtel_otp:"
_RESEND_RATE_LIMIT_PREFIX = "hubtel_otp_resend:"
_RESEND_MAX = 3  # max resends per window
_RESEND_WINDOW = 900  # 15-minute window (matches OTP verify lockout)


class HubtelOtpClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.client_id = settings.HUBTEL_CLIENT_ID
        self.client_secret = settings.HUBTEL_CLIENT_SECRET
        self.base_url = settings.HUBTEL_OTP_BASE_URL.rstrip("/")
        self.sender_id = settings.HUBTEL_SMS_SENDER_ID

    async def send_otp(self, phone: str) -> tuple[str, str]:
        """Request an OTP from Hubtel. Hubtel delivers via SMS.

        Returns (requestId, prefix) and persists them in Redis keyed by phone.
        """
        async with httpx.AsyncClient(
            auth=(self.client_id, self.client_secret), timeout=10
        ) as client:
            resp = await client.post(
                f"{self.base_url}/otp/send",
                json={"From": self.sender_id, "To": phone},
            )
            resp.raise_for_status()
            data = resp.json()

        request_id: str = data["requestId"]
        prefix: str = data["prefix"]
        await self._store(phone, request_id, prefix)
        logger.info("hubtel.otp.sent", phone=phone[-4:])
        return request_id, prefix

    async def verify_otp(self, phone: str, code: str) -> bool:
        """Verify a 4-digit code against the stored requestId/prefix.

        Deletes Redis state on success so each OTP is single-use.
        Returns False (not raises) on wrong code or missing state.
        """
        stored = await self._load(phone)
        if not stored:
            logger.warning("hubtel.otp.no_state", phone=phone[-4:])
            return False

        request_id, prefix = stored
        try:
            async with httpx.AsyncClient(
                auth=(self.client_id, self.client_secret), timeout=10
            ) as client:
                resp = await client.post(
                    f"{self.base_url}/otp/verify",
                    json={"requestId": request_id, "prefix": prefix, "code": code},
                )
            if resp.status_code == 200:
                await self._delete(phone)
                logger.info("hubtel.otp.verified", phone=phone[-4:])
                return True
            logger.warning("hubtel.otp.invalid", phone=phone[-4:], status=resp.status_code)
            return False
        except Exception as exc:
            logger.error("hubtel.otp.verify_error", phone=phone[-4:], error=str(exc))
            return False

    async def resend_otp(self, phone: str) -> tuple[str, str]:
        """Resend OTP using the stored requestId, or start fresh if none exists.

        Rate-limited to _RESEND_MAX attempts per _RESEND_WINDOW seconds per phone number.
        Raises RuntimeError if the limit is exceeded.
        """
        from apps.api.core.redis import get_otp_redis

        redis = get_otp_redis()
        rate_key = f"{_RESEND_RATE_LIMIT_PREFIX}{phone}"
        count_raw = await redis.get(rate_key)
        count = int(count_raw) if count_raw else 0
        if count >= _RESEND_MAX:
            logger.warning("hubtel.otp.resend_rate_limited", phone=phone[-4:])
            raise RuntimeError(
                f"OTP resend limit reached. Try again in {_RESEND_WINDOW // 60} minutes."
            )
        pipe = redis.pipeline()
        pipe.incr(rate_key)
        pipe.expire(rate_key, _RESEND_WINDOW)
        await pipe.execute()

        stored = await self._load(phone)
        if stored:
            request_id, _ = stored
            try:
                async with httpx.AsyncClient(
                    auth=(self.client_id, self.client_secret), timeout=10
                ) as client:
                    resp = await client.post(
                        f"{self.base_url}/otp/resend",
                        json={"requestId": request_id},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                new_request_id: str = data["requestId"]
                new_prefix: str = data["prefix"]
                await self._store(phone, new_request_id, new_prefix)
                logger.info("hubtel.otp.resent", phone=phone[-4:])
                return new_request_id, new_prefix
            except Exception as exc:
                logger.warning("hubtel.otp.resend_error", phone=phone[-4:], error=str(exc))

        # Fallback: send fresh OTP
        return await self.send_otp(phone)

    async def _store(self, phone: str, request_id: str, prefix: str) -> None:
        from apps.api.core.redis import get_otp_redis

        redis = get_otp_redis()
        key = f"{_REDIS_KEY_PREFIX}{phone}"
        await redis.set(key, json.dumps({"requestId": request_id, "prefix": prefix}), ex=_OTP_TTL)

    async def _load(self, phone: str) -> tuple[str, str] | None:
        from apps.api.core.redis import get_otp_redis

        redis = get_otp_redis()
        key = f"{_REDIS_KEY_PREFIX}{phone}"
        raw = await redis.get(key)
        if not raw:
            return None
        data = json.loads(raw)
        return data["requestId"], data["prefix"]

    async def _delete(self, phone: str) -> None:
        from apps.api.core.redis import get_otp_redis

        redis = get_otp_redis()
        key = f"{_REDIS_KEY_PREFIX}{phone}"
        await redis.delete(key)
