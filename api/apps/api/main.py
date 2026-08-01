"""
SME Flow API — Application Factory
"""

from contextlib import asynccontextmanager
from typing import Any

import sentry_sdk
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from sentry_sdk.integrations.fastapi import FastApiIntegration
from slowapi.errors import RateLimitExceeded

from apps.api.core.config import get_settings
from apps.api.core.database import check_db_connection, db_engine
from apps.api.core.exceptions import register_exception_handlers
from apps.api.core.middleware import (
    ContentLengthLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    TenantMiddleware,
    limiter,
)
from apps.api.core.redis import check_redis_connection, close_all_pools
from apps.api.core.schema import check_required_schema_tables

settings = get_settings()

# ── Logging ───────────────────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer()
        if settings.is_production
        else structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.BoundLogger,
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

# ── Sentry ────────────────────────────────────────────────────────────────────
if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.1,
    )


def _configure_tracing(app: FastAPI) -> None:
    if not settings.OTEL_ENABLED:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(
            resource=Resource.create({"service.name": settings.OTEL_SERVICE_NAME})
        )
        if settings.OTEL_EXPORTER_OTLP_ENDPOINT:
            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.OTEL_EXPORTER_OTLP_ENDPOINT))
            )
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
        SQLAlchemyInstrumentor().instrument(engine=db_engine.sync_engine)
    except Exception as exc:
        structlog.get_logger().warning("otel.configure_failed", error=str(exc))


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    log = structlog.get_logger()
    log.info("startup.begin", env=settings.APP_ENV)

    # Verify connectivity
    db_ok = await check_db_connection()
    redis_ok = await check_redis_connection()
    log.info("startup.checks", db=db_ok, redis=redis_ok)

    if not db_ok or not redis_ok:
        log.warning("startup.degraded", db=db_ok, redis=redis_ok)

    yield

    # Shutdown
    log.info("shutdown.begin")
    await db_engine.dispose()
    await close_all_pools()
    log.info("shutdown.complete")


# ── App Factory ───────────────────────────────────────────────────────────────
def create_app() -> FastAPI:
    docs_enabled = settings.ENABLE_PUBLIC_DOCS or not settings.is_production
    app = FastAPI(
        title="SME Flow API",
        description=(
            "Fintech Operations Platform for Ghanaian Informal SMEs\n\n"
            "**Auth:** Call `POST /api/v1/auth/otp/request` → `POST /api/v1/auth/otp/verify` "
            "to get a JWT, then click **Authorize** and paste the `access_token` value."
        ),
        version="1.0.0",
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url="/api/redoc" if docs_enabled else None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )

    # ── OpenAPI security scheme ───────────────────────────────────────────────
    # Registers the "Authorize" button in Swagger UI so Bearer tokens can be
    # pasted in and are sent as `Authorization: Bearer <token>` on every request.
    def _custom_openapi() -> dict:
        if app.openapi_schema:
            return app.openapi_schema
        from fastapi.openapi.utils import get_openapi

        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        schema.setdefault("components", {})
        schema["components"]["securitySchemes"] = {
            "BearerAuth": {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
                "description": (
                    "Paste the `access_token` from `POST /api/v1/auth/otp/verify`. "
                    "Do **not** include the 'Bearer ' prefix — Swagger adds it automatically."
                ),
            }
        }
        # Apply BearerAuth globally; public endpoints (OTP, health) are unaffected
        # because the middleware only rejects missing tokens on protected routes.
        schema["security"] = [{"BearerAuth": []}]
        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = _custom_openapi  # type: ignore[method-assign]

    # ── Middleware (outermost → innermost) ────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if settings.is_development else ["https://app.smeflow.io"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(TenantMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(ContentLengthLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    # ── Rate limiting ─────────────────────────────────────────────────────────
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Any, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={"error": {"code": "RATE_LIMIT", "message": "Too many requests. Slow down."}},
        )

    # ── Exception handlers ────────────────────────────────────────────────────
    register_exception_handlers(app)
    _configure_tracing(app)

    # ── Prometheus metrics ────────────────────────────────────────────────────
    if settings.ENABLE_PUBLIC_METRICS or not settings.is_production:
        Instrumentator(
            should_group_status_codes=False,
            should_ignore_untemplated=True,
            should_respect_env_var=True,
            env_var_name="ENABLE_METRICS",
        ).instrument(app).expose(app, endpoint="/metrics")

    # ── Routers ───────────────────────────────────────────────────────────────
    _register_routers(app)

    # Serve locally-stored catalog images in dev (S3 is used when configured).
    from libs.image_storage import MEDIA_ROOT

    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    from fastapi.staticfiles import StaticFiles

    app.mount("/media", StaticFiles(directory=str(MEDIA_ROOT)), name="media")

    return app


