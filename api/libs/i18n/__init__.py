"""
Lightweight i18n helper for SMEFlow.

Usage::

    from libs.i18n import t

    msg = t("chat.sale_recorded", "en", qty=3, item="rice", price=50, total=150)
    ussd_menu = t("ussd.main_menu", "tw")
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_SUPPORTED_LOCALES = ("en", "tw", "ak", "ew")
_DEFAULT_LOCALE = "en"

# Lazy-loaded locale caches
_cache: dict[str, dict[str, str]] = {}


def _load(lang: str) -> dict[str, str]:
    """Load and cache the STRINGS dict for *lang*."""
    if lang not in _cache:
        if lang == "en":
            from libs.i18n.locales.en import STRINGS
        elif lang == "tw":
            from libs.i18n.locales.tw import STRINGS
        elif lang == "ak":
            from libs.i18n.locales.ak import STRINGS
        elif lang == "ew":
            from libs.i18n.locales.ew import STRINGS
        else:
            logger.warning("i18n: unsupported locale %r, falling back to 'en'", lang)
            from libs.i18n.locales.en import STRINGS
        _cache[lang] = STRINGS
    return _cache[lang]


def t(key: str, lang: str = _DEFAULT_LOCALE, **kwargs: Any) -> str:
    """Return the translated string for *key* in *lang*, with optional format kwargs.

    Falls back to English if the key is absent in the requested locale.
    Falls back to the raw key string if absent in English too (never crashes).
    """
    lang = lang if lang in _SUPPORTED_LOCALES else _DEFAULT_LOCALE
    strings = _load(lang)

    template = strings.get(key)
    if template is None and lang != _DEFAULT_LOCALE:
        # Graceful degradation: try English
        template = _load(_DEFAULT_LOCALE).get(key)
    if template is None:
        logger.warning("i18n: missing key %r for lang %r", key, lang)
        return key

    if kwargs:
        try:
            return template.format(**kwargs)
        except KeyError as exc:
            logger.warning("i18n: missing format param %s for key %r", exc, key)
            return template

    return template


def get_translator(lang: str):
    """Return a single-argument callable bound to *lang*.

    Useful when you want to pass a translator into a helper function::

        tr = get_translator(session.language)
        reply = tr("chat.unknown")
    """

    def _tr(key: str, **kwargs: Any) -> str:
        return t(key, lang, **kwargs)

    return _tr


def supported_locales() -> tuple[str, ...]:
    return _SUPPORTED_LOCALES
