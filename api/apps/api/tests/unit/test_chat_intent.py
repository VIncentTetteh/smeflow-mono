"""Unit tests for the chat intent parser (regex path only, no LLM calls)."""

import pytest

from apps.api.modules.chat.intent_parser import (
    CONFIDENCE_THRESHOLD,
    _classify_regex,
    _extract_language_entities,
    _extract_report_entities,
    _extract_sale_entities,
    _extract_stock_entities,
)


class TestRegexClassifier:
    @pytest.mark.parametrize(
        "text,expected_intent",
        [
            ("i sold 3 bags of rice at 50 cedis", "record_sale"),
            ("I just sold tomatoes for 5 cedis each", "record_sale"),
            ("customer bought 10 pieces", "record_sale"),
            ("record a sale of palm oil", "record_sale"),
            ("how many bags of rice do i have", "check_stock"),
            ("what's my stock of tomatoes", "check_stock"),
            ("how much flour is left", "check_stock"),
            ("do i still have any milk", "check_stock"),
            ("show me today's sales", "get_report"),
            ("what is my total revenue this week", "get_report"),
            ("give me a daily summary", "get_report"),
            ("who owes me money", "list_receivables"),
            ("list my debtors", "list_receivables"),
            ("which customers are on credit", "list_receivables"),
            ("help", "help"),
            ("hello", "help"),
            ("what can you do", "help"),
        ],
    )
    def test_intent_classification(self, text: str, expected_intent: str):
        intent, confidence = _classify_regex(text)
        assert intent == expected_intent, f"Expected {expected_intent}, got {intent} for: {text!r}"
        assert confidence >= CONFIDENCE_THRESHOLD

    @pytest.mark.parametrize(
        "text",
        [
            "the weather is nice today",
            "random xyz nonsense 123",
            "qwertyuiop",
        ],
    )
    def test_unknown_intent(self, text: str):
        intent, confidence = _classify_regex(text)
        assert intent == "unknown"
        assert confidence == 0.0

    def test_multi_signal_boosts_confidence(self):
        # Message with multiple sale signals should score higher
        _, conf_single = _classify_regex("sold tomatoes")
        _, conf_multi = _classify_regex("i sold 3 bags of rice, customer bought them")
        assert conf_multi >= conf_single


class TestEntityExtraction:
    def test_extract_sale_entities_full(self):
        text = "i sold 3 bags of rice at 50 cedis"
        entities = _extract_sale_entities(text)
        assert entities.get("qty") == 3.0
        assert entities.get("unit") is not None
        assert "rice" in str(entities.get("item_name", "")).lower()
        assert entities.get("unit_price") == 50.0

    def test_extract_sale_entities_with_phone(self):
        text = "sold 2 kg tomatoes at 5 to 0244123456"
        entities = _extract_sale_entities(text)
        assert entities.get("customer_phone") == "0244123456"

    def test_extract_stock_entities(self):
        text = "how many bags of flour do i have left"
        entities = _extract_stock_entities(text)
        # Should pick up "flour" or "bags of flour"
        assert entities.get("item_name") is not None

    def test_extract_report_entities_today(self):
        text = "show me today's sales summary"
        entities = _extract_report_entities(text)
        assert entities.get("period") == "today"

    def test_extract_report_entities_this_week(self):
        text = "what is my revenue this week"
        entities = _extract_report_entities(text)
        assert entities.get("period") == "this week"

    def test_extract_report_entities_yesterday(self):
        text = "show yesterday report"
        entities = _extract_report_entities(text)
        assert entities.get("period") == "yesterday"

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("language twi", "tw"),
            ("language ewe", "ee"),
            ("switch to ga", "gaa"),
            ("respond in hausa", "ha"),
        ],
    )
    def test_extract_language_entities_google_supported_ghanaian_codes(
        self,
        text: str,
        expected: str,
    ):
        entities = _extract_language_entities(text)
        assert entities.get("language") == expected


class TestConfidenceScaling:
    def test_first_hit_gives_base_confidence(self):
        _, conf = _classify_regex("who owes me")  # 1 pattern hit
        assert abs(conf - 0.55) < 0.01

    def test_two_hits_gives_higher_confidence(self):
        _, conf = _classify_regex("list my debtors who owe me")
        assert conf > 0.55

    def test_confidence_capped_at_95(self):
        _, conf = _classify_regex("sold sold sale record a sale customer bought")
        assert conf <= 0.95
