"""Public image storage for catalog item photos.

Uses S3 when real AWS credentials are configured (production); otherwise falls
back to a local media directory served by the API at /media (dev/demo). The
public URL for the local fallback is derived from the request host so it works
across localhost and LAN IPs without extra config.
"""

from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

from apps.api.core.config import get_settings

MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", "/app/media"))

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
    base = request_base_url.rstrip("/")
    return f"{base}/media/{key}", key
