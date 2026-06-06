"""Phone number helpers for Ghana MSISDNs."""

from __future__ import annotations

import re

_NON_DIGITS = re.compile(r"\D")


def normalize_ghana_phone(phone: str) -> str:
    """Normalize Ghana phone numbers to E.164 (+233XXXXXXXXX)."""
    cleaned = _NON_DIGITS.sub("", phone.strip())
    if cleaned.startswith("233") and len(cleaned) == 12:
        normalized = f"+{cleaned}"
    elif cleaned.startswith("0") and len(cleaned) == 10:
        normalized = f"+233{cleaned[1:]}"
    elif len(cleaned) == 9:
        normalized = f"+233{cleaned}"
    else:
        normalized = f"+{cleaned}" if phone.strip().startswith("+") else cleaned

    if not re.fullmatch(r"\+233[0-9]{9}", normalized):
        raise ValueError("Must be a valid Ghana phone number (+233XXXXXXXXX)")
    return normalized
