# Lender API & Web Dashboard — Gap Analysis & Implementation Plan

**Date:** 2026-06-06  
**Scope:** `api/apps/api/modules/lender/`, `api/apps/api/modules/credit/`, `Web/src/app/lender/`, `Web/src/hooks/lender/`

---

## 1. What Currently Exists

### 1.1 Backend API Endpoints (`/api/v1/lender/...`)

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/lender/auth/token` | POST | None | Machine-to-machine: API key → 1-hour JWT |
| `/lender/auth/login` | POST | None | Portal: email/password → JWT or reset token |
| `/lender/auth/reset-password` | POST | Reset token | First-login password change |
| `/lender/businesses` | GET | Lender JWT | List consented business refs (anonymized SHA-256 strings only) |
| `/lender/credit-profiles/{ref}` | GET | Lender JWT | Anonymized credit profile for a business |
| `/lender/products` | GET/POST | Lender JWT | List and create loan products |
| `/lender/products/{id}` | PATCH/DELETE | Lender JWT | Update or soft-deactivate a product |
| `/lender/consent` | GET/POST | User JWT | Business grants/lists lender consents |
| `/lender/consent/{lender_id}` | DELETE | User JWT | Business revokes a consent |
| `/lender/loans` | GET | Lender JWT | List pending pool + assigned loans |
| `/lender/loans/{id}/approve` | POST | Lender JWT | Approve a loan with terms |
| `/lender/loans/{id}/reject` | POST | Lender JWT | Reject a loan with reason |
| `/lender/loans/{id}/installments` | GET | Lender JWT | Repayment schedule for an assigned loan |
| `/lender/analytics` | GET | Lender JWT | Full portfolio analytics (KPIs, charts, queue) |
| `/lender/revenue/summary` | GET | Lender JWT | Totals by status |
| `/lender/revenue` | GET | Lender JWT | Revenue ledger rows (paginated) |
| `/lender/me` | GET | Lender JWT | Lender profile & settlement status |
| `/lender/settings` | PATCH | Lender JWT | Update webhook URL only |

### 1.2 Admin-Side Lender APIs (`/api/v1/admin/...`)

- `GET /admin/lenders` — list all lender partners
- `POST /admin/lenders` — create lender (generates API key + temp password)
- `PATCH /admin/lenders/{id}` — update name, email, active status, rotate API key
- Paystack subaccount provisioning integrated into `LenderService`
- `GET /admin/lender-revenue` + `GET /admin/lender-revenue/summary` — platform revenue view

### 1.3 Web Dashboard Pages (`/lender/...`)

| Route | Status | Notes |
|---|---|---|
| `/lender/login` | ✅ Functional | Email/password with error handling and redirect |
| `/lender/reset-password` | ✅ Functional | First-login password change flow |
| `/lender/dashboard` | ✅ Functional | KPI cards, action cards, disbursement bar chart, sector breakdown, repayment health |
| `/lender/loans` | ✅ Functional | Loan queue, detail panel with tabs (overview/KYC/schedule), approve/reject forms |
| `/lender/businesses` | ✅ Functional | Anonymized business list, side-panel credit profile |
| `/lender/products` | ✅ Functional | CRUD for loan products with validation |
| `/lender/analytics` | ✅ Functional | Deeper analytics view re-using `useLenderDashboard` data |
| `/lender/revenue` | ✅ Functional | Revenue ledger with status filter |
| `/lender/settings` | ✅ Functional | Webhook URL editor, API key hint display, split status |

### 1.4 Security Architecture (What's in Place)

- Login lockout after 5 failures, 15-minute window (Redis-backed)
- Rate limiting on auth endpoints (slowapi)
- Passwords hashed with bcrypt (`hash_password`/`verify_password`)
- API key stored as hash, only last-4 hint visible
- Business IDs anonymized via `sha256(business_id + lender_id)` — per-lender, one-way
- API key expiry with rotation tracking

---

## 2. Bugs Found (Must Fix First)

### BUG-01 — Revenue Records Are Never Created (Critical)
**File:** `api/apps/api/modules/lender/service.py`, `confirm_repayment()` ~line 822

The `LenderLoanRevenue` ORM model has columns: `principal_amount`, `fee_rate_percent`, `fee_amount`, `business_id`.

The code that creates the revenue row passes: `disbursed_amount`, `platform_fee_percent`, `platform_fee_amount` — and omits `business_id`.

```python
# CURRENT (broken — wrong field names, missing business_id)
rev = LenderLoanRevenue(
    loan_request_id=loan.id,
    lender_id=loan.lender_id,
    disbursed_amount=loan.amount_approved,        # ← field doesn't exist
    platform_fee_percent=Decimal(...),             # ← field doesn't exist
    platform_fee_amount=platform_fee,             # ← field doesn't exist
    # business_id missing ← NOT NULL FK
)
```

Because it's wrapped in `except Exception: logger.warning(...)`, it silently fails every time. Revenue tables are always empty.

**Fix:**
```python
rev = LenderLoanRevenue(
    loan_request_id=loan.id,
    business_id=loan.business_id,                 # ← add this
    lender_id=loan.lender_id,
    principal_amount=loan.amount_approved,        # ← correct field name
    fee_rate_percent=Decimal(str(lender.platform_fee_percent)),
    fee_amount=platform_fee,                      # ← correct field name
)
```

### BUG-02 — Revenue Recorded in Wrong Place (Architecture)
Revenue creation is triggered in `confirm_repayment()`, which fires on each MoMo `charge.success` webhook. But `LenderLoanRevenue` has a `UNIQUE` constraint on `loan_request_id` — so only the first paid instalment would ever attempt (and fail silently for subsequent ones). Revenue should be recorded once at **disbursement confirmation**, not at each repayment.

**Fix:** Move revenue record creation to `confirm_disbursement()` in `credit/service.py`, where `loan.status` transitions to `active`.

### BUG-03 — Dual Webhook URL Fields (Data Integrity)
`LenderPartner.webhook_url` (set in settings) and `LoanRequest.lender_webhook_url` (set at approval time) are both used but inconsistently:
- `GET /lender/analytics` checks `partner.webhook_url` to report `webhook_configured`
- `_notify_lender_webhook()` uses `loan.lender_webhook_url`
- If a lender updates their webhook in settings, existing loans never receive that URL

**Fix:** Remove `lender_webhook_url` from `LoanRequest`. Always use `LenderPartner.webhook_url`. Migrate the per-loan field to use the partner's URL at notification time.

### BUG-04 — Credit Profile Frontend/Backend Mismatch (Data)
`AnonymizedCreditProfile` schema only returns: `lender_business_ref`, `score`, `band`, `max_loan_amount`, `account_age_days`, `revenue_band`, `repayment_history_summary`, `computed_at`.

The frontend hook (`useLenderCreditProfile`) expects `monthly_revenue[]`, `risk_indicators[]`, `kyc_status`, `consent_granted_at` — none of which come from the backend. These fall back to empty arrays and hardcoded defaults, making the credit profile panel on the businesses page show empty charts and placeholder data.

**Fix:** Either extend `AnonymizedCreditProfile` to include these fields, or document clearly that they're intentionally omitted and update the UI to not imply they exist.

### BUG-05 — `lender_webhook_url` Not Saved at Approval Time
`approve_loan()` accepts `body.lender_webhook_url` and passes it to `CreditService.lender_approve()`, which only saves it if provided. But there is no validation that the URL is a valid HTTPS URL, and the field is silently ignored if the lender doesn't supply it at approval time.

---

## 3. Missing API Features (Gaps)

### GAP-01 — No JWT Refresh for Portal Users
Lender portal JWTs expire in 1 hour with no refresh mechanism. After expiry, every API call returns 401 but the frontend doesn't detect this and redirect to login — it just shows error states. Portal users have to manually navigate back to `/lender/login`.

**Fix:** Add `POST /lender/auth/refresh` that accepts an existing valid or near-expired token and returns a new one. Add a 401 interceptor in `apiClient` (axios) to redirect to login.

### GAP-02 — No Single Loan Detail Endpoint
`GET /lender/loans` returns a list. There is no `GET /lender/loans/{id}`. The detail panel in the loans UI already calls `useLoanInstallments` and `useLenderCreditProfile` separately, but cannot fetch the full loan object (approved amount, terms, rejection reason, etc.) without it being in the list response.

**Fix:** Add `GET /lender/loans/{id}` returning full `LoanRequestResponse` (with business ref, not raw business_id).

### GAP-03 — Businesses Endpoint Returns Raw Strings
`GET /lender/businesses` currently returns `{"items": ["sha256hex...", ...]}`. The frontend defensively handles "item is string" by fabricating display names. No useful data is returned beyond the hash.

**Fix:** Return a richer (but still anonymized) object:
```json
{
  "business_ref": "sha256...",
  "credit_band": "B",
  "account_age_days": 312,
  "has_active_loan": false,
  "consented_at": "2025-11-01T..."
}
```
No PII — business name, phone, owner details are never included.

### GAP-04 — No Webhook Signature (Security)
Outbound webhooks have no HMAC signature header. Lenders cannot verify that events came from SMEFlow — anyone who knows the webhook URL can POST fake events.

**Fix:** Generate a per-lender webhook secret at partner creation. Sign all outbound webhook payloads:
```
X-SMEFlow-Signature: sha256=HMAC(secret, json_body)
X-SMEFlow-Timestamp: 1717689600
```
Expose the secret hint in `/lender/me` and `settings` page.

### GAP-05 — No Webhook Delivery Retry
`_notify_lender_webhook()` makes a single synchronous HTTP call with a 10-second timeout. If the lender's server is down or slow, the event is permanently lost with only a warning log. No queuing, no retry, no dead-letter visibility.

**Fix:** Enqueue webhook delivery to a background task (Celery/ARQ) with exponential backoff (3 attempts: immediately, 5 min, 30 min). Add a `webhook_delivery_log` table for observability.

### GAP-06 — No Loan Pagination in the Frontend
`GET /lender/loans` supports `limit`/`offset` but the `useLenderLoans` hook fetches with default limit=50 and no pagination controls in the UI. A lender with 200+ loan requests will hit the cap invisibly.

**Fix:** Add server-side pagination (previous/next) to the loans page.

### GAP-07 — No Date Range Filter on Analytics
`GET /lender/analytics` hardcodes 6-month lookback for charts. There is no query parameter to change the window.

**Fix:** Accept `from_date` and `to_date` query params. Default to last 90 days. Add a date range picker to both analytics pages.

### GAP-08 — No Consent Lender Name Resolution
When a business views their active lender consents (`GET /lender/consent`), they receive:
```json
[{"lender_id": "microbank_gh", "is_active": true, ...}]
```
There is no `name` field. The merchant-facing UI (not yet built) needs to show a human-friendly lender name. The backend should join `LenderConsent` with `LenderPartner` to include `name`.

### GAP-09 — No Webhook Test Endpoint
Lenders have no way to verify their webhook URL is reachable before going live.

**Fix:** Add `POST /lender/settings/test-webhook` that sends a synthetic `webhook.test` event to the configured URL and returns the response status.

### GAP-10 — Settings Too Limited
`PATCH /lender/settings` only accepts `webhook_url`. Lenders cannot self-update their `contact_email`, notification preferences, or portal password.

**Fix:**
- Add `contact_email`, `current_password`, `new_password` to settings PATCH
- Validate current_password before allowing password change

---

## 4. Dashboard UX Gaps

### UX-01 — No 401 Redirect
When the lender JWT expires, API calls fail but the UI only shows error retry banners. There is no interceptor to detect 401 and redirect to `/lender/login`.

### UX-02 — Auth Store Not Persisted
`useLenderAuth` (Zustand) stores `lender_id` and `role` in memory. On page refresh, the store is empty even though the `lender_token` cookie is still valid. Pages protected by cookie check still load, but anything reading from the auth store (e.g., displaying the lender's name from the store) shows blank.

**Fix:** Persist the Zustand store to `sessionStorage`, or remove the store entirely and always derive identity from `/lender/me`.

### UX-03 — Analytics / Dashboard Duplication
`/lender/dashboard` and `/lender/analytics` both call `useLenderDashboard()` (same API endpoint). Dashboard shows KPIs + disbursement chart + sector pie. Analytics re-shows the same KPIs + the same charts + a few more. This is confusing navigation.

**Fix:** Merge them or clearly differentiate: Dashboard = operational actions, Analytics = deep historical reporting.

### UX-04 — No In-App Notifications
New loan requests are only surfaced when the lender refreshes the dashboard. There is no real-time alert (badge, toast, push) when a new loan enters the pending pool.

**Fix (short term):** Poll `/lender/analytics` every 60 seconds (already done at 120s). Add a notification badge on the nav item when `pending_loan_requests > 0`. Long term: SSE or WebSocket push.

### UX-05 — Revenue Ledger Shows Raw `business_id`
The revenue page table shows `business_id` as a raw UUID. This is not useful (lender can't identify the business) and is inconsistent with the rest of the portal which uses anonymized refs.

**Fix:** Replace `business_id` column with the anonymized `business_ref` in the revenue API response.

### UX-06 — No Export
Lenders cannot download their revenue ledger or loan history as CSV/PDF for accounting purposes.

**Fix:** Add `GET /lender/revenue/export?format=csv` and a download button on the revenue page.

### UX-07 — Empty States Are Unclear
New lender accounts land on dashboard showing all zeroes. There's no onboarding checklist or empty state explaining the required setup steps (create products → businesses consent → review loans).

**Fix:** Add a first-run banner or setup checklist visible when `active_products == 0`.

---

## 5. Implementation Plan

### Phase 1 — Bug Fixes (Do This Week)

**P1-1: Fix revenue record creation** (`service.py`)
- Correct field names in `LenderLoanRevenue` construction
- Add `business_id=loan.business_id`
- Move revenue creation to `confirm_disbursement()` in credit service
- Add migration if needed (no schema change, just data flow fix)
- Write unit test for revenue row creation

**P1-2: Consolidate webhook URL** (`models.py`, `credit/service.py`)
- Remove `lender_webhook_url` from loan creation flow
- Update `_notify_lender_webhook()` to always look up `LenderPartner.webhook_url`
- Add Alembic migration to drop the column (after confirming no active usage)

**P1-3: Fix credit profile schema** (`lender/schemas.py`, frontend hook)
- Either add `monthly_revenue`, `risk_indicators`, `kyc_status` to `AnonymizedCreditProfile` (pull from credit score factors + KYC module)
- Or remove those fields from the frontend hook and replace with accurate fallback UI

**P1-4: Add 401 interceptor** (`Web/src/lib/api.ts`)
- Add axios response interceptor: on 401, clear the lender cookie and redirect to `/lender/login`
- Test with an expired token

---

### Phase 2 — Core API Completeness (Next 2 Weeks)

**P2-1: JWT Refresh** (`lender/router.py`)
- `POST /lender/auth/refresh` — verify token, issue new one with fresh expiry
- Update frontend to call refresh 5 minutes before expiry (use `setTimeout` based on `exp` claim)

**P2-2: Single loan detail** (`lender/router.py`)
- `GET /lender/loans/{loan_id}` — return full loan detail with anonymized business_ref
- Hook up to the detail panel so it fetches fresh data on open

**P2-3: Richer businesses endpoint** (`lender/service.py`, `lender/router.py`)
- Change `list_consented_businesses()` to return objects: `{business_ref, credit_band, account_age_days, has_active_loan, consented_at}`
- No PII — join with `CreditScore` and `LoanRequest` counts only
- Update `useLenderBusinesses` hook to consume the new shape

**P2-4: Consent name resolution** (`lender/router.py`)
- `GET /lender/consent` response should include `lender_name` (join with `LenderPartner`)
- Needed by the merchant-facing consent management UI

**P2-5: Settings improvements** (`lender/router.py`)
- Extend `PATCH /lender/settings` to accept `contact_email` and password change fields
- Add password change validation (require `current_password`)

**P2-6: Revenue ledger fix** (`lender/router.py`)
- Replace `business_id` with anonymized `business_ref` in revenue row responses
- Add `loan_ref` (short display ID) alongside `loan_request_id`

---

### Phase 3 — Security & Reliability (2–4 Weeks)

**P3-1: Webhook HMAC signing** (`credit/service.py`, `lender/models.py`)
- Add `webhook_secret` column to `LenderPartner` (generated at creation, `lf_whsec_[random]`)
- Sign all outbound payloads with `HMAC-SHA256`
- Add `X-SMEFlow-Signature` and `X-SMEFlow-Timestamp` headers
- Expose secret (masked) in settings page with a "Reveal" button

**P3-2: Webhook retry queue** (`libs/event_bus/` or new worker)
- Move `_notify_lender_webhook()` to a background task
- Use ARQ or Celery with retry policy: 0s, 5min, 30min
- Add `LenderWebhookDelivery` table: `{lender_id, event, payload, attempt_count, status, last_error, delivered_at}`
- Expose delivery log in admin and settings page

**P3-3: Webhook test endpoint** (`lender/router.py`)
- `POST /lender/settings/test-webhook` — sends `{"event": "webhook.test", ...}` to configured URL
- Returns `{status: "delivered"|"failed", http_status: 200, latency_ms: 142}`

**P3-4: API key rotation self-service** (`lender/router.py`)
- `POST /lender/auth/rotate-key` — lender requests key rotation with current password
- Returns new key (one-time display), invalidates old key immediately
- Audit log entry

---

### Phase 4 — Analytics & Polish (4–6 Weeks)

**P4-1: Date range on analytics**
- Backend: add `from_date`, `to_date` query params to `GET /lender/analytics`
- Frontend: date range picker on analytics page

**P4-2: Loans page pagination**
- Frontend: add "Load more" or page controls using existing `limit`/`offset` params
- Backend: add `total` count to loans list response

**P4-3: Dashboard first-run UX**
- Show setup checklist when `active_products == 0` and `consented_businesses == 0`
- Steps: 1) Create a product → 2) Share your lender ID with merchants → 3) Review your first loan

**P4-4: Revenue CSV export**
- Backend: `GET /lender/revenue/export` streaming CSV response
- Frontend: export button on revenue page

**P4-5: Pending loan badge**
- Persist last-seen `pending_loan_requests` count in `sessionStorage`
- Show red badge on "Loans" nav item when count increases

**P4-6: Merge analytics into dashboard**
- Remove `/lender/analytics` as a separate route
- Expand `/lender/dashboard` with a toggle: "Operations" / "Portfolio analytics"
- Reduces nav clutter and data duplication

---

## 6. Priority Matrix

| Item | Impact | Effort | Priority |
|---|---|---|---|
| P1-1 Fix revenue creation bug | Revenue data broken | Low | 🔴 Do now |
| P1-2 Consolidate webhook URL | Data integrity | Low | 🔴 Do now |
| P1-3 Fix credit profile mismatch | UX misleads | Low | 🔴 Do now |
| P1-4 401 redirect | Auth UX broken | Low | 🔴 Do now |
| P2-1 JWT refresh | Session reliability | Medium | 🟡 Week 2 |
| P2-2 Single loan detail | Feature completeness | Low | 🟡 Week 2 |
| P2-3 Richer businesses endpoint | UX/data quality | Medium | 🟡 Week 2 |
| P3-1 Webhook HMAC | Security | Medium | 🟡 Week 3 |
| P3-2 Webhook retry queue | Reliability | High | 🟡 Week 3 |
| P3-3 Webhook test | DX/UX | Low | 🟢 Week 4 |
| P2-5 Settings improvements | Self-service | Low | 🟢 Week 4 |
| P4-1 Date range analytics | Reporting | Medium | 🟢 Month 2 |
| P4-3 First-run UX | Onboarding | Medium | 🟢 Month 2 |
| P4-4 Revenue CSV export | Accounting | Medium | 🟢 Month 2 |

---

## 7. Testing Gaps

| Coverage | Current State |
|---|---|
| Lender portal auth (login/reset) | ✅ `test_lender_portal_auth.py` exists |
| Admin lender agent commands | ✅ `test_admin_agent_lender.py` exists |
| Loan approval/rejection flow | ❌ No integration test |
| Credit profile anonymization | ❌ No unit test for SHA-256 ref logic |
| Revenue record creation | ❌ No test (and the code is broken) |
| Webhook delivery | ❌ No test |
| Consent grant/revoke | ❌ No integration test |
| JWT expiry handling | ❌ No test |

All of Phase 1 fixes should ship with tests. Minimum: integration tests for the loan lifecycle (request → approve → disburse → repay → revenue recorded).

---

## 8. Summary

The lender system has a solid structural foundation — the auth model, anonymization approach, product management, and analytics pipeline are well-designed. The main problems are:

1. **One critical silent bug** (BUG-01/02) means revenue records have never been created. This is the most urgent fix.
2. **Webhook delivery is fire-and-forget** with no retry or signature — not production-grade for a financial platform.
3. **The frontend shows placeholder data** for credit profiles because the backend schema doesn't return what the UI expects.
4. **The portal session handling is fragile** — no JWT refresh, no 401 intercept, auth store not persisted.
5. **Several small but impactful API gaps** (single loan detail, richer business list, consent names) that make the lender experience feel incomplete.

Phases 1 and 2 are the minimum bar for a professional lender-facing product. Phases 3 and 4 bring it to the standard expected by a financial institution partner.