def _register_routers(app: FastAPI) -> None:
    from apps.api.modules.admin.router import router as admin_router
    from apps.api.modules.agent_network.router import router as agent_network_router
    from apps.api.modules.analytics.router import router as analytics_router
    from apps.api.modules.auth.router import router as auth_router
    from apps.api.modules.billing.router import router as billing_router
    from apps.api.modules.billing.webhooks import router as billing_webhook_router
    from apps.api.modules.business.router import router as business_router
    from apps.api.modules.chat.router import router as chat_router
    from apps.api.modules.credit.router import router as credit_router
    from apps.api.modules.expenses.router import router as expenses_router
    from apps.api.modules.inventory.router import router as inventory_router
    from apps.api.modules.invoicing.router import router as invoicing_router
    from apps.api.modules.kyc.router import router as kyc_router
    from apps.api.modules.notifications.router import router as notifications_router
    from apps.api.modules.payments.router import router as payments_router
    from apps.api.modules.payroll.router import router as payroll_router
    from apps.api.modules.sales.router import router as sales_router
    from apps.api.modules.tax.router import router as tax_router
    from apps.api.modules.ussd.router import router as ussd_router

    prefix = "/api/v1"
    app.include_router(auth_router, prefix=f"{prefix}/auth", tags=["Auth"])
    app.include_router(business_router, prefix=f"{prefix}/business", tags=["Business"])
    app.include_router(inventory_router, prefix=f"{prefix}/inventory", tags=["Inventory"])
    from apps.api.modules.inventory.supplier_router import router as supplier_router

    app.include_router(supplier_router, prefix=f"{prefix}/inventory", tags=["Suppliers & POs"])
    app.include_router(sales_router, prefix=f"{prefix}/sales", tags=["Sales"])
    app.include_router(invoicing_router, prefix=f"{prefix}/invoices", tags=["Invoicing"])
    app.include_router(payments_router, prefix=f"{prefix}/payments", tags=["Payments"])
    app.include_router(kyc_router, prefix=f"{prefix}/kyc", tags=["KYC"])
    app.include_router(payroll_router, prefix=f"{prefix}/payroll", tags=["Payroll"])
    app.include_router(tax_router, prefix=f"{prefix}/tax", tags=["Tax"])
    from apps.api.modules.tax.input_vat import router as input_vat_router
    from apps.api.modules.tax.rate_config import router as tax_rate_router

    app.include_router(input_vat_router, prefix=f"{prefix}/tax", tags=["Tax"])
    app.include_router(tax_rate_router, prefix=f"{prefix}/tax", tags=["Tax"])
    app.include_router(credit_router, prefix=f"{prefix}/credit", tags=["Credit"])
    app.include_router(expenses_router, prefix=f"{prefix}/expenses", tags=["Expenses"])
    app.include_router(analytics_router, prefix=f"{prefix}/analytics", tags=["Analytics"])
    app.include_router(chat_router, prefix=f"{prefix}/chat", tags=["Chat"])
    app.include_router(
        notifications_router, prefix=f"{prefix}/notifications", tags=["Notifications"]
    )
    app.include_router(billing_router, prefix=f"{prefix}/billing", tags=["Billing"])
    app.include_router(
        billing_webhook_router, prefix=f"{prefix}/webhooks/billing", tags=["Billing Webhooks"]
    )
    app.include_router(admin_router, prefix=f"{prefix}/admin", tags=["Admin"])
    from apps.api.modules.storefront.router import router as storefront_router

    app.include_router(storefront_router, prefix=f"{prefix}/public", tags=["Public Storefront"])
    app.include_router(ussd_router, prefix=f"{prefix}/ussd", tags=["USSD"])
    app.include_router(agent_network_router, prefix=f"{prefix}/agents", tags=["Agent Network"])

    from apps.api.modules.lender.router import router as lender_router
    from apps.api.modules.referral.router import router as referral_router

    app.include_router(referral_router, prefix=f"{prefix}/referrals", tags=["Referrals"])
    app.include_router(lender_router, prefix=f"{prefix}/lender", tags=["Lender Partner"])

    # ── Merchant settlements ──────────────────────────────────────────────────
    from apps.api.modules.settlements.admin_router import router as settlements_admin_router
    from apps.api.modules.settlements.router import router as settlements_router

    app.include_router(
        settlements_router,
        prefix=f"{prefix}/settlements",
        tags=["Merchant Settlements"],
    )
    app.include_router(
        settlements_admin_router,
        prefix=f"{prefix}/admin/settlements",
        tags=["Merchant Settlements — Admin"],
    )

    # ── Payout system ─────────────────────────────────────────────────────────
    from apps.api.modules.payouts.router import admin_router as payout_admin_router
    from apps.api.modules.payouts.router import agent_router as payout_agent_router
    from apps.api.modules.payouts.webhooks import router as payout_webhook_router

    app.include_router(
        payout_admin_router,
        prefix=f"{prefix}/admin/payouts",
        tags=["Payouts — Admin"],
    )
    app.include_router(
        payout_agent_router,
        prefix=f"{prefix}/agents",
        tags=["Payouts — Agent Wallet"],
    )
    app.include_router(
        payout_webhook_router,
        prefix=f"{prefix}/webhooks/payouts",
        tags=["Payout Webhooks"],
    )

    # ── System endpoints ──────────────────────────────────────────────────────
    @app.get("/health", tags=["System"])
    async def health() -> dict:
        from apps.api.core.circuit_breaker import circuit_state

        return {"status": "ok", "env": settings.APP_ENV, "circuits": await circuit_state()}

    @app.get("/ready", tags=["System"])
    async def readiness() -> JSONResponse:
        db_ok = await check_db_connection()
        redis_ok = await check_redis_connection()
        schema = (
            await check_required_schema_tables()
            if db_ok
            else {"ok": False, "missing_tables": ["unknown"]}
        )
        ready = db_ok and redis_ok and bool(schema["ok"])
        status = "ready" if ready else "degraded"
        return JSONResponse(
            status_code=200 if ready else 503,
            content={"status": status, "db": db_ok, "redis": redis_ok, "schema": schema},
        )


app = create_app()
