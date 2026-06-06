"""Provider readiness summaries for launch and paid-pilot gates."""

from __future__ import annotations

from collections.abc import Iterable

from apps.api.core.config import Settings


def _missing(settings: Settings, names: Iterable[str]) -> list[str]:
    return [name for name in names if not getattr(settings, name, None)]


def _required_provider(settings: Settings, label: str, required: list[str]) -> dict:
    missing = _missing(settings, required)
    return {
        "label": label,
        "status": "blocked" if missing else "ready",
        "required_for_pilot": True,
        "missing": missing,
    }


def _optional_provider(
    settings: Settings,
    label: str,
    enabled_flag: str,
    required: list[str],
) -> dict:
    if not getattr(settings, enabled_flag):
        return {
            "label": label,
            "status": "disabled",
            "required_for_pilot": False,
            "missing": [],
        }
    missing = _missing(settings, required)
    return {
        "label": label,
        "status": "blocked" if missing else "ready",
        "required_for_pilot": False,
        "missing": missing,
    }


def provider_readiness(settings: Settings) -> dict:
    """Return launch-readiness status for external providers.

    This intentionally checks configuration only. Smoke tests still need to
    prove callbacks, duplicate handling, and sandbox references before launch.
    """
    providers = {
        "paystack": _required_provider(
            settings,
            "Paystack — all Ghana MNOs (MTN, Vodafone/Telecel, AirtelTigo) + subscriptions",
            ["PAYSTACK_SECRET_KEY"],
        ),
        "africastalking_sms": _optional_provider(
            settings,
            "AfricasTalking SMS",
            "AT_SMS_ENABLED",
            ["AT_API_KEY", "AT_USERNAME", "AT_WEBHOOK_USERNAME"],
        ),
        "hubtel_verification": _optional_provider(
            settings,
            "Hubtel phone verification",
            "HUBTEL_VERIFY_ENABLED",
            ["HUBTEL_CLIENT_ID", "HUBTEL_CLIENT_SECRET", "HUBTEL_ACCOUNT_NUMBER"],
        ),
        "gra_nia": _required_provider(
            settings,
            "GRA/NIA verification",
            ["GRA_API_KEY", "NIA_API_KEY"],
        ),
        "ussd": _optional_provider(
            settings,
            "USSD gateway",
            "ENABLE_USSD",
            ["USSD_CALLBACK_SECRET"],
        ),
    }
    blocking = [
        name
        for name, provider in providers.items()
        if provider["required_for_pilot"] and provider["status"] != "ready"
    ]
    return {
        "status": "blocked" if blocking else "ready",
        "blocking": blocking,
        "providers": providers,
    }
