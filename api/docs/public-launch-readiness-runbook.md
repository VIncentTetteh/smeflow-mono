# SMEflow Public Launch Readiness Runbook

## Launch Gates

- Source control is clean in API, Web, and mobile release branches; generated folders and local virtualenvs are ignored.
- API gates pass: `uv run ruff check .`, `uv run mypy apps/api --ignore-missing-imports`, `uv run bandit -r apps/api -ll --exclude apps/api/tests`, Alembic heads/current checks, full unit/integration tests, and coverage at 80% or higher.
- Web gates pass: `npm run lint`, `npm run typecheck`, `npm run build`, and route smoke tests for admin, lender, and agent surfaces.
- Mobile gates pass: `npm run typecheck`, `npm test -- --runInBand --watchman=false`, `npx expo config --type public`, Android production build, iOS production build, and native smoke on physical devices.
- Staging smoke covers OTP, onboarding, KYC, inventory, sale, invoice, payment request/webhook, offline sync, merchant-selected lender loan request, lender approval/rejection, repayment lifecycle, notifications, and admin MFA.

## Production Configuration

- `SECRET_KEY`, database, Redis, RabbitMQ, provider credentials, Sentry, OTEL, webhook secrets, and lender key settings are loaded from a secret manager, never from committed files.

### Paystack webhook (single URL)

Configure **one** webhook in the [Paystack Dashboard](https://dashboard.paystack.com/#/settings/developers) (Developers → Webhooks):

| Environment | URL |
|-------------|-----|
| Local (via tunnel) | `http://localhost:8000/api/v1/payments/webhooks/paystack` |
| Production | `https://<api-host>/api/v1/payments/webhooks/paystack` |

Path is also documented in OpenAPI/integration tests: `POST /api/v1/payments/webhooks/paystack`.

This endpoint handles `charge.success`, `transfer.success` / `failed` / `reversed`, subscription events, and `dedicatedaccount.assign.success`. Do **not** register `/api/v1/webhooks/payouts/paystack` separately (legacy alias only).

Set `ENABLE_LEGACY_AGENT_MOMO_PAYOUT=false` in production `.env`.
- `ADMIN_ALLOWED_IPS` is configured and also enforced at VPN/load-balancer level.
- API readiness and liveness probes use `/ready` and `/health`.
- A migration job runs `python -m alembic upgrade head` before API rollout.
- Backups are scheduled, encrypted, monitored, and restore-tested before launch.

## Monitoring And Alerts

- Alert on API 5xx rate, p95 latency, readiness failures, worker queue depth, failed Celery jobs, DB connection exhaustion, Redis/RabbitMQ errors, and webhook verification failures.
- Alert on OTP request/verify failure spikes, payment pending age, invoice generation failures, sync failures, loan lifecycle failures, and mobile crash-free sessions below target.
- Dashboards must show traffic, error rate, latency, auth, payments, loans, notifications, sync, workers, and provider callbacks.

## Rollout

- Stage 1: staging signoff with seeded data and sandbox providers.
- Stage 2: internal dogfood using production-like infra and limited real devices.
- Stage 3: limited production cohort with named support contacts.
- Stage 4: public launch only after seven days without unresolved P0/P1 incidents.

## Rollback

- Roll back API to the last healthy image and pause migrations if schema rollback is not verified.
- Disable new mobile updates through EAS if a native issue is found; keep prior production builds available.
- Pause onboarding and lender actions for P0/P1 issues in auth, KYC, payments, loans, sync, or invoice generation.
- Reconcile queued offline records before asking affected users to log out or reinstall.
