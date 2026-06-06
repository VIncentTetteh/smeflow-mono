"""
Security utilities: JWT creation/verification, OTP generation/storage, password hashing.
"""

import base64
import hashlib
import hmac
import random
import secrets
import string
import struct
from datetime import datetime, timedelta, timezone
from uuid import UUID

from jose import jwt
from passlib.context import CryptContext

from apps.api.core.config import get_settings
from apps.api.core.redis import RedisCache, get_otp_redis, get_session_redis

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── JWT ───────────────────────────────────────────────────────────────────────
def create_access_token(
    user_id: UUID,
    business_id: UUID | None = None,
    role: str = "owner",
    expires_delta: timedelta | None = None,
) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {
        "sub": str(user_id),
        "business_id": str(business_id) if business_id else None,
        "role": role,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(
    user_id: UUID,
    business_id: UUID | None = None,
    role: str | None = None,
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "refresh",
        "jti": secrets.token_hex(16),
        "business_id": str(business_id) if business_id else None,
        "role": role,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT.

    During a SECRET_KEY rotation, tokens signed with the previous key are still
    accepted so that in-flight sessions are not immediately invalidated.  New
    tokens are always signed with the current SECRET_KEY.

    Raises JWTError on failure.
    """
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except Exception:
        # Fallback to previous key if rotation is in progress
        if settings.SECRET_KEY_PREVIOUS:
            return jwt.decode(
                token, settings.SECRET_KEY_PREVIOUS, algorithms=[settings.JWT_ALGORITHM]
            )
        raise


# ── OTP ───────────────────────────────────────────────────────────────────────
def generate_otp(length: int = 6) -> str:
    """Generate a numeric OTP of the given length."""
    return "".join(random.choices(string.digits, k=length))


def _hash_otp(otp: str) -> str:
    """Return the SHA-256 hex-digest of an OTP string."""
    return hashlib.sha256(otp.encode()).hexdigest()


async def store_otp(phone: str, otp: str) -> None:
    """Hash the OTP with SHA-256 and store the digest in Redis with TTL.

    Storing only the hash means that even if Redis is compromised an attacker
    cannot recover the original six-digit code in useful time (SHA-256 of a
    random 6-digit string has ~20 bits of entropy — fast to brute-force, but
    the 5-minute TTL plus rate limiting makes it non-viable in practice).
    """
    cache = RedisCache(get_otp_redis(), prefix="otp")
    await cache.set(phone, _hash_otp(otp), ttl=settings.OTP_EXPIRE_SECONDS)
    # Track attempt count separately (rate limiting)
    attempt_cache = RedisCache(get_otp_redis(), prefix="otp_attempts")
    await attempt_cache.increment(phone, ttl=300)


_OTP_VERIFY_MAX_ATTEMPTS = 5  # max wrong guesses per OTP
_OTP_VERIFY_LOCKOUT_SECONDS = 900  # 15-minute lockout after exhaustion


async def is_otp_verify_locked(phone: str) -> bool:
    """Return True if the phone is locked out from verifying OTPs."""
    cache = RedisCache(get_otp_redis(), prefix="otp_verify_lock")
    return await cache.exists(phone)


async def _record_verify_failure(phone: str) -> int:
    """Increment the verify-failure counter; lock the phone when limit is reached.

    Returns the new failure count.
    """
    fail_cache = RedisCache(get_otp_redis(), prefix="otp_verify_fail")
    count = await fail_cache.increment(phone, ttl=_OTP_VERIFY_LOCKOUT_SECONDS)
    if count >= _OTP_VERIFY_MAX_ATTEMPTS:
        lock_cache = RedisCache(get_otp_redis(), prefix="otp_verify_lock")
        await lock_cache.set(phone, "1", ttl=_OTP_VERIFY_LOCKOUT_SECONDS)
        # Purge the stored OTP so it can't be replayed after lockout expires
        otp_cache = RedisCache(get_otp_redis(), prefix="otp")
        await otp_cache.delete(phone)
    return count


async def verify_otp(phone: str, otp: str) -> bool:
    """Verify OTP by comparing SHA-256 hashes with constant-time compare.

    The stored value is the hex-digest written by store_otp().  We hash the
    candidate the same way and use hmac.compare_digest() to avoid timing
    side-channels.  The entry is deleted on the first successful match so each
    OTP is single-use.

    Failed attempts are counted; after _OTP_VERIFY_MAX_ATTEMPTS failures the
    phone is locked for _OTP_VERIFY_LOCKOUT_SECONDS (15 min) and the stored
    OTP is purged so the attacker gains nothing even after the lockout expires.
    """
    # Fast-path: check lockout before touching the OTP key
    if await is_otp_verify_locked(phone):
        return False

    cache = RedisCache(get_otp_redis(), prefix="otp")
    stored = await cache.get(phone)
    if stored is not None:
        candidate_hash = _hash_otp(otp)
        if hmac.compare_digest(str(stored), candidate_hash):
            # Clear failure counter on success
            fail_cache = RedisCache(get_otp_redis(), prefix="otp_verify_fail")
            await fail_cache.delete(phone)
            await cache.delete(phone)
            return True

    # Wrong code — record the failure (may trigger lockout)
    await _record_verify_failure(phone)
    return False


async def get_otp_attempt_count(phone: str) -> int:
    """Return number of OTP requests in the current 5-minute window."""
    cache = RedisCache(get_otp_redis(), prefix="otp_attempts")
    val = await cache.get(phone)
    return int(val) if val else 0


# ── Token blacklist (logout) ──────────────────────────────────────────────────


async def blacklist_token(jti: str, expires_at: datetime) -> None:
    """Blacklist a refresh token JTI until its natural expiry."""
    ttl = max(int((expires_at - datetime.now(timezone.utc)).total_seconds()), 1)
    cache = RedisCache(get_session_redis(), prefix="token_blacklist")
    await cache.set(jti, "1", ttl=ttl)


async def is_token_blacklisted(jti: str) -> bool:
    """Return True if this JTI has been blacklisted (i.e. logged out)."""
    cache = RedisCache(get_session_redis(), prefix="token_blacklist")
    return await cache.get(jti) is not None


# ── Password hashing ──────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── Lender partner tokens ─────────────────────────────────────────────────────


def verify_lender_api_key(api_key: str, stored_hash: str | None) -> bool:
    """Verify a lender API key using constant-time comparison.

    Fails closed: if no hash is stored (key was never issued or lender not found),
    access is always denied regardless of environment.
    """
    if not stored_hash:
        return False  # No hash stored means key was never issued; reject in all environments
    candidate_hash = hashlib.sha256(api_key.encode()).hexdigest()
    return hmac.compare_digest(stored_hash, candidate_hash)


def create_lender_token(lender_id: str) -> str:
    """Issue a short-lived JWT for a lender partner (scope: lender, 1-hour TTL)."""
    expire = datetime.now(timezone.utc) + timedelta(hours=1)
    payload = {
        "sub": f"lender:{lender_id}",
        "lender_id": lender_id,
        "scope": "lender",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_lender_password_reset_token(lender_id: str) -> str:
    """Issue a short-lived token for a lender's forced first-login password reset."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    payload = {
        "sub": f"lender_reset:{lender_id}",
        "lender_id": lender_id,
        "scope": "lender_password_reset",
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "password_reset",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_lender_password_reset_token(token: str) -> str:
    payload = decode_token(token)
    if payload.get("scope") != "lender_password_reset" or payload.get("type") != "password_reset":
        raise ValueError("Invalid lender password reset token")
    lender_id = payload.get("lender_id")
    if not lender_id:
        raise ValueError("Invalid lender password reset token")
    return str(lender_id)


# ── Token generation ──────────────────────────────────────────────────────────
def generate_secure_token(length: int = 32) -> str:
    """Generate a URL-safe random token (e.g. for webhook secrets)."""
    return secrets.token_urlsafe(length)


# ── Admin TOTP helpers ───────────────────────────────────────────────────────


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _totp_at(secret: str, counter: int, digits: int = 6) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded.upper())
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    if not code or not code.isdigit():
        return False
    counter = int(datetime.now(timezone.utc).timestamp()) // 30
    return any(
        hmac.compare_digest(_totp_at(secret, counter + drift), code)
        for drift in range(-window, window + 1)
    )


def admin_fingerprint(ip_address: str, user_agent: str) -> str:
    material = f"{ip_address}|{user_agent}".encode()
    return hashlib.sha256(material).hexdigest()
