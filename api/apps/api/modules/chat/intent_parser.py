"""
Chat intent parser for SME Flow.

Pipeline:
  1. Normalise & clean message text
  2. Fast regex / keyword matching for common intents
  3. Grok LLM fallback for ambiguous messages
  4. Return a structured Intent object

Supported intents:
  - record_sale     : "I sold 3 tomatoes at 5 cedis"
  - check_stock     : "how many bags of rice do I have?"
  - get_report      : "show me today's sales"
  - list_receivables: "who owes me money?"
  - help            : "what can you do?"
  - unknown         : anything else
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import structlog

logger = structlog.get_logger()

# ── Intent registry ───────────────────────────────────────────────────────────

INTENT_PATTERNS: dict[str, list[str]] = {
    "record_sale": [
        r"\b(sold|sell|sale|sold out|i sold|just sold)\b",
        r"\b(customer (bought|paid|purchased))\b",
        r"\b(record (a )?sale)\b",
    ],
    "check_stock": [
        r"\b(stock|inventory|how many|how much|quantity|left|remaining|available)\b",
        r"\b(check (my )?(stock|inventory))\b",
        r"\b(do i (still )?have)\b",
    ],
    "get_report": [
        r"\b(report|summary|total|revenue|sales|daily|weekly|monthly|earnings)\b",
        r"\b(show (me )?(\w+\s+)?(sales|revenue|report))\b",
        r"\b(how (much|many) (did i (make|sell)|have i sold))\b",
    ],
    "list_receivables": [
        r"\b(owe|owes|debt|receivable|balance due|unpaid|credit|on credit|who (hasn't|haven't) paid)\b",
        r"\b(list (my )?(debtors|receivables|credits))\b",
        r"\b(which|what|who).*(customers?|people|buyers?).*(credit|owe|debt|unpaid)\b",
    ],
    "restock_alert": [
        r"\b(restock|buy more|order|need to restock|need items|predict|forecast)\b",
        r"\b(what (should i|do i need) (to )?restock)\b",
        r"\b((coming|running) (out|low))\b",
    ],
    "help": [
        r"\b(help|what can you (do|help)|commands|options|menu|guide)\b",
        r"^(hi|hello|hey|start|good (morning|afternoon|evening))[\s!?]*$",
    ],
    "set_language": [
        r"\b(language|lang|kasa)\s+(en|english|tw|twi|akan|ew|ee|ewe|ak|ga|gaa|ha|hausa)\b",
        r"\b(switch|change)\s+(to\s+)?(english|twi|akan|ewe|ga|hausa)\b",
        r"\b(speak|respond|reply)\s+(in\s+)?(english|twi|akan|ewe|ga|hausa)\b",
    ],
    "credit_score": [
        r"\b(credit score|credit rating|loan eligibility|creditworthiness)\b",
        r"\b(my score|check (my )?score)\b",
        r"\b(how much can i borrow|borrow|loan limit|loan amount)\b",
        r"\b(what (is|are) (my )?(credit|score|loan|rating))\b",
    ],
    "best_selling": [
        r"\b(best (selling|seller|sellers|sold)|top (selling|seller|item|items|product|products))\b",
        r"\b(most (popular|sold|selling)|fastest (moving|selling))\b",
        r"\b(what (is|are|were) (my )?best\b|which item|which product)\b",
        r"\b(bestsell|best-sell)\b",
    ],
}

# Compiled patterns cache
_COMPILED: dict[str, list[re.Pattern]] = {
    intent: [re.compile(p, re.IGNORECASE) for p in patterns]
    for intent, patterns in INTENT_PATTERNS.items()
}


@dataclass
class Intent:
    name: str
    confidence: float  # 0.0-1.0
    entities: dict[str, Any] = field(default_factory=dict)
    raw_message: str = ""
    llm_used: bool = False


# ── Regex classifier ──────────────────────────────────────────────────────────


def _classify_regex(text: str) -> tuple[str, float]:
    """Return (intent_name, confidence) using regex matching."""
    scores: dict[str, int] = {}
    for intent, patterns in _COMPILED.items():
        hit_count = sum(1 for p in patterns if p.search(text))
        if hit_count:
            scores[intent] = hit_count

    if not scores:
        return "unknown", 0.0

    best = max(scores, key=lambda k: scores[k])
    # Confidence: first hit = 0.55, additional hits add 0.15 each, capped at 0.95
    confidence = min(0.55 + (scores[best] - 1) * 0.15, 0.95)
    return best, confidence


# ── Entity extractors ─────────────────────────────────────────────────────────

_QTY_PRICE = re.compile(
    r"(\d+(?:\.\d+)?)\s*"
    r"(bags?|kg|kilos?|pieces?|pcs?|litres?|liters?|bottles?|boxes?|bundles?|units?)?\s*"
    r"(?:of\s+)?([\w\s]+?)\s+"
    r"(?:at|for|@|cedis?|ghc|gh[c₵])\s*"
    r"(\d+(?:\.\d+)?)",
    re.IGNORECASE,
)

_ITEM_ONLY = re.compile(
    r"(\d+(?:\.\d+)?)\s*(bags?|kg|pieces?|pcs?|litres?|bottles?|boxes?)?\s+(?:of\s+)?([\w\s]+)",
    re.IGNORECASE,
)
_PHONE = re.compile(r"(\+?233[0-9]{9}|0[0-9]{9})")
_DATE_WORDS = re.compile(
    r"\b(today|yesterday|this week|this month|last week|last month)\b", re.IGNORECASE
)


def _extract_sale_entities(text: str) -> dict:
    entities: dict[str, Any] = {}
    match = _QTY_PRICE.search(text)
    if match:
        qty, unit, item_name, price = match.groups()
        entities["qty"] = float(qty)
        entities["unit"] = unit
        entities["item_name"] = item_name.strip()
        entities["unit_price"] = float(price)
    phone = _PHONE.search(text)
    if phone:
        entities["customer_phone"] = phone.group(0)
    return entities


def _extract_stock_entities(text: str) -> dict:
    entities: dict[str, Any] = {}
    # Try to find item name after "of", "have", "stock of"
    match = re.search(
        r"(?:stock of|how many|how much|do i have)\s+(?:\d+\s+)?([\w\s]+?)(?:\?|$|left|remaining|available)",
        text,
        re.IGNORECASE,
    )
    if match:
        item_name = match.group(1).strip()
        item_name = re.sub(
            r"\b(do i|do i have|i have|have|left|remaining|available)\b.*$",
            "",
            item_name,
            flags=re.IGNORECASE,
        ).strip()
        if item_name:
            entities["item_name"] = item_name
    return entities


def _extract_report_entities(text: str) -> dict:
    entities: dict[str, Any] = {}
    date_match = _DATE_WORDS.search(text)
    if date_match:
        entities["period"] = date_match.group(0).lower()
    return entities


_LANG_ALIASES = {
    "english": "en",
    "en": "en",
    "twi": "tw",
    "tw": "tw",
    "akan": "ak",
    "ak": "ak",
    "ewe": "ee",
    "ew": "ee",
    "ee": "ee",
    "ga": "gaa",
    "gaa": "gaa",
    "hausa": "ha",
    "ha": "ha",
}

_LANG_PATTERN = re.compile(
    r"\b(en|english|tw|twi|akan|ak|ew|ee|ewe|ga|gaa|ha|hausa)\b",
    re.IGNORECASE,
)


def _extract_language_entities(text: str) -> dict:
    match = _LANG_PATTERN.search(text)
    if match:
        raw = match.group(1).lower()
        return {"language": _LANG_ALIASES.get(raw, "en")}
    return {}


_ENTITY_EXTRACTORS = {
    "record_sale": _extract_sale_entities,
    "check_stock": _extract_stock_entities,
    "get_report": _extract_report_entities,
    "set_language": _extract_language_entities,
}


# ── LLM fallback ──────────────────────────────────────────────────────────────

_LLM_SYSTEM = """You are an intent classifier for a Ghanaian small-business management app.
You understand English, Twi/Akan, Ewe, Ga, and Hausa.
Classify the user message into exactly one of these intents:
  record_sale, check_stock, get_report, list_receivables, credit_score, best_selling, set_language, help, unknown

