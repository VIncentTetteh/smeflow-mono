"""Google Cloud Translation wrapper.

The assistant uses app-facing language codes, while Google Cloud Translation
uses its own supported codes for a few Ghanaian languages. This module keeps
that mapping explicit and fails open to the original text whenever translation
is not configured or Google is temporarily unavailable.
"""

from __future__ import annotations

import html
from typing import Final

import httpx
import structlog

from apps.api.core.config import get_settings

logger = structlog.get_logger()

SUPPORTED_APP_LANGUAGES: Final[tuple[str, ...]] = ("en", "ak", "ee", "gaa", "ha")
APP_TO_GOOGLE_LANGUAGE: Final[dict[str, str]] = {
    "en": "en",
    "tw": "ak",  # Backward compatibility: Google lists Twi (Akan) as ak.
    "ak": "ak",
    "ew": "ee",  # Backward compatibility with SMEFlow's old Ewe code.
    "ee": "ee",
    "gaa": "gaa",
    "ga": "gaa",
    "ha": "ha",
    "pid": "en",
}
GOOGLE_TO_APP_LANGUAGE: Final[dict[str, str]] = {
    "en": "en",
    "ak": "ak",
    "ee": "ee",
    "gaa": "gaa",
    "ha": "ha",
}
APP_LANGUAGE_LABELS: Final[dict[str, str]] = {
    "en": "English",
    "ak": "Twi / Akan",
    "ee": "Ewe",
    "gaa": "Ga",
    "ha": "Hausa",
}


def normalize_app_language(language: str | None) -> str:
    """Return the canonical SMEFlow app language code."""
    if not language:
        return "en"
    google_code = APP_TO_GOOGLE_LANGUAGE.get(language.lower(), "en")
    return GOOGLE_TO_APP_LANGUAGE.get(google_code, "en")


def to_google_language(language: str | None) -> str:
    """Return the Google Translation target/source code for an app code."""
    return APP_TO_GOOGLE_LANGUAGE.get((language or "en").lower(), "en")


def app_language_label(language: str | None) -> str:
    return APP_LANGUAGE_LABELS.get(normalize_app_language(language), "English")


async def translate_text(
    text: str,
    target_language: str,
    *,
    source_language: str | None = None,
) -> str:
    """Translate text with Google Cloud Translation, returning original text on failure."""
    settings = get_settings()
    if not text.strip():
        return text

    target = to_google_language(target_language)
    source = to_google_language(source_language) if source_language else None
    if target == "en" and (source in (None, "en")):
        return text

    if not settings.GOOGLE_TRANSLATE_ENABLED or not settings.GOOGLE_TRANSLATE_API_KEY:
        return text

    payload: dict[str, str | list[str]] = {
        "q": [text],
        "target": target,
        "format": "text",
    }
    if source:
        payload["source"] = source

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(
                settings.GOOGLE_TRANSLATE_BASE_URL,
                params={"key": settings.GOOGLE_TRANSLATE_API_KEY},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        translations = data.get("data", {}).get("translations", [])
        translated = translations[0].get("translatedText") if translations else None
        return html.unescape(str(translated or text))
    except Exception as exc:
        logger.warning(
            "translation.google.failed",
            target_language=target,
            source_language=source,
            error=str(exc),
        )
        return text
