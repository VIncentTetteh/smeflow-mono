# SMEflow Controlled Pilot Readiness Runbook

## Pilot Scope

- Pilot audience: 5-20 invited Ghanaian SMEs with named support contacts.
- Supported customer clients: native Android and iOS pilot builds.
- Web status: dev smoke/bundling is maintained for engineering, but web is not a customer-supported pilot surface until a full browser QA pass is signed off.
- Deferred depth: payroll, tax, referrals, premium analytics, and broad admin workflows remain limited unless needed by a named pilot customer.

## Required Sign-Off Gates

- Mobile: `npm test -- --runInBand --watchman=false` and `npx tsc --noEmit`.
- Backend fast gate: `uv run pytest apps/api/tests/unit -q` must pass.
- Backend integration gate: `uv run pytest apps/api/tests/integration -q` must pass.
- Backend coverage gate: `uv run pytest apps/api/tests/unit apps/api/tests/integration --cov=apps/api --cov-report=term-missing --cov-fail-under=80` must pass before customer expansion.
- Native smoke: OTP, onboarding, KYC, add item, barcode scan, cash sale, MoMo sale, offline sale sync, invoice send/share, notification registration.
- Provider smoke: MTN MoMo sandbox, Paystack webhook signature, AfricasTalking delivery callback, Hubtel verification if enabled, USSD callback if included.
- Operations: Sentry DSNs configured, `/metrics` enabled, API readiness probes passing, database backup/restore tested.

## Customer Support Playbooks

- OTP failure: confirm phone format, check SMS provider dashboard, retry request after cooldown, and verify `/api/v1/auth/otp/request` rate-limit status.
- Payment pending: check provider reference, webhook delivery, payment row status, and customer phone/provider mapping before retrying collection.
- Failed sync: inspect the mobile sync status snapshot, pending count, table errors, and last successful sync; avoid logout until local queued sales are accounted for.
- Wrong invoice: void the invoice, issue credit/debit note when applicable, and resend the corrected PDF/link.
- Account recovery: use authenticated phone-change flow when possible; otherwise escalate to manual identity verification.
- KYC rejection: record the rejection reason, confirm Ghana Card/TIN/business reference, and resubmit only after corrected details are available.

## Low-Stock Alert Decision

For the controlled pilot, low-stock detection is visible in-app and can be reviewed by support. Automated WhatsApp/SMS low-stock alerts are manual-support only until the notification channel contract is confirmed and provider smoke tests pass.

## Monitoring Checklist

- API 5xx rate and latency.
- OTP request/verify failures.
- Sale recording failures by payment method.
- Payment webhook verification failures.
- Invoice generation/send failures.
- Sync failures and pending queued record count.
- KYC submission/rejection rate.
- Mobile analytics events: onboarding completed, first item added, first sale recorded, invoice sent, payment requested, sync failed, KYC submitted.

## Rollback

- Keep pilot users on internal distribution builds.
- If a P0/P1 issue affects sale recording, payments, invoices, inventory sync, auth, or KYC, pause onboarding new customers.
- Roll back API deployment through the last healthy image and keep mobile users on the prior internal build while support reconciles pending local data.