Reply with valid JSON only, no prose:
{"intent": "<name>", "confidence": <0.0-1.0>, "entities": {}}

Entities to extract per intent:
- record_sale: {"item_name": str, "qty": float, "unit_price": float, "unit": str|null, "customer_phone": str|null}
- check_stock: {"item_name": str|null}
- get_report:  {"period": "today"|"yesterday"|"this_week"|"this_month"|null}
- list_receivables: {}
- credit_score: {}
- best_selling: {"period": "today"|"this_week"|"this_month"|null, "limit": int|null}
- set_language: {"language": "en"|"ak"|"ee"|"gaa"|"ha"}
- help: {}
- unknown: {}
"""


async def _classify_llm(text: str) -> Intent:
    """Use Grok to classify when regex confidence is low."""
    from apps.api.core.config import get_settings

    settings = get_settings()

    if not settings.XAI_API_KEY:
        return Intent(name="unknown", confidence=0.0, raw_message=text, llm_used=True)

    import json

    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=settings.XAI_API_KEY,
            base_url=settings.XAI_BASE_URL,
        )
        response = await client.chat.completions.create(
            model=settings.XAI_MODEL,
            max_tokens=256,
            messages=[
                {"role": "system", "content": _LLM_SYSTEM},
                {"role": "user", "content": text},
            ],
        )
        raw = (response.choices[0].message.content or "{}").strip()
        # Strip markdown fences if present
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        data = json.loads(raw)
        return Intent(
            name=data.get("intent", "unknown"),
            confidence=float(data.get("confidence", 0.5)),
            entities=data.get("entities", {}),
            raw_message=text,
            llm_used=True,
        )
    except Exception as exc:
        logger.warning("chat.llm_classify_failed", error=str(exc))
        return Intent(name="unknown", confidence=0.0, raw_message=text, llm_used=True)


# ── Public API ────────────────────────────────────────────────────────────────

CONFIDENCE_THRESHOLD = 0.4


async def parse_intent(text: str) -> Intent:
    """
    Full pipeline: normalise → regex → (optionally) LLM fallback.
    Always returns an Intent with name in INTENT_PATTERNS | {"unknown"}.
    """
    normalised = text.strip().lower()

    intent_name, confidence = _classify_regex(normalised)

    if confidence >= CONFIDENCE_THRESHOLD and intent_name != "unknown":
        extractor = _ENTITY_EXTRACTORS.get(intent_name)
        entities = extractor(normalised) if extractor else {}
        logger.debug("chat.intent.regex", intent=intent_name, confidence=confidence)
        return Intent(
            name=intent_name,
            confidence=confidence,
            entities=entities,
            raw_message=text,
            llm_used=False,
        )

    # Low confidence — use LLM
    logger.debug("chat.intent.llm_fallback", text_preview=text[:40])
    return await _classify_llm(text)
