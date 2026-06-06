"""Provider readiness checks for paid pilot launch gates."""

from apps.api.core.config import Settings
from apps.api.core.provider_readiness import provider_readiness


def test_provider_readiness_marks_unconfigured_paystack_as_blocked():
    settings = Settings(
        PAYSTACK_SECRET_KEY="",
        GRA_API_KEY="",
        NIA_API_KEY="",
    )

    report = provider_readiness(settings)

    assert report["providers"]["paystack"]["status"] == "blocked"
    assert "PAYSTACK_SECRET_KEY" in report["providers"]["paystack"]["missing"]
    assert report["status"] == "blocked"
    assert "paystack" in report["blocking"]


def test_provider_readiness_marks_optional_ussd_as_disabled():
    settings = Settings()

    report = provider_readiness(settings)

    assert report["providers"]["ussd"]["status"] == "disabled"
    assert report["providers"]["ussd"]["required_for_pilot"] is False


def test_provider_readiness_marks_configured_core_providers_as_ready():
    configured = {
        "PAYSTACK_SECRET_KEY": "sk_live_test",
        "AT_SMS_ENABLED": True,
        "AT_API_KEY": "at-key",
        "AT_USERNAME": "smeflow",
        "AT_WEBHOOK_USERNAME": "smeflow",
        "HUBTEL_VERIFY_ENABLED": True,
        "HUBTEL_CLIENT_ID": "hubtel-client",
        "HUBTEL_CLIENT_SECRET": "hubtel-secret",
        "HUBTEL_ACCOUNT_NUMBER": "hubtel-account",
        "GRA_API_KEY": "gra-key",
        "NIA_API_KEY": "nia-key",
    }
    settings = Settings(**configured)

    report = provider_readiness(settings)

    assert report["status"] == "ready"
    assert report["providers"]["paystack"]["status"] == "ready"
    assert report["providers"]["africastalking_sms"]["status"] == "ready"
    assert report["providers"]["hubtel_verification"]["status"] == "ready"
    assert report["providers"]["gra_nia"]["status"] == "ready"
    assert "mtn_momo" not in report["providers"]
