# SMEflow Public Launch Readiness Runbook

## Launch Gates

- Source control is clean in API, Web, and mobile release branches; generated folders and local virtualenvs are ignored.
- API gates pass: `uv run ruff check .`, `uv run mypy apps/api --ignore-missing-imports`, `uv run bandit -r apps/api -ll --exclude apps/api/tests`, Alembic heads/current checks, full unit/integration tests, and coverage at 80% or higher.
- Web gates pass: `npm run lint`, `npm run typecheck`, `npm run build`, and route smoke tests for admin, lender, and agent surfaces.
- Mobile gates pass: `npm run typecheck`, `npm test -- --runInBand --watchman=false`, `npx expo config --type public`, Android production build, iOS production build, and native smoke on physical devices.
- Staging smoke covers OTP, onboarding, KYC, inventory, sale, invoice, payment request/webhook, offline sync, merchant-selected lender loan request, lender approval/rejection, repayment lifecycle, notifications, and admin MFA.

## Production Configuration

- `SECRET_KEY`, database, Redis, RabbitMQ, provider credentials, Sentry, OTEL, webhook secrets, and lender key settings are loaded from a secret manager, never from committed files.
- Rotate every credential that has ever appeared in local `.env` files before public launch. At minimum rotate JWT secrets, Paystack keys, Google API keys, LLM keys, AWS keys, WhatsApp/SMS/provider keys, webhook secrets, and lender API keys.
- Store production runtime values in AWS Secrets Manager under `smeflow/production/api`; Kubernetes reads them through External Secrets and writes only the generated `smeflow-secrets` Secret.
- `API_URL` for Web must be an HTTPS production URL. Production Web route handlers must fail closed if `API_URL` is missing or points to localhost/LAN.
- `ENABLE_PUBLIC_DOCS=false` and `ENABLE_PUBLIC_METRICS=false` in production. Expose metrics only through internal Prometheus ingress.

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

## Staging Smoke Test Checklist

Run this checklist after every release candidate reaches staging:

1. `GET /health` returns 200 and `GET /ready` returns 200 with DB, Redis, and schema ok.
2. OTP request and verify works for a staging Ghana phone number.
3. Owner creates a business, submits KYC, and switches business context.
4. Owner creates inventory, records a cash sale, voids a sale, and verifies daily sales summary.
5. Owner creates invoice, sends invoice, opens invoice payment URL, and receives Paystack sandbox webhook.
6. Merchant settlement preview, request, cancel, and ledger views work.
7. Credit score, loan request, lender approval/rejection, confirmation, disbursement status, and repayment schedule work.
8. Lender portal login, forced password reset, product management, loan list/detail, and webhook test work.
9. Admin login with MFA/IP allowlist, pending action approval, KYC review, suspension/appeal, and audit log views work.
10. Mobile app passes native smoke on physical Android and iOS devices: login, offline sale, sync, inventory, invoices, payments, notifications, and logout.

## Backup And Restore

- RDS automated backups retain at least 35 days, are encrypted, and have deletion protection enabled.
- Before public launch, perform a restore drill into an isolated staging database:
  1. Restore the latest production-like snapshot.
  2. Run `python -m alembic current` and `python -m scripts.check_schema`.
  3. Point a staging API pod at the restored database.
  4. Run smoke tests against restored data.
  5. Record restore start/end time, data timestamp, and any manual repair steps.
- S3 buckets use server-side encryption, public access block, lifecycle rules for temporary exports, and object recovery policy appropriate for customer artifacts.
- Redis and RabbitMQ are treated as reconstructable operational state; alert on queue depth and failed jobs before data loss affects customer workflows.

## Monitoring And Alerts

- Alert on API 5xx rate, p95 latency, readiness failures, worker queue depth, failed Celery jobs, DB connection exhaustion, Redis/RabbitMQ errors, and webhook verification failures.
- Alert on OTP request/verify failure spikes, payment pending age, invoice generation failures, sync failures, loan lifecycle failures, and mobile crash-free sessions below target.
- Dashboards must show traffic, error rate, latency, auth, payments, loans, notifications, sync, workers, and provider callbacks.

## Rollout

- Stage 1: staging signoff with seeded data and sandbox providers.
- Stage 2: internal dogfood using production-like infra and limited real devices.
- Stage 3: limited production cohort with named support contacts.
- Stage 4: public launch only after seven days without unresolved P0/P1 incidents.

## Incident Severity

- P0: customer funds, auth bypass, data leak, production outage, destructive data corruption, or provider-wide payment failure. Page engineering and leadership immediately; pause onboarding, payouts, lending, and public rollout.
- P1: major workflow blocked for a customer segment, elevated payment/webhook failures, mobile release crash, or degraded API availability. Assign owner within 30 minutes; public launch clock resets.
- P2: isolated workflow defect with workaround, dashboard/reporting issue, or non-critical notification delay. Triage within one business day.
- P3: cosmetic, documentation, or low-risk internal tooling issue.

## Rollback

- Roll back API to the last healthy image and pause migrations if schema rollback is not verified.
- Disable new mobile updates through EAS if a native issue is found; keep prior production builds available.
- Pause onboarding and lender actions for P0/P1 issues in auth, KYC, payments, loans, sync, or invoice generation.
- Reconcile queued offline records before asking affected users to log out or reinstall.
- For provider incidents, disable the affected provider flag or route, stop retry storms, preserve webhook payloads, and reconcile payments before reopening the flow.
- For DB migration issues, stop rollout, keep the previous API image running if compatible, restore from snapshot only after explicit incident commander approval, and document whether forward-fix or restore was chosen.
