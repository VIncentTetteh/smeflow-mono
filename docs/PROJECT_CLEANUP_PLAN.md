# SMEflow — Project Cleanup Plan

> Generated: 2026-06-06

---

## ⚠️ URGENT: Rotate These Leaked Secrets First

The current `api/.env` contains **real credentials** that must be rotated immediately — before any git init or push.

| Key | Value (prefix) | Where to rotate |
|-----|----------------|-----------------|
| `PAYSTACK_SECRET_KEY` | `sk_test_12ce65...` | [Paystack Dashboard → Settings → API Keys](https://dashboard.paystack.com/#/settings/developers) |
| `XAI_API_KEY` | `gsk_dg2RAp2m...` | [x.ai Console](https://console.x.ai) |
| `GROQ_API_KEY` | `gsk_dg2RAp2m...` (same key — fix this) | [Groq Console](https://console.groq.com/keys) |
| `GOOGLE_TRANSLATE_API_KEY` | `AIzaSyBDvJ48...` | [GCP Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) |
| `SECRET_KEY` | `a033ebef...` | Regenerate locally: `python -c "import secrets; print(secrets.token_hex(32))"` |

---

## 1. Repository Initialisation

The project has no `.git` directory. Before anything else:

```bash
cd ~/Desktop/SMEflow-App
git init
git branch -M main
```

### Add a root `.gitignore`

Create `/SMEflow-App/.gitignore`:

```gitignore
# Secrets
.env
.env.*
!.env.example

# Python
__pycache__/
*.py[cod]
*.pyo
.venv/
venv/
*.egg-info/
dist/
build/
.eggs/

# Node
node_modules/
.next/
dist/

# Expo / React Native
.expo/
*.jks
*.keystore

# Coverage / Testing
.pytest_cache/
.coverage
.coverage.*
coverage.xml
htmlcov/
coverage/

# IDE / OS
.DS_Store
.idea/
.vscode/
*.swp
*.swo
Thumbs.db

# Alembic generated
alembic.ini

# Secrets & certs
*.pem
*.key
*.crt
secrets/

# Logs & temp
*.log
tmp/
*.pdf
*.qr.png

# Large archives
*.zip

# Claude / tooling scratch
graphify-out/
.superpowers/
.remember/
```

---

## 2. Root Directory Cleanup

Remove / move these files that shouldn't live at the project root:

| File/Folder | Action |
|-------------|--------|
| `api.zip` (183 MB) | **Delete** — it's the full api folder zipped |
| `create-a-plan-to-greedy-newt.md` | Delete (old Claude output) |
| `admin-gap-analysis-and-plan.md` | Move → `docs/` |
| `agent-api-mobile-gap-analysis.md` | Move → `docs/` |
| `lender-gap-analysis-and-plan.md` | Move → `docs/` |
| `merchant-api-mobile-gap-analysis.md` | Move → `docs/` |
| `graphify-out/` | Delete (generated, gitignored) |
| `.coverage` | Delete (test artifact) |
| `.DS_Store` | Delete |
| `.superpowers/` | Delete or gitignore |

```bash
cd ~/Desktop/SMEflow-App

# Delete junk
rm api.zip
rm create-a-plan-to-greedy-newt.md
rm .coverage
rm .DS_Store

# Move docs
mkdir -p docs
mv admin-gap-analysis-and-plan.md docs/
mv agent-api-mobile-gap-analysis.md docs/
mv lender-gap-analysis-and-plan.md docs/
mv merchant-api-mobile-gap-analysis.md docs/

# Remove generated/tooling dirs
rm -rf graphify-out
rm -rf .superpowers
```

---

## 3. API `.env` Cleanup

### Issues in current `api/.env`

1. Real secrets committed (see section 0)
2. `XAI_API_KEY` and `GROQ_API_KEY` share the same value — they're different services, needs separate keys
3. Dev overrides differ from `.env.example` defaults (e.g. `OTP_LENGTH=6` vs example's `4`, `OTP_RATE_LIMIT=20` vs `3`, `FREE_TIER_MONTHLY_SALES=500` vs `-1`)
4. `PAYSTACK_WEBHOOK_URL` pointing at localhost is fine for dev but must be excluded from `.env.example` or clearly noted

### Steps

```bash
cd ~/Desktop/SMEflow-App/api

# 1. Rotate all secrets (see section 0 above)
# 2. Generate a fresh SECRET_KEY
python -c "import secrets; print(secrets.token_hex(32))"

# 3. Replace .env with clean values
cp .env.example .env
# Then fill in only real dev credentials
```

### `.env.example` fixes needed

- Align `FREE_TIER_MONTHLY_SALES` default (example says `-1`, actual is `500` — decide which is correct)
- Add `PAYSTACK_WEBHOOK_URL` with a note about needing an ngrok/cloudflared tunnel
- Add `Web/` and `mobile/` env examples inline or as a note at the top pointing to their own `.env.example` files

---

## 4. Web & Mobile `.env` Cleanup

**`Web/.env.local`** — only two vars, simple:
```
NEXT_PUBLIC_API_URL=/api/proxy
API_URL=http://localhost:8000
```
Make sure `Web/.gitignore` excludes `.env.local` (Next.js does this by default, verify it's present).

**`mobile/.env.local`** — single var with a hardcoded LAN IP:
```
EXPO_PUBLIC_API_BASE_URL=http://192.168.100.34:8000
```
Replace with a named variable in `.env.example` so every dev sets their own IP:
```
EXPO_PUBLIC_API_BASE_URL=http://<YOUR_LAN_IP>:8000
```

---

## 5. Drop DB & Start Fresh

```bash
# Drop and recreate the database
psql -U postgres -c "DROP DATABASE IF EXISTS smeflow;"
psql -U postgres -c "DROP ROLE IF EXISTS smeflow;"
psql -U postgres -c "CREATE ROLE smeflow WITH LOGIN PASSWORD 'smeflow';"
psql -U postgres -c "CREATE DATABASE smeflow OWNER smeflow;"
```

Or with Docker Compose (preferred):

```bash
cd ~/Desktop/SMEflow-App/api
docker compose down -v          # removes containers AND named volumes
docker compose up -d db redis rabbitmq
```

---

## 6. Reset & Squash Migrations

There are currently **37 migration files** (0001–0037) plus a duplicate `0005` (`0005_kyc_status.py` and `0005_onboarding_compliance.py`). The cleanest approach for a pre-launch reset is to squash everything into a single `0001_initial.py`.

### Steps

```bash
cd ~/Desktop/SMEflow-App/api

# 1. Delete all existing migration versions
rm migrations/versions/*.py

# 2. Delete the Alembic migration tracking table from the (now clean) DB
#    — not needed since we're dropping the DB in step 5

# 3. Generate a single fresh migration from current models
alembic revision --autogenerate -m "initial_schema"

# 4. Rename the generated file to 0001_initial.py for clarity
# (alembic generates a hash-prefixed filename — rename it)

# 5. Apply the migration
alembic upgrade head
```

> **Note:** Review the generated migration carefully. `--autogenerate` won't catch raw SQL (triggers, custom functions, etc.) — check each model file for anything that needs to be added manually.

### After squash

Verify the duplicate `0005` situation is gone and add a note in `migrations/README.md` explaining the squash date and reason.

---

## 7. Python Environment Cleanup

```bash
cd ~/Desktop/SMEflow-App/api

# Remove old venv (committed or leftover)
rm -rf venv .venv

# Recreate with uv (project already uses uv.lock)
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
```

Make sure `venv/` and `.venv/` are in `.gitignore` (already is in `api/.gitignore`).

---

## 8. Remove Loose Dev Files from `api/`

| File | Action |
|------|--------|
| `AFRICAS_TALKING_INTEGRATION.py` | Move → `docs/integrations/africas_talking.md` or delete |
| `AFRICAS_TALKING_QUICKSTART.md` | Move → `docs/integrations/` |
| `AFRICAS_TALKING_SETUP.md` | Move → `docs/integrations/` |
| `SALES_NOTIFICATIONS.md` | Move → `docs/` |
| `SMEFlow_UserStories.md` | Move → `docs/` |
| `SMEFlow_BackendDev_Plan.md` | Move → `docs/` |
| `smeflow_build_security_plan.docx` | Move → `docs/` |
| `smeflow_implementation_plan.docx` | Move → `docs/` |
| `pytest-cache-files-p_vmlb10` | **Delete** (stale pytest cache) |
| `api/.claude/settings.local.json` | Add to `.gitignore` |

---

## 9. First Clean Commit

```bash
cd ~/Desktop/SMEflow-App
git add .
git status   # double-check nothing sensitive is staged
git commit -m "chore: initial clean project setup"
```

Then push to a fresh remote (GitHub / GitLab):

```bash
git remote add origin git@github.com:your-org/smeflow.git
git push -u origin main
```

---

## 10. External Integrations Checklist

All integrations that need accounts, keys, or configuration before the app is fully functional.

### Payments

| Integration | Purpose | Dashboard / Docs |
|-------------|---------|-----------------|
| **Paystack** | MoMo (MTN, Vodafone/Telecel, AirtelTigo), card payments, DVA, subscriptions, transfers | [dashboard.paystack.com](https://dashboard.paystack.com) · [docs](https://paystack.com/docs) |

- [ ] Rotate test secret key
- [ ] Create live secret key
- [ ] Configure Webhook URL in dashboard
- [ ] Run `python -m scripts.seed_paystack_plans` to populate `PAYSTACK_STARTER_PLAN_CODE` / `PAYSTACK_PRO_PLAN_CODE`
- [ ] Set `PAYSTACK_DVA_PREFERRED_BANK` (wema-bank or paystack-titan)

---

### Messaging & Notifications

| Integration | Purpose | Dashboard / Docs |
|-------------|---------|-----------------|
| **WhatsApp Business Cloud API** | Transactional messages, receipts, OTP | [developers.facebook.com/docs/whatsapp](https://developers.facebook.com/docs/whatsapp) · [Meta Business Suite](https://business.facebook.com) |
| **Africa's Talking (AT)** | SMS (bulk + transactional) | [africastalking.com](https://africastalking.com) · [docs](https://developers.africastalking.com) |
| **Hubtel SMS** | Alternative Ghana SMS channel | [hubtel.com/developers](https://hubtel.com/developers) |
| **Hubtel OTP** | OTP delivery via Hubtel | [api-otp.hubtel.com docs](https://developers.hubtel.com) |
| **Firebase (FCM)** | Push notifications (Android + iOS) | [console.firebase.google.com](https://console.firebase.google.com) · [docs](https://firebase.google.com/docs/cloud-messaging) |
| **Resend** | Transactional email | [resend.com](https://resend.com) · [dashboard](https://resend.com/overview) |
| **VAPID / Web Push** | Browser push notifications | Generate keys: `npx web-push generate-vapid-keys` |

---

### Identity / KYC

| Integration | Purpose | Dashboard / Docs |
|-------------|---------|-----------------|
| **Hubtel Phone Verification** | Registered-name lookup after OTP | [developers.hubtel.com](https://developers.hubtel.com) |
| **NIA (National Identification Authority)** | Ghana Card verification | [nia.gov.gh](https://nia.gov.gh) — contact for API access |

---

### AI / Voice

| Integration | Purpose | Dashboard / Docs |
|-------------|---------|-----------------|
| **xAI / Grok** | Chat LLM (business assistant) | [console.x.ai](https://console.x.ai) · [docs](https://docs.x.ai) |
| **Groq (Whisper)** | Voice transcription | [console.groq.com](https://console.groq.com) · [docs](https://console.groq.com/docs/openai) |

> ⚠️ Currently both share the same API key value — they need separate keys.

---

### Compliance / Government

| Integration | Purpose | Dashboard / Docs |
|-------------|---------|-----------------|
| **GRA (Ghana Revenue Authority)** | Tax filing, VAT | [gra.gov.gh](https://gra.gov.gh) — API access via formal request |
| **Google Cloud Translation** | Multi-language support | [console.cloud.google.com/apis/library/translate.googleapis.com](https://console.cloud.google.com/apis/library/translate.googleapis.com) |

---

### Infrastructure & Observability

| Integration | Purpose | Dashboard / Docs |
|-------------|---------|-----------------|
| **AWS S3** | File & asset storage | [s3.console.aws.amazon.com](https://s3.console.aws.amazon.com) · [docs](https://docs.aws.amazon.com/s3) |
| **Sentry** | Error tracking & performance | [sentry.io](https://sentry.io) |
| **OpenTelemetry** | Distributed tracing | [opentelemetry.io](https://opentelemetry.io) |

---

### Self-hosted (Docker Compose)

These run locally via `docker-compose.yml` — no external account needed, but production needs proper hosting:

| Service | Purpose |
|---------|---------|
| **PostgreSQL** | Primary database |
| **Redis** | Sessions, OTP, idempotency, Celery results |
| **RabbitMQ** | Celery task queue |

---

## Summary Checklist

```
[ ] Rotate all leaked secrets (URGENT)
[ ] git init + root .gitignore
[ ] Delete api.zip + loose root files
[ ] Move gap analysis docs into docs/
[ ] Clean up api/ loose files → docs/integrations/
[ ] Fix .env: align with .env.example, separate XAI/Groq keys
[ ] Fix mobile/.env.local hardcoded IP
[ ] docker compose down -v
[ ] Delete all migration versions
[ ] alembic revision --autogenerate -m "initial_schema"
[ ] alembic upgrade head
[ ] Recreate venv with uv
[ ] First clean commit
[ ] Push to fresh remote
[ ] Activate each integration (see table above)
```
