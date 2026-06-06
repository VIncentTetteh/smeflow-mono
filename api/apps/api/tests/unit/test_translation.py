import pytest

from libs.translation.google_translate import (
    normalize_app_language,
    to_google_language,
    translate_text,
)


@pytest.mark.parametrize(
    "app_code,google_code,canonical",
    [
        ("en", "en", "en"),
        ("tw", "ak", "ak"),
        ("ak", "ak", "ak"),
        ("ew", "ee", "ee"),
        ("ee", "ee", "ee"),
        ("ga", "gaa", "gaa"),
        ("gaa", "gaa", "gaa"),
        ("ha", "ha", "ha"),
        ("pid", "en", "en"),
        ("unknown", "en", "en"),
    ],
)
def test_language_code_mapping(app_code: str, google_code: str, canonical: str):
    assert to_google_language(app_code) == google_code
    assert normalize_app_language(app_code) == canonical


@pytest.mark.asyncio
async def test_translate_text_returns_original_when_disabled(monkeypatch):
    from libs.translation import google_translate

    settings = google_translate.get_settings()
    monkeypatch.setattr(settings, "GOOGLE_TRANSLATE_ENABLED", False)
    monkeypatch.setattr(settings, "GOOGLE_TRANSLATE_API_KEY", "")

    assert await translate_text("Hello", "ak", source_language="en") == "Hello"


@pytest.mark.asyncio
async def test_translate_text_uses_google_response(monkeypatch):
    from libs.translation import google_translate

    settings = google_translate.get_settings()
    monkeypatch.setattr(settings, "GOOGLE_TRANSLATE_ENABLED", True)
    monkeypatch.setattr(settings, "GOOGLE_TRANSLATE_API_KEY", "test-key")

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"data": {"translations": [{"translatedText": "Akwaaba"}]}}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, *, params, json):
            assert params["key"] == "test-key"
            assert json["target"] == "ak"
            assert json["source"] == "en"
            return FakeResponse()

    monkeypatch.setattr(google_translate.httpx, "AsyncClient", FakeClient)

    assert await translate_text("Welcome", "ak", source_language="en") == "Akwaaba"
