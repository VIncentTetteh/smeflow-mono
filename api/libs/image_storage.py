"""Public image storage for catalog item photos.

Uses S3 when real AWS credentials are configured (production); otherwise falls
back to a local media directory served by the API at /media (dev/demo). The
public URL for the local fallback is derived from the request host so it works
across localhost and LAN IPs without extra config.
"""

from __future__ import annotations

import ipaddress
import os
import re
from pathlib import Path
from uuid import uuid4

from apps.api.core.config import get_settings

# Default resolves relative to this file (api/media locally, /app/media in the
# Docker image, since the container's WORKDIR is /app) so it's writable both
# in and out of Docker without requiring MEDIA_ROOT to be set.
_DEFAULT_MEDIA_ROOT = Path(__file__).resolve().parent.parent / "media"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", str(_DEFAULT_MEDIA_ROOT)))

_HOST_ONLY_RE = re.compile(r"^https?://(\[[^\]]+\]|[^/:]+)(?::\d+)?")


def _is_safe_local_host(host: str) -> bool:
    """True only for localhost or a genuinely private/loopback IP address.

    Uses `ipaddress` for real parsing rather than a string-prefix check —
    a prefix check (e.g. host.startswith("10.")) would be bypassed by an
    attacker-controlled hostname like "10.evil.com" or "localhost.evil.com",
    which starts with an allowed prefix but resolves nowhere near it.
    """
    if host == "localhost":
        return True
    try:
        addr = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return addr.is_private or addr.is_loopback


def _safe_local_base_url(request_base_url: str, settings) -> str:
    """Only trust the request's Host header to build the stored, publicly
    served image_url when it's localhost or a private LAN address — the Host
    header is client-controlled, so blindly trusting it here would let an
    attacker poison a permanently stored catalog image URL (Host header
    injection / stored URL poisoning). Falls back to APP_BASE_URL otherwise.
    """
    match = _HOST_ONLY_RE.match(request_base_url)
    host = match.group(1) if match else ""
    if _is_safe_local_host(host):
        return request_base_url.rstrip("/")
    return settings.APP_BASE_URL.rstrip("/")


_EXT_BY_TYPE = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
ALLOWED_IMAGE_TYPES = set(_EXT_BY_TYPE)
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


def _s3_configured(settings) -> bool:
    ak = settings.AWS_ACCESS_KEY_ID
    sk = settings.AWS_SECRET_ACCESS_KEY
    return bool(
        ak and sk and settings.AWS_S3_BUCKET
        and not ak.startswith("your-") and not sk.startswith("your-")
    )


def store_item_image(
    *, data: bytes, content_type: str, business_id: str, item_id: str, request_base_url: str
) -> tuple[str, str]:
    """Persist an item image and return (public_url, storage_key)."""
    ext = _EXT_BY_TYPE.get(content_type, "jpg")
    key = f"items/{business_id}/{item_id}/{uuid4().hex}.{ext}"
    settings = get_settings()

    if _s3_configured(settings):
        import boto3

        s3 = boto3.client(
            "s3",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
        s3.put_object(
            Bucket=settings.AWS_S3_BUCKET,
            Key=key,
            Body=data,
            ContentType=content_type,
            ACL="public-read",
        )
        base = settings.AWS_S3_PUBLIC_BASE_URL.rstrip("/") if settings.AWS_S3_PUBLIC_BASE_URL else (
            f"https://{settings.AWS_S3_BUCKET}.s3.{settings.AWS_REGION}.amazonaws.com"
        )
        return f"{base}/{key}", key

    # Local fallback (dev/demo): write under MEDIA_ROOT, serve via /media.
    dest = MEDIA_ROOT / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    base = _safe_local_base_url(request_base_url, settings)
    return f"{base}/media/{key}", key
