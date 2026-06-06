"""
Application configuration — driven entirely by environment variables.
Uses Pydantic Settings v2 for validation and type coercion.
"""

from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Application ──────────────────────────────────────
    APP_ENV: Literal["development", "staging", "production", "test"] = "development"
    SECRET_KEY: str = "dev-secret-change-in-production-must-be-64-chars-long"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15  # 15 minutes (refresh tokens handle long sessions)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    OTP_EXPIRE_SECONDS: int = 300  # 5 minutes
    OTP_LENGTH: int = 4
    DEBUG_LOG_OTP: bool = False
    OTP_RATE_LIMIT: int = 3  # max OTP requests per phone per window
    OTP_RATE_WINDOW_SECONDS: int = 3600  # rolling window (1 hour)

    # ── Database ──────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://smeflow:smeflow@localhost:5432/smeflow"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 40
    DATABASE_POOL_RECYCLE: int = 1800

    # ── Redis ─────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"
    OTP_REDIS_DB: int = 1
    SESSION_REDIS_DB: int = 2
    IDEMPOTENCY_REDIS_DB: int = 3
    USSD_REDIS_DB: int = 4

    # ── Celery / RabbitMQ ─────────────────────────────────
    RABBITMQ_URL: str = "amqp://guest:guest@localhost:5672/"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/4"

    # ── Paystack (all Ghana MNOs: MTN, Vodafone/Telecel, AirtelTigo) ─────────
    # Single API key — no direct MNO credentials needed.
    PAYSTACK_SECRET_KEY: str = ""
    PAYSTACK_BASE_URL: str = "https://api.paystack.co"
    PAYSTACK_DVA_PREFERRED_BANK: str = "wema-bank"
    PAYSTACK_STARTER_PLAN_CODE: str = ""
    PAYSTACK_PRO_PLAN_CODE: str = ""

    # ── WhatsApp Business API ─────────────────────────────
    WHATSAPP_ACCESS_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: str = "smeflow-webhook-token"
    WHATSAPP_APP_SECRET: str = ""

    # ── SMS (AfricasTalking) ──────────────────────────────
    AT_SMS_ENABLED: bool = False
    AT_API_KEY: str = ""
    AT_USERNAME: str = "sandbox"
    AT_SENDER_ID: str = "SMEFlow"
    AT_WEBHOOK_USERNAME: str = ""
    FCM_SERVER_KEY: str = ""
    BULK_SMS_DAILY_LIMIT: int = 25

    # ── Email (Resend) ────────────────────────────────────
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "SMEflow <noreply@smeflow.app>"

    # ── Web Push (VAPID) ──────────────────────────────────
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBSCRIBER_EMAIL: str = "admin@smeflow.app"

    # ── GRA ──────────────────────────────────────────────
    GRA_API_BASE_URL: str = "https://api.gra.gov.gh/v1"
    GRA_API_KEY: str = ""
    ENABLE_GRA_DIRECT_FILING: bool = False

    # ── NIA (Ghana Card verification) ────────────────────
    NIA_API_BASE_URL: str = "https://api.nia.gov.gh/v1"
    NIA_API_KEY: str = ""

    # ── USSD Gateway (Hubtel / Wigal) ────────────────────
    # Shared secret for HMAC-SHA256 signature verification on USSD callbacks.
    USSD_CALLBACK_SECRET: str = ""

    # ── Hubtel Phone Verification ────────────────────────
    HUBTEL_VERIFY_ENABLED: bool = False
    HUBTEL_VERIFY_BASE_URL: str = "https://rnv.hubtel.com"
    HUBTEL_CLIENT_ID: str = ""
    HUBTEL_CLIENT_SECRET: str = ""
    HUBTEL_ACCOUNT_NUMBER: str = ""
    HUBTEL_VERIFY_TIMEOUT_SECONDS: float = 10.0

    # ── Hubtel SMS ────────────────────────────────────────
    HUBTEL_SMS_BASE_URL: str = "https://smsc.hubtel.com"
    HUBTEL_SMS_SENDER_ID: str = "SMEFlow"

    # ── Hubtel OTP ────────────────────────────────────────
    HUBTEL_OTP_ENABLED: bool = False
    HUBTEL_OTP_BASE_URL: str = "https://api-otp.hubtel.com"

    # ── AWS / Storage ─────────────────────────────────────
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_S3_BUCKET: str = "smeflow-assets"
    AWS_REGION: str = "af-south-1"
    AWS_S3_PUBLIC_BASE_URL: str = ""

    # ── xAI / Grok ────────────────────────────────────────
    XAI_API_KEY: str = ""
    XAI_MODEL: str = "grok-3-mini"
    XAI_BASE_URL: str = "https://api.x.ai/v1"

    # ── Google Cloud Translation ──────────────────────────
    GOOGLE_TRANSLATE_ENABLED: bool = False
    GOOGLE_TRANSLATE_API_KEY: str = ""
    GOOGLE_TRANSLATE_BASE_URL: str = "https://translation.googleapis.com/language/translate/v2"

    # ── Groq (LLM chat + Whisper transcription) ───────────
    GROQ_API_KEY: str = ""
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_WHISPER_MODEL: str = "whisper-large-v3-turbo"
    GROQ_CHAT_MODEL: str = "llama-3.3-70b-versatile"

    # ── Sentry ────────────────────────────────────────────
    SENTRY_DSN: str = ""
    SENTRY_ENVIRONMENT: str = "development"
    OTEL_ENABLED: bool = False
    OTEL_EXPORTER_OTLP_ENDPOINT: str = ""
    OTEL_SERVICE_NAME: str = "smeflow-api"

    # ── Freemium Plan Limits ──────────────────────────────
    FREE_TIER_MONTHLY_SALES: int = -1
    FREE_TIER_ITEMS: int = 50
    FREE_TIER_EMPLOYEES: int = 0

    # ── Lender Partner API ────────────────────────────────
    LENDER_API_KEYS: str = "{}"  # JSON: {"lender_id": "sha256_of_api_key", ...}
    LENDER_API_KEY_EXPIRY_DAYS: int = 90
    LENDER_API_KEY_EXPIRY_ALERT_DAYS: int = 14
    LENDER_ORIGINATION_FEE_RATE_PERCENT: float = 2.0

    # ── Security ──────────────────────────────────────────
    SECRET_KEY_PREVIOUS: str = ""  # old key for zero-downtime rotation
    ADMIN_ALLOWED_IPS: str = ""  # comma-separated IPs/CIDR; empty = allow all in dev
    ADMIN_TOTP_ISSUER: str = "SMEFlow Admin"
    MAX_REQUEST_BODY_BYTES: int = 1_048_576
    TRUSTED_PROXY_COUNT: int = 0
    WEBHOOK_ALLOWED_IPS_PAYSTACK: str = ""
    WEBHOOK_ALLOWED_IPS_AT: str = ""
    WEBHOOK_ALLOWED_IPS_HUBTEL: str = ""

    # ── App URLs ──────────────────────────────────────────
    APP_BASE_URL: str = "https://app.smeflow.com"

    # ── Operations ────────────────────────────────────────
    AGENT_COMMISSION_MIN_PAYOUT_GHS: float = 10.0
    BILLING_GRACE_DAYS: int = 3

    # ── Merchant Settlements ──────────────────────────────
    # Minimum GHS balance before a merchant can request a settlement
    SETTLEMENT_MIN_GHS: float = 10.0
    # Settlements below this ceiling auto-approve; above requires admin sign-off
    SETTLEMENT_AUTO_APPROVE_CEILING_GHS: float = 5000.0
    # Minimum GHS balance before auto-settlement triggers (per-merchant threshold default)
    SETTLEMENT_DEFAULT_THRESHOLD_GHS: float = 50.0
    CREDIT_SCORE_MAX_AGE_HOURS: int = 168
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: int = 3
    CIRCUIT_BREAKER_OPEN_SECONDS: int = 60

    # ── Feature Flags ─────────────────────────────────────
    ENABLE_CREDIT_SCORING: bool = True
    ENABLE_USSD: bool = False
    ENABLE_ANALYTICS_PREMIUM: bool = False
    ENABLE_ANALYTICS_BENCHMARKING: bool = False
    # Legacy direct-MoMo agent payout (bypasses 48h hold + weekly Paystack batch) — keep False
    ENABLE_LEGACY_AGENT_MOMO_PAYOUT: bool = False

    # ── GRA Tax Rates (Ghana 2025) ────────────────────────
    VAT_RATE: float = 0.125  # 12.5% standard rate
    NHIL_RATE: float = 0.025  # 2.5% National Health Insurance Levy
    GETFUND_RATE: float = 0.01  # 1.0% Ghana Education Trust Fund
    COVID_LEVY_RATE: float = 0.01  # 1.0% COVID-19 Health Recovery Levy

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_db_url(cls, v: str) -> str:
        if not v.startswith("postgresql"):
            raise ValueError("DATABASE_URL must be a PostgreSQL connection string")
        return v

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        """Refuse to start in production with insecure defaults."""
        if self.APP_ENV == "production":
            _dev_key = "dev-secret-change-in-production-must-be-64-chars-long"
            if self.SECRET_KEY == _dev_key or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "SECRET_KEY must be at least 32 characters and must not be the dev default "
                    "when APP_ENV=production. Generate one with: "
                    'python -c "import secrets; print(secrets.token_hex(32))"'
                )
            if not self.ADMIN_ALLOWED_IPS.strip():
                raise ValueError(
                    "ADMIN_ALLOWED_IPS must be set to a non-empty comma-separated list of "
                    "IPs/CIDRs when APP_ENV=production. "
                    "An empty value allows ALL IPs to reach admin endpoints."
                )
        return self

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
