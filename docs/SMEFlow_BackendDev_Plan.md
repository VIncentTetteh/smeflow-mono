# SME Flow — FastAPI Backend: End-to-End Development Plan

> **Author:** Staff Software Engineer  
> **Stack:** Python 3.12 · FastAPI · PostgreSQL · Redis · Celery · RabbitMQ · Docker / Kubernetes  
> **Currency:** GHS (Ghana Cedis)  
> **Date:** 2026-05-01

---

## Table of Contents

1. [Engineering Philosophy & Guiding Principles](#1-engineering-philosophy--guiding-principles)
2. [Repository & Project Structure](#2-repository--project-structure)
3. [Infrastructure & DevOps Foundation](#3-infrastructure--devops-foundation)
4. [Database Design & Schema](#4-database-design--schema)
5. [Core Framework Setup](#5-core-framework-setup)
6. [Phase 0 — Foundation (Weeks 1–2)](#6-phase-0--foundation-weeks-12)
7. [Phase 1 — MVP (Weeks 3–10)](#7-phase-1--mvp-weeks-310)
8. [Phase 2 — Expanded Features (Weeks 11–20)](#8-phase-2--expanded-features-weeks-1120)
9. [Phase 3 — Scale & Premium (Weeks 21–32)](#9-phase-3--scale--premium-weeks-2132)
10. [Cross-Cutting Concerns](#10-cross-cutting-concerns)
11. [Testing Strategy](#11-testing-strategy)
12. [Deployment & CI/CD](#12-deployment--cicd)
13. [Observability Stack](#13-observability-stack)
14. [Risk Register & Mitigations](#14-risk-register--mitigations)
15. [Team & Timeline Summary](#15-team--timeline-summary)

---

## 1. Engineering Philosophy & Guiding Principles

### 1.1 Core Tenets

**Idempotency everywhere.** Every mutation endpoint accepts an `Idempotency-Key` header. Payment flows, invoice generation, and stock adjustments are all safe to retry without double-processing. Implement via Redis key-locking with a 24-hour TTL.

**Saga pattern for distributed transactions.** A single "record sale" action spans: inventory deduction → invoice creation → MoMo payment request → tax accrual → credit score update. Each step is a compensatable local transaction orchestrated via a command bus (not a 2PC). If step 4 fails, compensating handlers roll back steps 1–3.

**Async-first, sync-optional.** All I/O-heavy operations (payment callbacks, chat parsing, PDF generation, tax filing) are pushed to Celery queues. FastAPI endpoints respond in <200 ms; background workers handle the rest.

**Offline-first contract.** The API is designed to accept batched, out-of-order payloads from mobile clients. Every resource has a `client_created_at` field alongside server `created_at`. Conflict resolution: last-writer-wins on non-financial fields; financial records are append-only.

**Multi-tenancy by design.** Every table has a `business_id` UUID foreign key. All queries are scoped through a `TenantMiddleware` that injects `business_id` from the JWT claim. No cross-tenant data leaks are possible at the ORM layer.

**Compliance-first.** GRA e-VAT invoicing fields are non-nullable on the `Invoice` model. The audit log is append-only and write-protected at the DB level (no UPDATE/DELETE privileges for the app DB user).

---

## 2. Repository & Project Structure

### 2.1 Monorepo Layout

```
smeflow/
├── apps/
│   ├── api/                        # Main FastAPI application
│   │   ├── main.py
│   │   ├── core/
│   │   │   ├── config.py           # Pydantic Settings (env-driven)
│   │   │   ├── database.py         # SQLAlchemy async engine + session
│   │   │   ├── redis.py            # Redis connection pool
│   │   │   ├── security.py         # JWT, OTP, hashing
│   │   │   ├── exceptions.py       # Global exception handlers
│   │   │   ├── middleware.py       # Tenant, rate-limit, logging middleware
│   │   │   └── dependencies.py     # FastAPI Depends() factories
│   │   ├── modules/
│   │   │   ├── auth/               # OTP, JWT, sessions
│   │   │   ├── business/           # Business profile, settings
│   │   │   ├── inventory/          # Items, stock transactions
│   │   │   ├── sales/              # Sales, sale items, receivables
│   │   │   ├── invoicing/          # Invoice generation, QR, e-VAT
│   │   │   ├── payments/           # MoMo, GhQR, reconciliation
│   │   │   ├── payroll/            # Employees, runs, payslips
│   │   │   ├── tax/                # Returns, summaries, filing
│   │   │   ├── credit/             # Scoring engine, loan requests
│   │   │   ├── analytics/          # Reports, dashboards
│   │   │   ├── chat/               # Chat processor, intent parser
│   │   │   ├── ussd/               # USSD session gateway
│   │   │   ├── notifications/      # WhatsApp, SMS, push
│   │   │   ├── billing/            # Subscriptions, usage limits
│   │   │   └── admin/              # Internal admin endpoints
│   │   ├── workers/
│   │   │   ├── celery_app.py       # Celery factory
│   │   │   ├── tasks/              # Task definitions per module
│   │   │   └── beat_schedule.py    # Periodic tasks
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── e2e/
│   └── scripts/                    # DB seed, migration helpers
├── libs/
│   ├── shared_types/               # Pydantic schemas shared across modules
│   ├── event_bus/                  # In-process event dispatcher
│   ├── payment_clients/            # MTN, Vodafone, AirtelTigo adapters
│   ├── qr_generator/               # GhQR + receipt QR logic
│   ├── pdf_generator/              # ReportLab/WeasyPrint receipts
│   └── gra_client/                 # GRA API stub / adapter
├── infra/
│   ├── docker/
│   ├── k8s/
│   ├── terraform/
│   └── monitoring/
├── migrations/                     # Alembic
├── .env.example
├── pyproject.toml                  # uv / poetry workspace
├── Makefile
└── openapi/                        # OpenAPI spec (spec-first approach)
    └── v1.yaml
```

### 2.2 Module Structure (per module)

Each module is a self-contained vertical slice:

```
modules/sales/
├── __init__.py
├── router.py           # FastAPI APIRouter
├── schemas.py          # Pydantic request/response models
├── models.py           # SQLAlchemy ORM models
├── service.py          # Business logic (pure Python, no HTTP)
├── repository.py       # DB queries (async SQLAlchemy)
├── events.py           # Domain events emitted by this module
├── handlers.py         # Handles events from other modules
├── tasks.py            # Celery tasks specific to this module
└── tests/
```

---

## 3. Infrastructure & DevOps Foundation

### 3.1 Core Services

| Service | Technology | Purpose |
|---|---|---|
| API Server | FastAPI + Uvicorn/Gunicorn | HTTP API, WebSocket (optional) |
| Database | PostgreSQL 16 + TimescaleDB | Relational + time-series data |
| Cache / Sessions | Redis 7 | Sessions, OTP, idempotency keys, USSD sessions |
| Task Queue | Celery 5 + RabbitMQ | Async jobs, background processing |
| Object Storage | AWS S3 / GCS | PDFs, QR images, exports |
| Secrets | AWS Secrets Manager / Vault | API keys, DB credentials |
| CDN | CloudFront / Cloudflare | Static assets, cached reports |
| Search | PostgreSQL FTS (pg_trgm) | Inventory search (upgrade to OpenSearch if needed) |

### 3.2 Docker Compose (Development)

```yaml
# docker-compose.yml (abbreviated)
services:
  api:
    build: ./apps/api
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql+asyncpg://smeflow:smeflow@db:5432/smeflow
      REDIS_URL: redis://redis:6379/0
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672/
    depends_on: [db, redis, rabbitmq]

  worker:
    build: ./apps/api
    command: celery -A workers.celery_app worker -Q default,payments,credit -c 4
    depends_on: [rabbitmq, db, redis]

  beat:
    build: ./apps/api
    command: celery -A workers.celery_app beat --scheduler redbeat.RedBeatScheduler
    depends_on: [redis]

  db:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_PASSWORD: smeflow
      POSTGRES_DB: smeflow

  redis:
    image: redis:7-alpine

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports: ["15672:15672"]
```

### 3.3 Environment Configuration (Pydantic Settings)

```python
# core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Application
    APP_ENV: str = "development"
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    OTP_EXPIRE_SECONDS: int = 300

    # Database
    DATABASE_URL: str
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 40

    # Redis
    REDIS_URL: str
    OTP_REDIS_DB: int = 1
    SESSION_REDIS_DB: int = 2

    # Celery / RabbitMQ
    RABBITMQ_URL: str
    CELERY_RESULT_BACKEND: str

    # Payment Providers
    MTN_MOMO_BASE_URL: str
    MTN_MOMO_API_KEY: str
    MTN_MOMO_SUBSCRIPTION_KEY: str
    MTN_MOMO_TARGET_ENV: str = "production"
    VODAFONE_CASH_BASE_URL: str
    VODAFONE_CASH_API_KEY: str
    AIRTELTIGO_BASE_URL: str
    AIRTELTIGO_API_KEY: str

    # WhatsApp
    WHATSAPP_ACCESS_TOKEN: str
    WHATSAPP_PHONE_NUMBER_ID: str
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: str

    # GRA
    GRA_API_BASE_URL: str = "https://api.gra.gov.gh/v1"
    GRA_API_KEY: str = ""

    # AWS
    AWS_S3_BUCKET: str
    AWS_REGION: str = "af-south-1"

    # Billing limits (freemium)
    FREE_TIER_MONTHLY_SALES: int = 500
    FREE_TIER_ITEMS: int = 100

    # Feature flags
    ENABLE_CREDIT_SCORING: bool = True
    ENABLE_GRA_DIRECT_FILING: bool = False  # until GRA API is live

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

---

## 4. Database Design & Schema

### 4.1 Foundational Principles

- All PKs are `UUID` (v7 — sortable by time, avoiding index fragmentation).
- All financial amounts are stored as `NUMERIC(15,2)` (never float).
- All timestamps are `TIMESTAMPTZ` stored in UTC; app converts to `Africa/Accra` (GMT+0, no DST) for display.
- `business_id` FK is on every table except `users` and `businesses` themselves.
- Soft deletes via `deleted_at TIMESTAMPTZ NULL` on mutable entities; hard enforcement at ORM layer.
- Audit log is a separate, insert-only table with DB-level trigger protection.

### 4.2 Core Schema Definitions

```sql
-- ===================== EXTENSIONS =====================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- ===================== USERS & BUSINESSES =====================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(15) UNIQUE NOT NULL,     -- E.164 format +233...
    name            VARCHAR(255),
    ghana_card_id   VARCHAR(50) UNIQUE,              -- GHA-XXXXXXXXX-X
    tin             VARCHAR(20) UNIQUE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE businesses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id),
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(50) NOT NULL,            -- 'market_stall','shop','artisan' etc.
    tin             VARCHAR(20),
    ghana_card_ref  VARCHAR(50),
    address         TEXT,
    location_lat    NUMERIC(9,6),
    location_lng    NUMERIC(9,6),
    subscription    VARCHAR(20) DEFAULT 'free',      -- 'free','starter','pro','enterprise'
    sub_expires_at  TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE business_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    role            VARCHAR(30) NOT NULL,            -- 'owner','manager','staff','agent'
    is_active       BOOLEAN DEFAULT TRUE,
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (business_id, user_id)
);

CREATE TABLE momo_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    provider        VARCHAR(20) NOT NULL,            -- 'mtn','vodafone','airteltigo'
    phone           VARCHAR(15) NOT NULL,
    account_name    VARCHAR(255),
    is_primary      BOOLEAN DEFAULT FALSE,
    is_verified     BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===================== INVENTORY =====================
CREATE TABLE item_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    name            VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    category_id     UUID REFERENCES item_categories(id),
    name            VARCHAR(255) NOT NULL,
    sku             VARCHAR(100),
    unit            VARCHAR(30) NOT NULL,            -- 'piece','kg','litre','box','bag'
    cost_price      NUMERIC(15,2) NOT NULL DEFAULT 0,
    sell_price      NUMERIC(15,2) NOT NULL,
    current_stock   NUMERIC(15,3) DEFAULT 0,
    low_stock_threshold NUMERIC(15,3) DEFAULT 5,
    barcode         VARCHAR(100),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    UNIQUE (business_id, sku)
);
CREATE INDEX idx_items_business ON items(business_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_name_trgm ON items USING GIN(name gin_trgm_ops);

CREATE TABLE stock_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    item_id         UUID NOT NULL REFERENCES items(id),
    type            VARCHAR(20) NOT NULL,            -- 'purchase','sale','damage','adjustment','transfer'
    qty_change      NUMERIC(15,3) NOT NULL,          -- +/- 
    qty_before      NUMERIC(15,3) NOT NULL,
    qty_after       NUMERIC(15,3) NOT NULL,
    unit_cost       NUMERIC(15,2),
    reference_id    UUID,                            -- sale_id or purchase_id
    reference_type  VARCHAR(30),
    notes           TEXT,
    recorded_by     UUID REFERENCES users(id),
    client_created_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Convert to TimescaleDB hypertable for time-series queries
SELECT create_hypertable('stock_transactions', 'created_at');

-- ===================== SALES =====================
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    name            VARCHAR(255),
    phone           VARCHAR(15),
    tin             VARCHAR(20),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sales (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    customer_id     UUID REFERENCES customers(id),
    recorded_by     UUID REFERENCES users(id),
    status          VARCHAR(20) DEFAULT 'completed',  -- 'completed','partial','credit','voided'
    payment_method  VARCHAR(20) NOT NULL,             -- 'cash','momo','credit','mixed'
    subtotal        NUMERIC(15,2) NOT NULL,
    tax_amount      NUMERIC(15,2) DEFAULT 0,
    discount_amount NUMERIC(15,2) DEFAULT 0,
    total           NUMERIC(15,2) NOT NULL,
    amount_paid     NUMERIC(15,2) DEFAULT 0,
    balance_due     NUMERIC(15,2) DEFAULT 0,
    notes           TEXT,
    idempotency_key VARCHAR(100) UNIQUE,
    client_created_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
SELECT create_hypertable('sales', 'created_at');
CREATE INDEX idx_sales_business_date ON sales(business_id, created_at DESC);

CREATE TABLE sale_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id         UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    item_id         UUID REFERENCES items(id),
    description     VARCHAR(255) NOT NULL,           -- snapshot at time of sale
    qty             NUMERIC(15,3) NOT NULL,
    unit_price      NUMERIC(15,2) NOT NULL,
    discount        NUMERIC(15,2) DEFAULT 0,
    line_total      NUMERIC(15,2) NOT NULL,
    vat_rate        NUMERIC(5,2) DEFAULT 0,          -- percentage e.g. 15.00
    vat_amount      NUMERIC(15,2) DEFAULT 0
);

CREATE TABLE receivables (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    sale_id         UUID REFERENCES sales(id),
    customer_id     UUID REFERENCES customers(id),
    amount          NUMERIC(15,2) NOT NULL,
    amount_paid     NUMERIC(15,2) DEFAULT 0,
    status          VARCHAR(20) DEFAULT 'outstanding', -- 'outstanding','partial','settled','written_off'
    due_date        DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===================== INVOICING =====================
CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    sale_id         UUID REFERENCES sales(id),
    invoice_number  VARCHAR(50) NOT NULL,
    type            VARCHAR(20) DEFAULT 'invoice',    -- 'invoice','receipt','credit_note','debit_note'
    status          VARCHAR(20) DEFAULT 'issued',     -- 'draft','issued','paid','cancelled'

    -- Supplier (business) fields - GRA required
    supplier_tin    VARCHAR(20),
    supplier_name   VARCHAR(255) NOT NULL,
    supplier_address TEXT,

    -- Customer fields
    customer_tin    VARCHAR(20),
    customer_name   VARCHAR(255),
    customer_address TEXT,

    -- Amounts - GRA required breakdown
    subtotal        NUMERIC(15,2) NOT NULL,
    vat_amount      NUMERIC(15,2) DEFAULT 0,         -- 15%
    nhil_amount     NUMERIC(15,2) DEFAULT 0,         -- 2.5%
    getfund_amount  NUMERIC(15,2) DEFAULT 0,         -- 2.5%
    covid_levy      NUMERIC(15,2) DEFAULT 0,         -- 1%
    total           NUMERIC(15,2) NOT NULL,

    -- GRA e-VAT compliance
    qr_payload      TEXT,                            -- QR-encoded verification data
    qr_image_url    TEXT,                            -- S3 URL
    digital_signature TEXT,
    verification_id VARCHAR(100) UNIQUE,
    gra_submission_id VARCHAR(100),
    gra_submitted_at TIMESTAMPTZ,

    -- GhQR payment
    ghqr_payload    TEXT,                            -- GhQR dynamic QR
    ghqr_image_url  TEXT,

    -- PDF
    pdf_url         TEXT,

    issued_at       TIMESTAMPTZ DEFAULT NOW(),
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (business_id, invoice_number)
);

CREATE TABLE invoice_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description     VARCHAR(255) NOT NULL,
    qty             NUMERIC(15,3) NOT NULL,
    unit            VARCHAR(30),
    unit_price      NUMERIC(15,2) NOT NULL,
    line_total      NUMERIC(15,2) NOT NULL,
    vat_rate        NUMERIC(5,2) DEFAULT 0,
    vat_amount      NUMERIC(15,2) DEFAULT 0
);

-- ===================== PAYMENTS =====================
CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    invoice_id      UUID REFERENCES invoices(id),
    sale_id         UUID REFERENCES sales(id),
    type            VARCHAR(20) NOT NULL,             -- 'collection','disbursement'
    provider        VARCHAR(20) NOT NULL,             -- 'mtn','vodafone','airteltigo','cash','ghqr'
    amount          NUMERIC(15,2) NOT NULL,
    currency        CHAR(3) DEFAULT 'GHS',
    phone           VARCHAR(15),
    external_ref    VARCHAR(255),                     -- provider transaction ID
    internal_ref    VARCHAR(100),
    status          VARCHAR(20) DEFAULT 'pending',    -- 'pending','success','failed','reversed'
    provider_status VARCHAR(50),
    provider_message TEXT,
    metadata        JSONB DEFAULT '{}',
    idempotency_key VARCHAR(100) UNIQUE,
    initiated_at    TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===================== PAYROLL =====================
CREATE TABLE employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    user_id         UUID REFERENCES users(id),
    name            VARCHAR(255) NOT NULL,
    phone           VARCHAR(15),
    role            VARCHAR(100),
    pay_type        VARCHAR(20) DEFAULT 'monthly',    -- 'daily','weekly','monthly','piece'
    base_pay        NUMERIC(15,2) NOT NULL,
    momo_phone      VARCHAR(15),
    momo_provider   VARCHAR(20),
    is_active       BOOLEAN DEFAULT TRUE,
    joined_at       DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payroll_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    status          VARCHAR(20) DEFAULT 'draft',      -- 'draft','processing','completed','failed'
    total_gross     NUMERIC(15,2) DEFAULT 0,
    total_deductions NUMERIC(15,2) DEFAULT 0,
    total_net       NUMERIC(15,2) DEFAULT 0,
    run_by          UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE TABLE payslips (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id  UUID NOT NULL REFERENCES payroll_runs(id),
    employee_id     UUID NOT NULL REFERENCES employees(id),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    gross_pay       NUMERIC(15,2) NOT NULL,
    ssnit_employee  NUMERIC(15,2) DEFAULT 0,
    income_tax      NUMERIC(15,2) DEFAULT 0,
    other_deductions NUMERIC(15,2) DEFAULT 0,
    net_pay         NUMERIC(15,2) NOT NULL,
    payment_id      UUID REFERENCES payments(id),
    pdf_url         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===================== TAX =====================
CREATE TABLE tax_returns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    period_type     VARCHAR(20) NOT NULL,             -- 'monthly','quarterly','annual'
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    vat_output      NUMERIC(15,2) DEFAULT 0,
    vat_input       NUMERIC(15,2) DEFAULT 0,
    vat_payable     NUMERIC(15,2) DEFAULT 0,
    nhil_amount     NUMERIC(15,2) DEFAULT 0,
    getfund_amount  NUMERIC(15,2) DEFAULT 0,
    covid_levy      NUMERIC(15,2) DEFAULT 0,
    total_tax       NUMERIC(15,2) DEFAULT 0,
    status          VARCHAR(20) DEFAULT 'draft',      -- 'draft','submitted','accepted','rejected'
    gra_ref         VARCHAR(100),
    submitted_at    TIMESTAMPTZ,
    payload_json    JSONB,                            -- full GRA-compatible payload snapshot
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===================== CREDIT =====================
CREATE TABLE credit_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    score           NUMERIC(5,2) NOT NULL,            -- 0-100
    band            VARCHAR(10) NOT NULL,             -- 'A','B','C','D','E'
    max_loan_amount NUMERIC(15,2),
    computed_at     TIMESTAMPTZ DEFAULT NOW(),
    factors         JSONB DEFAULT '{}'                -- breakdown for audit/display
);
SELECT create_hypertable('credit_scores', 'computed_at');

CREATE TABLE loan_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id),
    credit_score_id UUID REFERENCES credit_scores(id),
    amount_requested NUMERIC(15,2) NOT NULL,
    amount_approved NUMERIC(15,2),
    term_days       INT,
    interest_rate   NUMERIC(5,2),
    status          VARCHAR(30) DEFAULT 'pending',   -- 'pending','under_review','approved','rejected','disbursed','repaid'
    partner_ref     VARCHAR(100),                    -- lender's reference
    requested_at    TIMESTAMPTZ DEFAULT NOW(),
    decided_at      TIMESTAMPTZ,
    disbursed_at    TIMESTAMPTZ
);

-- ===================== AUDIT LOG =====================
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID,
    user_id         UUID,
    action          VARCHAR(100) NOT NULL,            -- 'sale.create','invoice.void' etc.
    resource_type   VARCHAR(50) NOT NULL,
    resource_id     UUID,
    before_state    JSONB,
    after_state     JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Protect audit log from modification
REVOKE UPDATE, DELETE ON audit_logs FROM smeflow_app;
SELECT create_hypertable('audit_logs', 'created_at');
```

### 4.3 Alembic Migration Strategy

```
migrations/
├── env.py              # Async Alembic env with asyncpg
├── script.py.mako
└── versions/
    ├── 0001_initial_schema.py
    ├── 0002_timescale_hypertables.py
    ├── 0003_add_ghqr_fields.py
    └── ...
```

Run migrations: `alembic upgrade head`
Rollback: `alembic downgrade -1`
Always generate: `alembic revision --autogenerate -m "description"`

---

## 5. Core Framework Setup

### 5.1 FastAPI Application Factory

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from core.database import db_engine
from core.redis import redis_pool
from core.middleware import TenantMiddleware, RateLimitMiddleware, AuditMiddleware
from core.exceptions import register_exception_handlers

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_engine.connect()
    await redis_pool.initialize()
    yield
    # Shutdown
    await db_engine.dispose()
    await redis_pool.close()

def create_app() -> FastAPI:
    app = FastAPI(
        title="SME Flow API",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # Middleware (order matters — outermost first)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"])
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(TenantMiddleware)
    app.add_middleware(AuditMiddleware)

    register_exception_handlers(app)

    # Register routers
    from modules.auth.router import router as auth_router
    from modules.business.router import router as business_router
    # ... all modules
    app.include_router(auth_router, prefix="/api/v1/auth", tags=["Auth"])
    app.include_router(business_router, prefix="/api/v1/business", tags=["Business"])
    # ...

    return app

app = create_app()
```

### 5.2 Async Database Layer

```python
# core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from core.config import get_settings

settings = get_settings()

db_engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    pool_pre_ping=True,
    echo=settings.APP_ENV == "development",
)

AsyncSessionLocal = async_sessionmaker(
    db_engine, class_=AsyncSession, expire_on_commit=False
)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

### 5.3 Tenant Middleware

```python
# core/middleware.py
from fastapi import Request
from jose import jwt, JWTError
from core.config import get_settings

class TenantMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            request = Request(scope)
            token = request.headers.get("Authorization", "").replace("Bearer ", "")
            if token:
                try:
                    payload = jwt.decode(token, get_settings().SECRET_KEY, algorithms=["HS256"])
                    scope["state"] = scope.get("state", {})
                    scope["state"]["business_id"] = payload.get("business_id")
                    scope["state"]["user_id"] = payload.get("sub")
                    scope["state"]["role"] = payload.get("role")
                except JWTError:
                    pass
        await self.app(scope, receive, send)
```

### 5.4 Idempotency Decorator

```python
# core/idempotency.py
import hashlib, json
from fastapi import Request, Response
from core.redis import get_redis

def idempotent(expire_seconds: int = 86400):
    def decorator(func):
        async def wrapper(request: Request, *args, **kwargs):
            key = request.headers.get("Idempotency-Key")
            if not key:
                return await func(request, *args, **kwargs)
            redis = await get_redis()
            cache_key = f"idempotency:{key}"
            cached = await redis.get(cache_key)
            if cached:
                return Response(content=cached, media_type="application/json", status_code=200)
            response = await func(request, *args, **kwargs)
            await redis.setex(cache_key, expire_seconds, response.body)
            return response
        return wrapper
    return decorator
```

---

## 6. Phase 0 — Foundation (Weeks 1–2)

### Goals
Set up the development environment, CI/CD skeleton, database, and core security primitives. No business features yet — just the scaffolding.

### Tasks

**Week 1:**
- [ ] Initialize monorepo with `uv` workspace + `pyproject.toml` (Python 3.12)
- [ ] Set up `pre-commit` hooks: `ruff`, `mypy`, `bandit`, `pytest`
- [ ] Implement `core/` package: config, database, redis, security, exceptions, middleware
- [ ] Alembic setup with async engine; first migration (users + businesses)
- [ ] GitHub Actions CI: lint → type-check → test → docker-build on every PR
- [ ] Docker Compose for local dev (API + DB + Redis + RabbitMQ)
- [ ] Implement JWT issuance + validation (`python-jose`)
- [ ] Implement OTP flow: generate 6-digit OTP → store in Redis (TTL 5 min) → verify

**Week 2:**
- [ ] `POST /api/v1/auth/otp/request` — Rate-limited (3 req/min per phone, AfricasTalking/Twilio SMS)
- [ ] `POST /api/v1/auth/otp/verify` — Returns `{access_token, refresh_token, business_id?}`
- [ ] `POST /api/v1/auth/refresh` — Refresh token rotation
- [ ] `POST /api/v1/auth/logout` — Invalidate refresh token in Redis
- [ ] `POST /api/v1/business/create` — Multi-step: profile → MoMo linking
- [ ] `GET /api/v1/business/me` — Current business profile
- [ ] `PATCH /api/v1/business/me` — Update profile (TIN, address, etc.)
- [ ] `POST /api/v1/business/members/invite` — Invite staff via phone
- [ ] RBAC dependency factory: `require_role("owner", "manager")` etc.
- [ ] OpenAPI spec (`openapi/v1.yaml`) — spec-first contract for all Phase 1 endpoints

**Deliverables:** Working auth, business onboarding, CI pipeline, Docker stack.

---

## 7. Phase 1 — MVP (Weeks 3–10)

### 7.1 Module: Inventory (Week 3)

```python
# modules/inventory/schemas.py (key schemas)
class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    unit: str
    cost_price: Decimal = Field(ge=0, decimal_places=2)
    sell_price: Decimal = Field(gt=0, decimal_places=2)
    initial_stock: Decimal = Field(ge=0, default=0)
    low_stock_threshold: Decimal = Field(ge=0, default=5)
    category_id: UUID | None = None
    sku: str | None = None

class StockAdjustment(BaseModel):
    item_id: UUID
    qty_change: Decimal        # positive = restock, negative = damage/loss
    reason: Literal["purchase","damage","adjustment","transfer"]
    notes: str | None = None
    client_created_at: datetime | None = None
```

**Endpoints:**
- `POST /api/v1/inventory/items` — Create item
- `GET /api/v1/inventory/items` — List with search (pg_trgm), `low_stock=true` filter, pagination
- `GET /api/v1/inventory/items/:id` — Item detail + stock history
- `PATCH /api/v1/inventory/items/:id` — Update item
- `DELETE /api/v1/inventory/items/:id` — Soft delete
- `POST /api/v1/inventory/adjust` — Manual stock adjustment (creates StockTransaction)
- `GET /api/v1/inventory/categories` — List categories
- `POST /api/v1/inventory/categories` — Create category
- `POST /api/v1/inventory/items/bulk` — Bulk import via CSV/JSON (async via Celery)

**Background Jobs:**
- `check_low_stock` — runs after every stock transaction; emits `LowStockEvent` if threshold breached

### 7.2 Module: Sales (Weeks 3–4)

```python
# Sale recording — the most critical flow
class SaleCreate(BaseModel):
    items: list[SaleItemInput]
    payment_method: Literal["cash","momo","credit","mixed"]
    customer_phone: str | None = None
    customer_name: str | None = None
    discount_amount: Decimal = Decimal("0.00")
    notes: str | None = None
    idempotency_key: str        # REQUIRED — client-generated UUID
    client_created_at: datetime | None = None

class SaleItemInput(BaseModel):
    item_id: UUID | None = None  # None = ad-hoc item (description only)
    description: str | None = None
    qty: Decimal = Field(gt=0)
    unit_price: Decimal = Field(gt=0)
```

**Sale Recording Flow (Saga):**
```
POST /api/v1/sales/record
  1. Check idempotency key (Redis) → return cached if exists
  2. Validate all item_ids belong to business (tenant check)
  3. Check stock availability for each item
  4. BEGIN TRANSACTION:
     a. Create Sale record
     b. Create SaleItem records
     c. Deduct stock → insert StockTransaction per item (atomic)
     d. If payment_method == 'credit': create Receivable
  5. COMMIT
  6. Set idempotency cache (24h)
  7. Emit SaleCreatedEvent → async handlers:
     - Generate invoice (InvoicingModule)
     - Trigger MoMo request if payment_method == 'momo'
     - Update tax accrual
     - Queue credit score recalc
  8. Return {sale_id, invoice_id, qr_url, payment_request_id?}
```

**Endpoints:**
- `POST /api/v1/sales/record`
- `GET /api/v1/sales` — List with date range, status, method filters
- `GET /api/v1/sales/:id` — Full sale detail with items
- `POST /api/v1/sales/:id/void` — Void sale (compensating: restore stock, cancel invoice)
- `POST /api/v1/sales/:id/pay` — Record payment against credit sale
- `GET /api/v1/sales/summary/daily` — Daily totals
- `GET /api/v1/sales/summary/period` — Period summary (cash, MoMo, credit breakdown)

### 7.3 Module: Invoicing (Weeks 4–5)

**GRA e-VAT Compliance Implementation:**

```python
# modules/invoicing/service.py
class InvoicingService:
    async def generate_invoice(self, sale: Sale, business: Business) -> Invoice:
        # 1. Compute tax breakdown (GRA rules)
        subtotal = sum(item.line_total for item in sale.items)
        vat = round(subtotal * Decimal("0.15"), 2)       # 15% VAT
        nhil = round(subtotal * Decimal("0.025"), 2)     # 2.5% NHIL
        getfund = round(subtotal * Decimal("0.025"), 2)  # 2.5% GETFund
        covid = round(subtotal * Decimal("0.01"), 2)     # 1% COVID levy
        total = subtotal + vat + nhil + getfund + covid

        # 2. Generate verification ID and QR payload
        verification_id = self._generate_verification_id(business, sale)
        qr_payload = self._build_gra_qr_payload(business, sale, verification_id, total)
        digital_signature = self._sign_payload(qr_payload)

        # 3. Generate invoice number (sequential per business)
        invoice_number = await self._next_invoice_number(business.id)

        # 4. Create invoice record
        invoice = Invoice(
            business_id=business.id,
            sale_id=sale.id,
            invoice_number=invoice_number,
            supplier_tin=business.tin,
            supplier_name=business.name,
            subtotal=subtotal,
            vat_amount=vat,
            nhil_amount=nhil,
            getfund_amount=getfund,
            covid_levy=covid,
            total=total,
            qr_payload=qr_payload,
            digital_signature=digital_signature,
            verification_id=verification_id,
        )

        # 5. Async tasks: QR image generation + PDF + GhQR
        await tasks.generate_invoice_assets.delay(invoice.id)

        return invoice

    def _build_gra_qr_payload(self, business, sale, verification_id, total) -> str:
        data = {
            "tin": business.tin,
            "vno": verification_id,
            "date": sale.created_at.isoformat(),
            "total": str(total),
            "vat": str(...),
        }
        return json.dumps(data, separators=(",",":"))
```

**Celery Task: Invoice Asset Generation**
```python
@celery.task(bind=True, max_retries=3)
def generate_invoice_assets(self, invoice_id: str):
    invoice = db.get(Invoice, invoice_id)
    # 1. Generate QR image (qrcode library) → upload to S3
    qr_img = generate_qr_image(invoice.qr_payload)
    qr_url = s3.upload(qr_img, f"invoices/{invoice_id}/qr.png")
    # 2. Generate GhQR dynamic QR for payment
    ghqr = generate_ghqr(invoice.business, invoice.total)
    ghqr_url = s3.upload(ghqr, f"invoices/{invoice_id}/ghqr.png")
    # 3. Generate PDF (ReportLab)
    pdf = build_invoice_pdf(invoice, qr_url, ghqr_url)
    pdf_url = s3.upload(pdf, f"invoices/{invoice_id}/invoice.pdf")
    # 4. Update invoice with URLs
    db.update(Invoice, invoice_id, qr_image_url=qr_url, ghqr_image_url=ghqr_url, pdf_url=pdf_url)
    # 5. Send PDF via WhatsApp to customer (if phone available)
    if invoice.sale.customer_phone:
        whatsapp.send_document(invoice.sale.customer_phone, pdf_url)
```

**Endpoints:**
- `POST /api/v1/invoices/generate` — Standalone invoice (not linked to sale)
- `GET /api/v1/invoices/:id` — Full invoice with QR + PDF URLs
- `GET /api/v1/invoices/:id/pdf` — Redirect to S3 PDF
- `POST /api/v1/invoices/:id/send` — Re-send via WhatsApp/SMS
- `POST /api/v1/invoices/:id/void` — Void + issue credit note
- `GET /api/v1/invoices` — List invoices with filters

### 7.4 Module: Payments (Weeks 5–7)

**Payment Provider Abstraction:**

```python
# libs/payment_clients/base.py
from abc import ABC, abstractmethod

class PaymentProvider(ABC):
    @abstractmethod
    async def request_payment(self, amount: Decimal, phone: str, reference: str, description: str) -> PaymentInitResponse:
        ...

    @abstractmethod
    async def check_status(self, external_ref: str) -> PaymentStatus:
        ...

    @abstractmethod
    async def disburse(self, amount: Decimal, phone: str, reference: str) -> DisbursementResponse:
        ...

    @abstractmethod
    def verify_webhook(self, payload: dict, signature: str) -> bool:
        ...
```

```python
# libs/payment_clients/mtn_momo.py
class MTNMoMoClient(PaymentProvider):
    """
    MTN Mobile Money Open API v1 implementation.
    Docs: https://momodeveloper.mtn.com/
    """
    def __init__(self, settings):
        self.base_url = settings.MTN_MOMO_BASE_URL
        self.api_key = settings.MTN_MOMO_API_KEY
        self.subscription_key = settings.MTN_MOMO_SUBSCRIPTION_KEY
        self._token_cache: str | None = None

    async def _get_token(self) -> str:
        # Bearer token from /token endpoint; cache in Redis (TTL = expires_in - 60s)
        ...

    async def request_payment(self, amount, phone, reference, description):
        token = await self._get_token()
        payload = {
            "amount": str(amount),
            "currency": "GHS",
            "externalId": reference,
            "payer": {"partyIdType": "MSISDN", "partyId": phone.lstrip("+")},
            "payerMessage": description,
            "payeeNote": description,
        }
        resp = await self._post("/collection/v1_0/requesttopay", payload, token)
        return PaymentInitResponse(external_ref=resp.headers["X-Reference-Id"], status="pending")

    async def check_status(self, external_ref: str) -> PaymentStatus:
        resp = await self._get(f"/collection/v1_0/requesttopay/{external_ref}")
        return PaymentStatus(status=resp.json()["status"])  # SUCCESSFUL|FAILED|PENDING
```

**Webhook Handler:**
```python
# modules/payments/router.py
@router.post("/webhooks/momo/callback", include_in_schema=False)
async def momo_callback(request: Request, db: AsyncSession = Depends(get_db)):
    # 1. Verify signature
    body = await request.body()
    sig = request.headers.get("X-Callback-Signature", "")
    if not mtn_client.verify_webhook(json.loads(body), sig):
        raise HTTPException(403, "Invalid webhook signature")

    # 2. Parse provider-specific payload → normalize to internal format
    event = normalize_momo_callback(json.loads(body))

    # 3. Update payment record
    payment = await payment_repo.get_by_external_ref(db, event.external_ref)
    if not payment:
        return {"status": "ignored"}  # idempotency

    await payment_repo.update_status(db, payment.id, event.status)

    # 4. Emit PaymentConfirmedEvent → async handlers
    if event.status == "success":
        await event_bus.emit(PaymentConfirmedEvent(payment_id=payment.id))

    return {"status": "received"}
```

**Event Handlers on PaymentConfirmedEvent:**
- Mark linked invoice as `paid`
- Mark linked receivable as `settled`
- Notify business owner (WhatsApp/SMS)
- Update credit score input data

**GhQR Integration:**
```python
# libs/qr_generator/ghqr.py
def generate_ghqr_payload(business: Business, amount: Decimal | None = None) -> str:
    """
    GhIPSS GhQR EMV standard (ISO 20022 compliant).
    Static QR = no amount. Dynamic QR = amount encoded.
    """
    qr_data = {
        "00": "01",                          # Payload Format Indicator
        "01": "12" if amount else "11",      # Point of Initiation (12=dynamic, 11=static)
        "26": {                              # Merchant Account Information
            "00": "GH.GHIPSS.GHQR",
            "01": business.ghqr_merchant_id,
        },
        "52": "5999",                        # Merchant Category Code (general retail)
        "53": "936",                         # Transaction Currency (GHS = 936)
        "54": str(amount) if amount else "", # Transaction Amount
        "58": "GH",                          # Country Code
        "59": business.name[:25],
        "60": "ACCRA",
    }
    raw = encode_tlv(qr_data)
    return raw + compute_crc16(raw)
```

### 7.5 Module: Chat Processor (Weeks 7–9)

**Architecture: Intent → Handler pipeline**

```python
# modules/chat/processor.py
class ChatProcessor:
    def __init__(self, intent_parser: IntentParser, handler_registry: HandlerRegistry):
        self.parser = intent_parser
        self.handlers = handler_registry

    async def process(self, session: ChatSession, message: str) -> ChatResponse:
        # 1. Parse intent
        intent = await self.parser.parse(message, session.context)

        # 2. Resolve handler
        handler = self.handlers.get(intent.type)
        if not handler:
            return ChatResponse(text="I didn't understand that. Type HELP for options.")

        # 3. Execute handler
        result = await handler.execute(intent, session)

        # 4. Update session context
        session.context = result.new_context
        await self.session_store.save(session)

        return result.response
```

**Intent Parser (Regex + LLM fallback):**

```python
# modules/chat/intent_parser.py
INTENT_PATTERNS = [
    # Sales
    (r"sold?\s+(\d+\.?\d*)\s+(.+?)\s+(?:at|@|for)?\s*(?:ghs?)?\s*(\d+\.?\d*)",
     Intent.RECORD_SALE),
    # Inventory
    (r"(?:bought?|purchased?|restocked?)\s+(\d+\.?\d*)\s+(.+?)\s+(?:at|@)?\s*(?:ghs?)?\s*(\d+\.?\d*)",
     Intent.RESTOCK_ITEM),
    (r"(?:add|create)\s+item\s+(.+)",
     Intent.CREATE_ITEM),
    # Stock checks
    (r"(?:stock|inventory|check)\s+(.+)",
     Intent.CHECK_STOCK),
    # Reports
    (r"(?:report|summary|sales?)\s+(?:today|this\s+week|this\s+month)?",
     Intent.GET_REPORT),
    # Balance / receivables
    (r"who\s+owes|receivables?|debtors?",
     Intent.LIST_RECEIVABLES),
    # Help
    (r"(?:help|menu|\?)",
     Intent.HELP),
]

class IntentParser:
    async def parse(self, message: str, context: dict) -> ParsedIntent:
        msg = message.lower().strip()
        for pattern, intent_type in INTENT_PATTERNS:
            m = re.search(pattern, msg, re.IGNORECASE)
            if m:
                return ParsedIntent(type=intent_type, groups=m.groups(), raw=message)

        # Fallback: LLM (Claude Haiku via Anthropic API — low cost)
        return await self._llm_parse(message, context)

    async def _llm_parse(self, message: str, context: dict) -> ParsedIntent:
        prompt = f"""
        SME business chat command parser. Extract the intent and entities.
        Business context: {json.dumps(context)}
        Message: "{message}"
        Respond in JSON: {{"intent": "...", "entities": {{...}}}}
        Valid intents: {[i.value for i in Intent]}
        """
        response = await anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        return ParsedIntent.from_llm_response(response.content[0].text)
```

**Key Intent Handlers:**

```python
class RecordSaleHandler:
    async def execute(self, intent: ParsedIntent, session: ChatSession) -> HandlerResult:
        qty, item_name, price = intent.groups
        item = await inventory_repo.fuzzy_search(session.business_id, item_name)

        if not item:
            return HandlerResult(
                response=ChatResponse(text=f"I couldn't find '{item_name}'. Did you mean one of these?",
                                      suggestions=await inventory_repo.suggest(item_name)),
                new_context={"pending_sale": {"qty": qty, "price": price}}
            )

        sale = await sales_service.record_sale(SaleCreate(
            items=[SaleItemInput(item_id=item.id, qty=Decimal(qty), unit_price=Decimal(price))],
            payment_method="cash",
            idempotency_key=str(uuid4()),
        ), session.business_id, session.user_id)

        return HandlerResult(
            response=ChatResponse(
                text=f"✅ Sold {qty} {item.name} for GHS {price}. Stock left: {item.current_stock - Decimal(qty)}",
                media_url=sale.invoice.qr_image_url,
            )
        )
```

**WhatsApp Webhook:**
```python
@router.post("/webhooks/whatsapp")
async def whatsapp_webhook(request: Request, background: BackgroundTasks):
    # 1. Verify webhook signature (X-Hub-Signature-256)
    # 2. Parse WhatsApp Business Cloud API payload
    # 3. Extract message + from_phone
    # 4. Load/create session from Redis
    # 5. Queue chat processing (background)
    background.add_task(process_whatsapp_message, message_data)
    return {"status": "ok"}  # Always 200 to WhatsApp
```

**Endpoints:**
- `POST /api/v1/chat/process` — Direct API chat (for app/web)
- `GET /api/v1/chat/history?session_id=` — Message history
- `POST /api/v1/webhooks/whatsapp` — WhatsApp Cloud API webhook (unauthenticated, signature-verified)

### 7.6 Phase 1 Completion Criteria

- [ ] Business can onboard via OTP + create profile
- [ ] Add inventory items, record sales via API + WhatsApp chat
- [ ] Invoices generated with QR, PDF sent via WhatsApp
- [ ] MTN MoMo payment request + callback handling
- [ ] Idempotent sale recording (no double-entries on retry)
- [ ] Low-stock notifications via WhatsApp
- [ ] 95%+ test coverage on sales + payments modules
- [ ] Load test: 500 concurrent sale recordings < 500ms p95

---

## 8. Phase 2 — Expanded Features (Weeks 11–20)

### 8.1 Module: Payroll (Weeks 11–13)

**Ghana Payroll Tax Rules:**
- SSNIT (Social Security): Employee 5.5%, Employer 13% of basic salary
- PAYE (Income Tax): Progressive bands — 0% up to GHS 402/month, 5% next GHS 110, 10% next GHS 130, 17.5% next GHS 3,000, 25% next GHS 16,393, 30% above GHS 20,000 (2025 bands)

```python
# modules/payroll/tax_calculator.py
PAYE_BANDS_2025 = [
    (402, Decimal("0.00")),
    (110, Decimal("0.05")),
    (130, Decimal("0.10")),
    (3000, Decimal("0.175")),
    (16393, Decimal("0.25")),
    (float("inf"), Decimal("0.30")),
]
SSNIT_EMPLOYEE_RATE = Decimal("0.055")
SSNIT_EMPLOYER_RATE = Decimal("0.13")

def calculate_paye(gross_monthly: Decimal) -> Decimal:
    tax = Decimal("0")
    remaining = gross_monthly
    for band, rate in PAYE_BANDS_2025:
        if remaining <= 0:
            break
        taxable = min(Decimal(str(band)), remaining)
        tax += taxable * rate
        remaining -= taxable
    return round(tax, 2)
```

**Payroll Run Flow:**
```
POST /api/v1/payroll/run
  1. Validate period (no duplicate run for same period)
  2. For each active employee:
     a. Calculate gross (base_pay + attendance adjustments)
     b. Calculate SSNIT (employee share)
     c. Calculate PAYE
     d. Net = Gross - SSNIT - PAYE - other_deductions
  3. Create PayrollRun + Payslips (all in one transaction)
  4. Generate payslip PDFs (async Celery)
  5. Optionally: trigger bulk MoMo disbursement
```

**Endpoints:**
- `POST /api/v1/employees` — Add employee
- `GET /api/v1/employees` — List employees
- `PATCH /api/v1/employees/:id` — Update employee
- `POST /api/v1/payroll/run` — Run payroll for period
- `GET /api/v1/payroll/runs` — List payroll runs
- `GET /api/v1/payroll/runs/:id/payslips` — List payslips
- `GET /api/v1/payroll/payslips/:id/pdf` — Download payslip
- `POST /api/v1/payroll/runs/:id/disburse` — Bulk MoMo payout

### 8.2 Module: Tax Compliance (Weeks 13–15)

**GRA e-VAT Filing:**

```python
# modules/tax/service.py
class TaxService:
    async def generate_monthly_return(self, business_id: UUID, year: int, month: int) -> TaxReturn:
        period_start = date(year, month, 1)
        period_end = date(year, month, calendar.monthrange(year, month)[1])

        # Aggregate from invoices (output VAT)
        output = await self.invoice_repo.aggregate_tax(business_id, period_start, period_end)

        # Aggregate input VAT (from supplier purchases — if tracked)
        input_vat = await self.stock_repo.aggregate_input_vat(business_id, period_start, period_end)

        vat_payable = max(output.vat_amount - input_vat, Decimal("0"))

        return_obj = TaxReturn(
            business_id=business_id,
            period_type="monthly",
            period_start=period_start,
            period_end=period_end,
            vat_output=output.vat_amount,
            vat_input=input_vat,
            vat_payable=vat_payable,
            nhil_amount=output.nhil_amount,
            getfund_amount=output.getfund_amount,
            covid_levy=output.covid_levy,
            total_tax=vat_payable + output.nhil_amount + output.getfund_amount + output.covid_levy,
            payload_json=self._build_gra_payload(business_id, ...),
        )
        return return_obj

    async def file_return(self, return_id: UUID) -> FilingResult:
        tax_return = await self.repo.get(return_id)
        if settings.ENABLE_GRA_DIRECT_FILING:
            result = await self.gra_client.submit_return(tax_return.payload_json)
            await self.repo.update(return_id, gra_ref=result.ref, status="submitted")
        else:
            # Export JSON/CSV for manual portal upload
            export_url = await self._export_return(tax_return)
            await self.repo.update(return_id, status="exported")
        return FilingResult(...)
```

**Endpoints:**
- `GET /api/v1/tax/summary` — `?period=monthly&year=2026&month=4`
- `GET /api/v1/tax/returns` — List all returns
- `POST /api/v1/tax/returns/generate` — Generate draft return for period
- `POST /api/v1/tax/returns/:id/file` — Submit to GRA (or export)
- `GET /api/v1/tax/returns/:id/export` — Download GRA-format file
- `GET /api/v1/tax/calendar` — Upcoming filing deadlines

### 8.3 Module: Credit Scoring (Weeks 15–18)

**Scoring Engine (Rule-Based v1, ML-Ready v2):**

```python
# modules/credit/scoring.py
@dataclass
class CreditFactors:
    revenue_30d: Decimal
    revenue_90d: Decimal
    transaction_count_90d: int
    avg_daily_transactions: float
    consistency_score: float        # % of days with at least 1 sale (90d)
    receivables_repayment_rate: float  # % of credit sales collected
    momo_velocity: float            # avg MoMo transaction/day
    account_age_days: int

class CreditScoringEngine:
    WEIGHTS = {
        "revenue_30d": 0.25,
        "revenue_90d": 0.20,
        "transaction_frequency": 0.20,
        "consistency": 0.15,
        "repayment": 0.15,
        "account_age": 0.05,
    }
    MAX_LOAN_MULTIPLIER = Decimal("0.5")  # 50% of monthly revenue

    def compute(self, factors: CreditFactors) -> CreditScore:
        # Normalize each factor to 0-100
        rev_30d_score = min(float(factors.revenue_30d) / 10000 * 100, 100)
        freq_score = min(factors.avg_daily_transactions / 10 * 100, 100)
        consistency_score = factors.consistency_score * 100
        repayment_score = factors.receivables_repayment_rate * 100
        age_score = min(factors.account_age_days / 365 * 100, 100)

        weighted = (
            rev_30d_score * self.WEIGHTS["revenue_30d"] +
            freq_score * self.WEIGHTS["transaction_frequency"] +
            consistency_score * self.WEIGHTS["consistency"] +
            repayment_score * self.WEIGHTS["repayment"] +
            age_score * self.WEIGHTS["account_age"]
        )

        band = "A" if weighted >= 80 else "B" if weighted >= 65 else "C" if weighted >= 50 else "D" if weighted >= 35 else "E"
        max_loan = factors.revenue_30d * self.MAX_LOAN_MULTIPLIER if weighted >= 50 else Decimal("0")

        return CreditScore(score=round(weighted, 2), band=band, max_loan_amount=max_loan,
                           factors=asdict(factors))
```

**Async Score Recalculation (Celery):**
```python
@celery.task
def recalculate_credit_score(business_id: str):
    factors = compute_credit_factors(business_id)
    score = CreditScoringEngine().compute(factors)
    CreditScore.objects.create(business_id=business_id, **asdict(score))
    # Check if new offer available → notify
    if score.max_loan_amount > 0:
        notify_credit_offer(business_id, score)
```

**Endpoints:**
- `GET /api/v1/credit/score` — Current score + loan offer
- `GET /api/v1/credit/score/history` — Score trend (premium)
- `POST /api/v1/credit/request` — Submit loan application to partner
- `GET /api/v1/credit/requests` — List loan requests + status

### 8.4 Module: Notifications (Weeks 18–20)

```python
# modules/notifications/dispatcher.py
class NotificationDispatcher:
    CHANNELS = ["whatsapp", "sms", "push"]

    async def send(self, business_id: UUID, event: NotificationEvent):
        prefs = await self.prefs_repo.get(business_id)
        for channel in self.CHANNELS:
            if prefs.enabled(channel, event.type):
                await self._send_channel(channel, event)

    async def _send_channel(self, channel: str, event: NotificationEvent):
        template = NOTIFICATION_TEMPLATES[event.type][channel]
        message = template.render(**event.data)
        if channel == "whatsapp":
            await whatsapp_client.send_text(event.phone, message)
        elif channel == "sms":
            await sms_client.send(event.phone, message)
```

**Notification Events:**
- `sale.recorded` → "Sale of GHS {total} recorded. Invoice #{number} sent."
- `payment.confirmed` → "Payment of GHS {amount} confirmed via {provider}."
- `stock.low` → "{item_name} stock is low ({qty} {unit} remaining)."
- `tax.deadline` → "VAT return for {month} due in {days} days."
- `credit.offer` → "You qualify for a GHS {amount} business loan. Reply LOAN to apply."
- `payroll.run_complete` → "Payroll for {period} processed. {count} employees paid."

---

## 9. Phase 3 — Scale & Premium (Weeks 21–32)

### 9.1 USSD Gateway (Weeks 21–23)

**USSD Session Architecture (Redis-backed):**

```python
# modules/ussd/session.py
class USSDSession:
    """
    USSD sessions managed in Redis with TTL = 120s (telco timeout).
    State machine: each USSD response is a menu page.
    """
    def __init__(self, session_id: str, phone: str, business_id: UUID | None):
        self.session_id = session_id
        self.phone = phone
        self.business_id = business_id
        self.state: str = "MAIN_MENU"
        self.data: dict = {}

# modules/ussd/router.py — USSD gateway endpoint (POST from Hubtel/Wigal)
@router.post("/ussd/callback", include_in_schema=False)
async def ussd_callback(
    SessionID: str = Form(...),
    MSISDN: str = Form(...),       # caller phone
    UserData: str = Form(""),      # what user typed
    Type: str = Form(""),          # "Initiation"|"Response"|"Release"
):
    session = await ussd_session_store.get_or_create(SessionID, MSISDN)
    response = await ussd_state_machine.handle(session, UserData)
    return PlainTextResponse(response)  # "CON ..." = continue, "END ..." = terminate
```

**USSD Menu Flow:**
```
CON Welcome to SME Flow
1. Record Sale
2. Check Stock
3. View Today's Summary
4. Send Invoice
5. Check Balance

→ User presses 1
CON Enter item name:

→ User types "tomato"
CON Enter quantity:

→ User types "10"
CON Enter price (GHS):

→ User types "5"
CON Confirm: Sell 10 tomato @ GHS 5 = GHS 50
1. Confirm
2. Cancel

→ User presses 1
END Sale recorded! GHS 50 via cash. Stock: 90 tomatoes left.
```

### 9.2 Analytics & Reporting (Weeks 23–26)

**Premium Analytics Endpoints:**
- `GET /api/v1/analytics/revenue?period=7d|30d|90d|1y&group_by=day|week|month`
- `GET /api/v1/analytics/top-items?limit=10&period=30d`
- `GET /api/v1/analytics/profit-loss?period=monthly&year=2026`
- `GET /api/v1/analytics/customers?sort=revenue|frequency`
- `GET /api/v1/analytics/inventory-turnover`
- `GET /api/v1/analytics/cash-flow?period=monthly`
- `POST /api/v1/analytics/export` — Async export to Excel/PDF (Celery job)

**Freemium gate:**
```python
async def require_premium(business: Business = Depends(get_current_business)):
    if business.subscription == "free" and endpoint_requires_premium:
        raise HTTPException(402, "Upgrade to premium for advanced analytics")
    return business
```

### 9.3 Billing & Subscriptions (Weeks 26–28)

```python
# modules/billing/limits.py
SUBSCRIPTION_LIMITS = {
    "free": {
        "monthly_sales": 500,
        "items": 100,
        "employees": 3,
        "analytics": False,
        "credit_scoring": False,
        "export": False,
    },
    "starter": {
        "monthly_sales": 2000,
        "items": 500,
        "employees": 10,
        "analytics": "basic",
        "credit_scoring": True,
        "export": False,
    },
    "pro": {
        "monthly_sales": -1,    # unlimited
        "items": -1,
        "employees": -1,
        "analytics": "full",
        "credit_scoring": True,
        "export": True,
    },
}

class UsageLimiter:
    async def check(self, business_id: UUID, resource: str):
        limit = SUBSCRIPTION_LIMITS[business.subscription].get(resource)
        if limit == -1:
            return  # unlimited
        usage = await self.usage_repo.get_monthly(business_id, resource)
        if usage >= limit:
            raise LimitExceededError(resource, limit)
```

**Billing Endpoints:**
- `GET /api/v1/billing/plan` — Current plan + usage
- `POST /api/v1/billing/subscribe` — Initiate MoMo payment for plan upgrade
- `GET /api/v1/billing/invoices` — Billing history
- `POST /api/v1/webhooks/billing/callback` — MoMo callback for subscription payment

### 9.4 Admin Module (Weeks 28–30)

**Internal Admin Endpoints (separate router, IP-whitelisted):**
- `GET /api/v1/admin/businesses` — All businesses with filters
- `GET /api/v1/admin/businesses/:id` — Full business detail
- `POST /api/v1/admin/businesses/:id/suspend` — Suspend business
- `GET /api/v1/admin/transactions` — Cross-tenant transaction view (fraud review)
- `GET /api/v1/admin/fraud-queue` — Flagged high-velocity transactions
- `GET /api/v1/admin/audit-logs` — Full audit log with filters
- `POST /api/v1/admin/credit/manual-review` — Override credit decision
- `GET /api/v1/admin/metrics` — Platform-wide metrics (users, revenue, TPV)

### 9.5 Agent Network (Weeks 30–32)

- Agent registration + territory assignment
- Agent-assisted onboarding flow (agent gets attribution)
- Commission tracking: X% of transaction fees from referred businesses
- `GET /api/v1/agent/dashboard` — Referred businesses + commissions
- `POST /api/v1/agent/onboard` — Register new business on behalf of merchant

---

## 10. Cross-Cutting Concerns

### 10.1 Error Handling

```python
# core/exceptions.py
from fastapi import Request
from fastapi.responses import JSONResponse

class SMEFlowException(Exception):
    def __init__(self, message: str, code: str, status_code: int = 400):
        self.message = message
        self.code = code
        self.status_code = status_code

class InsufficientStockError(SMEFlowException):
    def __init__(self, item_name: str, available: Decimal, requested: Decimal):
        super().__init__(
            message=f"Insufficient stock for {item_name}: {available} available, {requested} requested",
            code="INSUFFICIENT_STOCK", status_code=422)

def register_exception_handlers(app):
    @app.exception_handler(SMEFlowException)
    async def smeflow_exception_handler(request: Request, exc: SMEFlowException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}}
        )
    # Also handle: RequestValidationError, HTTPException, generic Exception
```

**Standard Error Response Shape:**
```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for Tomatoes: 3.0 available, 10.0 requested",
    "details": {}
  }
}
```

### 10.2 Rate Limiting

```python
# core/middleware.py
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, storage_uri=settings.REDIS_URL)

# Per endpoint:
@router.post("/auth/otp/request")
@limiter.limit("3/minute")
async def request_otp(...): ...

@router.post("/chat/process")
@limiter.limit("60/minute")
async def process_chat(...): ...

@router.post("/sales/record")
@limiter.limit("300/minute")  # high for batch offline sync
async def record_sale(...): ...
```

### 10.3 Audit Logging

```python
# core/audit.py
async def audit(db: AsyncSession, user_id: UUID, business_id: UUID,
                action: str, resource_type: str, resource_id: UUID,
                before: dict | None = None, after: dict | None = None):
    log = AuditLog(
        user_id=user_id, business_id=business_id,
        action=action, resource_type=resource_type, resource_id=resource_id,
        before_state=before, after_state=after,
    )
    db.add(log)
    # Don't raise on audit failure — log to Sentry but don't break transaction
```

### 10.4 Fraud Detection

```python
# modules/sales/fraud.py
class FraudDetector:
    VELOCITY_LIMITS = {
        "sales_per_hour": 200,
        "sales_per_minute": 10,
        "max_single_sale_ghs": 50_000,
        "momo_collections_per_day": 500,
    }

    async def check_sale(self, business_id: UUID, amount: Decimal) -> FraudResult:
        checks = await asyncio.gather(
            self._check_velocity(business_id),
            self._check_amount(business_id, amount),
            self._check_momo_velocity(business_id),
        )
        if any(c.is_fraud for c in checks):
            await self.flag_for_review(business_id, checks)
            return FraudResult(blocked=True, reasons=[c.reason for c in checks if c.is_fraud])
        return FraudResult(blocked=False)
```

### 10.5 Offline Sync

```python
# modules/sales/router.py
@router.post("/sales/batch")
async def batch_sync(payload: BatchSyncPayload, ...):
    """
    Accept array of sales recorded offline, process idempotently.
    Returns per-item status (success/duplicate/failed).
    Max 100 items per batch.
    """
    results = []
    for sale_data in payload.sales:
        try:
            result = await sales_service.record_sale(sale_data, ...)
            results.append({"idempotency_key": sale_data.idempotency_key, "status": "success", "sale_id": result.id})
        except DuplicateError:
            results.append({"idempotency_key": sale_data.idempotency_key, "status": "duplicate"})
        except Exception as e:
            results.append({"idempotency_key": sale_data.idempotency_key, "status": "failed", "error": str(e)})
    return {"processed": len(results), "results": results}
```

---

## 11. Testing Strategy

### 11.1 Test Pyramid

```
          /     E2E (Postman/Bruno)      \     5%  — Full flows (onboard → sale → invoice → payment)
         /    Integration Tests           \   25%  — DB + Redis + Celery tasks
        /    Unit Tests                    \  70%  — Services, parsers, calculators, validators
```

### 11.2 Unit Tests Example

```python
# tests/unit/test_credit_scoring.py
class TestCreditScoringEngine:
    def test_high_revenue_consistent_business_scores_above_80(self):
        factors = CreditFactors(
            revenue_30d=Decimal("25000"),
            revenue_90d=Decimal("70000"),
            transaction_count_90d=450,
            avg_daily_transactions=5.0,
            consistency_score=0.92,
            receivables_repayment_rate=0.95,
            momo_velocity=4.0,
            account_age_days=400,
        )
        result = CreditScoringEngine().compute(factors)
        assert result.band == "A"
        assert result.score >= 80
        assert result.max_loan_amount > 0

    def test_new_business_with_no_history_scores_band_e(self):
        factors = CreditFactors(revenue_30d=Decimal("0"), account_age_days=5, ...)
        result = CreditScoringEngine().compute(factors)
        assert result.band == "E"
        assert result.max_loan_amount == Decimal("0")
```

### 11.3 Integration Tests

```python
# tests/integration/test_sale_flow.py
@pytest.mark.asyncio
async def test_sale_deducts_inventory_atomically(async_client, db_session, auth_headers, seeded_item):
    item_id = seeded_item.id
    initial_stock = seeded_item.current_stock  # 100.0

    # Record sale twice with same idempotency key (simulate retry)
    payload = {
        "items": [{"item_id": str(item_id), "qty": 5, "unit_price": "10.00"}],
        "payment_method": "cash",
        "idempotency_key": "test-key-001"
    }
    r1 = await async_client.post("/api/v1/sales/record", json=payload, headers=auth_headers)
    r2 = await async_client.post("/api/v1/sales/record", json=payload, headers=auth_headers)

    assert r1.status_code == 201
    assert r2.status_code == 200  # idempotent — same response, no duplicate

    item = await db_session.get(Item, item_id)
    assert item.current_stock == initial_stock - 5  # deducted exactly once
```

### 11.4 Load Testing

```python
# tests/load/locustfile.py
class SMEFlowLoadTest(HttpUser):
    wait_time = between(0.1, 0.5)

    @task(10)
    def record_sale(self):
        self.client.post("/api/v1/sales/record", json={
            "items": [{"item_id": ITEM_ID, "qty": 1, "unit_price": "10.00"}],
            "payment_method": "cash",
            "idempotency_key": str(uuid4()),
        }, headers=self.auth_headers)

    @task(3)
    def check_inventory(self):
        self.client.get("/api/v1/inventory/items", headers=self.auth_headers)

    @task(1)
    def get_report(self):
        self.client.get("/api/v1/sales/summary/daily", headers=self.auth_headers)
```

Target: 1,000 concurrent users, p95 < 500ms, error rate < 0.1%.

---

## 12. Deployment & CI/CD

### 12.1 GitHub Actions Pipeline

```yaml
# .github/workflows/ci.yml
name: CI/CD
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres: { image: timescale/timescaledb:latest-pg16, ... }
      redis: { image: redis:7-alpine }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install uv && uv sync
      - run: uv run ruff check .
      - run: uv run mypy apps/api
      - run: uv run bandit -r apps/api -ll
      - run: uv run pytest apps/api/tests --cov --cov-fail-under=90

  build-push:
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: docker/build-push-action@v5
        with: { push: true, tags: ghcr.io/smeflow/api:${{ github.sha }} }

  deploy-staging:
    needs: build-push
    steps:
      - run: kubectl set image deployment/smeflow-api api=ghcr.io/smeflow/api:${{ github.sha }}
```

### 12.2 Kubernetes Manifests

```yaml
# infra/k8s/api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: smeflow-api
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/smeflow/api:latest
          command: ["gunicorn", "main:app", "-k", "uvicorn.workers.UvicornWorker",
                    "-w", "4", "--bind", "0.0.0.0:8000", "--timeout", "30"]
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits: { cpu: "2000m", memory: "2Gi" }
          livenessProbe:
            httpGet: { path: /health, port: 8000 }
            initialDelaySeconds: 10
          readinessProbe:
            httpGet: { path: /ready, port: 8000 }
          envFrom:
            - secretRef: { name: smeflow-secrets }
```

### 12.3 Database Scaling Strategy

- Phase 1-2: Single PostgreSQL primary + 1 read replica (RDS)
- Phase 3: Read replicas behind pgBouncer (connection pooling); sales + audit_logs partitioned by `created_at` (monthly chunks via TimescaleDB chunks)
- Future: Citus extension for horizontal sharding by `business_id` if needed at 10M+ businesses

---

## 13. Observability Stack

### 13.1 Structured Logging

```python
# core/logging.py
import structlog
logger = structlog.get_logger()

# In service layer:
logger.info("sale.recorded",
    business_id=str(business_id),
    sale_id=str(sale.id),
    total=float(sale.total),
    payment_method=sale.payment_method,
    duration_ms=elapsed,
)
```

### 13.2 Metrics (Prometheus)

```python
from prometheus_fastapi_instrumentator import Instrumentator
Instrumentator().instrument(app).expose(app)

# Custom metrics:
sales_counter = Counter("smeflow_sales_total", "Total sales recorded", ["payment_method", "business_tier"])
payment_duration = Histogram("smeflow_payment_duration_seconds", "MoMo payment round-trip time")
```

### 13.3 Tracing (OpenTelemetry)

```python
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
FastAPIInstrumentor.instrument_app(app)
SQLAlchemyInstrumentor().instrument(engine=db_engine.sync_engine)
# Export to Jaeger / Tempo
```

### 13.4 Dashboards

- **Grafana Dashboards:** API latency (p50/p95/p99), error rates, DB pool usage, queue depth, active USSD sessions
- **Business Dashboard:** Daily TPV (Total Payment Volume), active businesses, new registrations, chat command success rate
- **Alerts:** p95 > 1s, error rate > 1%, queue depth > 1000, DB connections > 80%, payment callback timeout rate > 5%

---

## 14. Risk Register & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MTN/Vodafone API instability | High | High | Retry with exponential backoff + circuit breaker (tenacity); fallback to Hubtel aggregator |
| GRA e-VAT spec changes | Medium | High | Modular tax calculator; monitor GRA bulletins; toggle via feature flag |
| Double-charge on payment retries | Medium | Critical | Idempotency keys on all payment initiations; webhook deduplication |
| DB overload at scale | Medium | High | Connection pooling (pgBouncer); read replicas; table partitioning from day 1 |
| WhatsApp API rate limits | High | Medium | Queue WhatsApp sends; batch where allowed; SMS fallback |
| Offline sync conflicts | High | Medium | Idempotency keys on all client-created records; append-only financial records |
| Fraud / money laundering | Low | Critical | Velocity checks, manual review queue, daily anomaly detection batch job |
| Data breach | Low | Critical | Encrypt PII at rest (pgcrypto), TLS everywhere, secrets in Vault, regular pen tests |

---

## 15. Team & Timeline Summary

### Recommended Team (Startup Phase)

| Role | Count | Responsibility |
|---|---|---|
| Backend Lead (Staff SWE) | 1 | Architecture, code review, critical modules |
| Backend Engineers | 2 | Feature modules, tests |
| DevOps/Platform | 1 | Infra, CI/CD, monitoring |
| QA Engineer | 1 | Test automation, load testing |

### Timeline

| Phase | Weeks | Key Deliverables |
|---|---|---|
| Phase 0 | 1–2 | Foundation: auth, business onboarding, CI/CD, Docker |
| Phase 1 | 3–10 | MVP: inventory, sales, invoicing (GRA), MTN MoMo, chat parser |
| Phase 2 | 11–20 | Payroll, tax filing, credit scoring, notifications |
| Phase 3 | 21–32 | USSD, analytics, premium billing, admin, agent network |
| Ongoing | 33+ | ML credit model, GRA direct API, scale testing (150k users), partnerships |

### Definition of Done (per endpoint)

1. ✅ Unit tests (service layer) — >90% coverage
2. ✅ Integration test (DB + Redis round-trip)
3. ✅ OpenAPI spec updated
4. ✅ Audit log entry verified
5. ✅ Rate limiting applied
6. ✅ Idempotency handled (for mutations)
7. ✅ p95 < 300ms under 100 concurrent requests
8. ✅ Error responses follow standard shape
9. ✅ Multi-tenant isolation verified (cross-tenant test)

---

## Appendix A: Key Dependencies

```toml
# pyproject.toml
[project]
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "gunicorn>=22",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.29",
    "alembic>=1.13",
    "pydantic>=2.8",
    "pydantic-settings>=2.3",
    "redis[hiredis]>=5.0",
    "celery[rabbitmq]>=5.4",
    "redbeat>=2.2",             # Redis-backed celery beat
    "python-jose[cryptography]>=3.3",
    "passlib[bcrypt]>=1.7",
    "httpx>=0.27",              # Async HTTP client for payment providers
    "tenacity>=8.3",            # Retry logic
    "qrcode[pil]>=7.4",
    "reportlab>=4.2",           # PDF generation
    "boto3>=1.34",              # S3 uploads
    "structlog>=24",
    "opentelemetry-instrumentation-fastapi>=0.46b0",
    "opentelemetry-instrumentation-sqlalchemy>=0.46b0",
    "prometheus-fastapi-instrumentator>=7",
    "slowapi>=0.1.9",           # Rate limiting
    "anthropic>=0.30",          # LLM-lite for chat parsing fallback
    "sentry-sdk[fastapi]>=2",
]

[project.optional-dependencies]
dev = [
    "pytest>=8", "pytest-asyncio>=0.23", "pytest-cov>=5",
    "httpx>=0.27", "faker>=25",
    "ruff>=0.5", "mypy>=1.10", "bandit>=1.7",
    "locust>=2.29",
]
```

---

*This document is a living specification. Update it as requirements evolve, GRA regulations change, or provider APIs are updated. Tag each section with the last-reviewed date when making significant changes.*
