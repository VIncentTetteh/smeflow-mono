import pytest
from pydantic import ValidationError

from apps.api.core.config import Settings


def production_settings(**overrides: object) -> Settings:
    data = {
        "APP_ENV": "production",
        "SECRET_KEY": "x" * 64,
        "ADMIN_ALLOWED_IPS": "203.0.113.0/24",
        "DATABASE_URL": "postgresql+asyncpg://user:pass@db:5432/smeflow",
    }
    data.update(overrides)
    return Settings(**data)


def test_production_disables_public_docs_by_default() -> None:
    settings = production_settings()

    assert settings.ENABLE_PUBLIC_DOCS is False


def test_production_rejects_public_docs_without_admin_allowlist() -> None:
    with pytest.raises(ValidationError, match="ADMIN_ALLOWED_IPS"):
        production_settings(ENABLE_PUBLIC_DOCS=True, ADMIN_ALLOWED_IPS="")


def test_production_rejects_public_metrics() -> None:
    with pytest.raises(ValidationError, match="ENABLE_PUBLIC_METRICS"):
        production_settings(ENABLE_PUBLIC_METRICS=True)
