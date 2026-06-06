# SMEflow Admin — Gap Analysis & Implementation Plan

**Date:** June 2026  
**Scope:** Backend admin API (`api/apps/api/modules/admin/`) and web dashboard (`Web/src/app/admin/`)

---

## 1. What Is Already There

### 1.1 Backend API

**Authentication & Security**
- `POST /admin/auth/login` — email + password + optional TOTP → 1-hour JWT
- `POST /admin/auth/totp/enroll` / `confirm` — TOTP enroll and activate
- IP allowlist enforcement (global `ADMIN_ALLOWED_IPS` env var + per-admin list)
- Session fingerprint (IP + User-Agent bound to token)
- Constant-time password comparison to prevent timing attacks

**Business Management**
- `GET /admin/businesses` — paginated list with name search + is_active filter
- `GET /admin/businesses/{id}` — full cross-tenant detail (members, billing, sales, KYC)
- `POST /admin/businesses/{id}/suspend` / `unsuspend` — TOTP-gated
- `PATCH /admin/businesses/{id}/subscription` — tier change, TOTP-gated

**Credit & Loans**
- `POST /admin/credit/override` — routes through two-person pending-action workflow
- `GET /admin/loans` — status-filtered cross-tenant loan list
- `POST /admin/loans/{id}/action` — approve / reject / flag, TOTP-gated
- `GET /admin/pending-actions` — two-person approval queue
- `POST /admin/pending-actions/{id}/approve` — second-admin approval

**Lender Management**
- `GET /admin/lenders` — list all partners
- `POST /admin/lenders` — create partner + issue API key + temporary password
- `PATCH /admin/lenders/{id}` — update name/email/status; deactivation routes through pending-action

**Agent Management**
- `GET /admin/agents` — paginated list with region filter
- `POST /admin/agents` — create agent directly (TOTP-gated)
- `PATCH /admin/agents/{id}` — update profile/region/active status
- `DELETE /admin/agents/{id}` — blocked if any commission/referral records exist
- `GET /admin/agents/health` — real-time network health summary
- `GET /admin/agents/applications` — pending applications queue
- `POST /admin/agents/applications/{id}/approve` / `reject` — TOTP-gated
- `GET /admin/agents/{id}/commissions` — per-agent commission list
- `PUT /admin/agents/{id}/commissions/{id}/mark-paid` — single commission settlement
- `GET /admin/agent-commissions/report` — month-level reconciliation by trigger/status
- `GET /admin/commission-rates` / `PUT` — configurable payout rates

**KYC**
- `GET /admin/kyc/queue` — combined business + user KYC submissions
- `POST /admin/kyc/{business_id}/review` — approve / reject business KYC
- `POST /admin/kyc/users/{user_id}/review` — approve / reject user KYC

**Finance & Payments**
- `GET /admin/lender-revenue` + `/summary` — platform fee revenue tracking
- `POST /admin/lender-revenue/{id}/mark-paid` — reconciliation
- `GET /admin/payments/settlements` — MoMo settlement aggregates by provider
- `GET /admin/payments/dva` — inbound DVA / bank-transfer collections
- `GET /admin/transactions` — cross-tenant transaction browser

**Merchant Settlements (via settlements admin_router)**
- `GET /admin/settlements` + `/summary` + `/pending`
- `POST /admin/settlements/trigger` — kick off auto-settlement run
- `POST /admin/settlements/{id}/approve` / `bulk-approve` / `cancel` / `retry`
- `GET /admin/settlements/merchants/{id}/balance` — wallet + recent ledger
- `POST /admin/settlements/merchants/{id}/settle` — force-settle
- `PATCH /admin/settlements/merchants/{id}/settlement-config` — pause/resume/threshold

**Monitoring & Compliance**
- `GET /admin/metrics` + `/analytics/kpis` — platform KPI dashboard
- `GET /admin/provider-readiness` — provider configuration smoke test
- `GET /admin/fraud-queue` — high-velocity business detection
- `GET /admin/sync/queue` — offline-sync monitoring
- `GET /admin/audit-logs` — immutable event log with filters
- `GET /admin/appeals` — suspension appeal queue

---

### 1.2 Web Dashboard

| Route | What It Does |
|---|---|
| `/admin/login` | Email + password + TOTP login flow |
| `/admin/dashboard` | KPI row, KYC pipeline, agent health, sync queue, MoMo settlements, audit activity, fraud signals |
| `/admin/businesses` | List + search, suspend/unsuspend, tier change |
| `/admin/businesses/[id]` | Business detail: info, billing, members, KYC status, suspend/plan actions |
| `/admin/kyc` | Review queue table — approve / reject with reason |
| `/admin/agents` | Full CRUD: create (form + TOTP), edit, deactivate, delete; commission drilldown |
| `/admin/commissions` | Per-agent commission list, mark paid |
| `/admin/loans` | Status-filtered table, approve / reject / flag modals with TOTP |
| `/admin/lenders` | List, create (TOTP), toggle active |
| `/admin/lender-revenue` | Revenue list + summary, mark paid, Paystack subaccount setup |
| `/admin/settlements` | Settlement queue, bulk approve, cancel/retry, merchant wallet controls |
| `/admin/risk` | Fraud signals list with severity |
| `/admin/ops` | 7-tab hub: money / transactions / DVA / appeals / pending-actions / lender-revenue / readiness |
| `/admin/payouts` | Loan disbursements (disburse / retry) + agent payout batches |
| `/admin/notifications` | Audit log re-skinned as a notification feed |
| `/admin/settings` | Commission rate editor |
| `/admin/audit` | Full audit log with action filters and pagination |
| `/admin/security/mfa` | TOTP QR code setup and confirmation |

**Hooks / API layer**
- `useAdminData` — KPIs, businesses, loans, suspend/unsuspend, loan actions
- `useAdminMoney` — settlements, lender revenue, payouts, disbursements
- `useAdminPeople` — agents, lenders, applications
- `useAdminQueues` — KYC queue, review mutation, audit logs, fraud signals, sync/settlements

---

## 2. Gaps

### 2.1 Backend (API) Gaps

#### Critical

| # | Gap | Impact |
|---|---|---|
| B1 | **No HTTP endpoints for admin account management** — `create_platform_admin` and `deactivate_platform_admin` exist in the service but are never exposed in the router. Admin creation requires direct DB access via `scripts/seed_admin.py`. | Can't manage admin team without server access |
| B2 | **No `GET /admin/admins` endpoint** — impossible to list active admin accounts from the UI | No visibility into who has admin access |
| B3 | **No appeal resolution endpoints** — `GET /admin/appeals` exists but there is no `POST /admin/appeals/{id}/approve` or `reject`. Appeals are listed but can never be actioned via API. | Appeal queue is read-only; useless |
| B4 | **KYC review not TOTP-gated** — approving/rejecting KYC is a high-impact action that skips the TOTP check present on loans, suspensions, and credit overrides | Security inconsistency on a compliance-critical action |
| B5 | **No token refresh** — the 1-hour admin JWT cannot be refreshed; admins are forced to re-authenticate every hour including mid-task | Disruptive UX; session interrupts mid-workflow |

#### High Priority

| # | Gap | Impact |
|---|---|---|
| B6 | **Fraud-queue has no pagination** — returns `items` + `count` but no `limit`/`offset`; large queues are unbounded | Performance + scalability risk |
| B7 | **`/admin/kyc/queue` returns no total count** — returns a list, not a `{total, items}` shape; pagination is impossible on the frontend | Can't show accurate pending count |
| B8 | **No loan-level detail endpoint** — `GET /admin/loans` returns a list, no `GET /admin/loans/{id}`. Loan approve/flag goes on incomplete data. | Can't deep-dive on a single loan before acting |
| B9 | **No bulk commission mark-paid** — only single commission mark-paid; agent payout reconciliation requires N individual calls | Ops inefficiency for high-volume agents |
| B10 | **Appeals response has no count field** — `list_suspension_appeals` has limit/offset params but the response dict has no `total` key | Pagination counter broken |
| B11 | **Loan approval is not two-person for high amounts** — only `credit_override` and `lender_deactivate` go through the pending-action workflow; a large loan approval is a single TOTP check | Insufficient control for large disbursements |
| B12 | **`/admin/agents/applications` route ordering ambiguity** — this static route is registered after the `{agent_id}` dynamic route, risking FastAPI matching `applications` as an agent UUID in some router registration orders | Potential 422/404 on agent application endpoints |

#### Medium Priority

| # | Gap | Impact |
|---|---|---|
| B13 | **No CSV/Excel export endpoints** — no export for loans, transactions, audit logs, commission reports | Finance team can't export for reconciliation |
| B14 | **No platform settings endpoint** — platform fee rates, feature flags, and system config are only in environment variables; no live admin API | Config changes require redeployment |
| B15 | **IP allowlist is static** — per-admin `allowed_ips` must be set at creation; no `PATCH /admin/admins/{id}/ip-allowlist` to update | Ops friction when admin IPs change |
| B16 | **No DVA manual confirmation endpoint** — DVA payments are viewable but can't be manually confirmed/reconciled through the API | Gaps in payment ops tooling |
| B17 | **No admin audit trail for admin-on-admin actions** — the audit log captures business-scoped events; admin account creation/deactivation has no audit record beyond structlog | Compliance blind spot |
| B18 | **`GET /admin/agents` has no name/phone search** — only `region` filter; searching for a specific agent requires full list scan on the frontend | Poor ops UX at scale |
| B19 | **`GET /admin/businesses` search is name-only** — no search by phone, email, TIN, or business ID | Support team can't look up businesses by contact info |

---

### 2.2 Frontend (Dashboard) Gaps

#### Critical

| # | Gap | Impact |
|---|---|---|
| F1 | **`window.prompt()` used for TOTP input** in `businesses/page.tsx` — browser native prompt is not secure, not styleable, blocked in some CSP contexts, and confusingly appears outside the app chrome | Insecure and unprofessional |
| F2 | **No admin account management UI** — no way to create, list, or deactivate other platform admins | Admin team management requires server access |
| F3 | **Appeal queue is display-only** — appeals are shown in the `/admin/ops` tab but there are no approve/reject buttons (matches the backend gap B3) | Merchants with valid appeals are stuck |
| F4 | **Notifications page is a misleading re-skin of the audit log** — it formats audit log entries as "notifications" rather than being an actual alert inbox for actionable events (new KYC, fraud signal, loan request) | Misleads operators; real alerts are missed |

#### High Priority

| # | Gap | Impact |
|---|---|---|
| F5 | **No pagination on `/admin/loans`** — fetches all loans at once with no pagination controls | Breaks at scale |
| F6 | **No pagination on `/admin/agents`** — same issue | Breaks at scale |
| F7 | **No agent applications UI** — the backend has a full application review workflow (list/approve/reject) but there is no frontend page for it | Agent onboarding approval is invisible |
| F8 | **Settings page only has commission rates** — missing platform fee config, admin account management, notification templates, system flags | Settings is nearly empty |
| F9 | **Audit log filter is limited** — UI only filters by action string; the API supports `business_id`, `from_dt`, `to_dt` but no date range picker or business filter exists in the UI | Compliance investigations are difficult |
| F10 | **KYC review dialog shows no documents** — the review modal shows Ghana Card ID and TIN as text fields but no document viewer, thumbnail, or link to uploaded files | Reviewers are approving KYC blind |
| F11 | **No real-time alerts** — no WebSocket or SSE subscription to flag when new KYC submissions or fraud signals arrive; admins must manually refresh | High-severity events are missed |
| F12 | **`/admin/ops` is overloaded** — 7 tabs in a single page (money, transactions, DVA, appeals, pending, revenue, readiness) creates a cluttered and hard-to-navigate hub | Poor information architecture |

#### Medium Priority

| # | Gap | Impact |
|---|---|---|
| F13 | **No export / download buttons anywhere** — no way to download reports from the UI | Finance team workaround is screenshots |
| F14 | **No breadcrumb navigation** — navigating deep into a business detail or agent commission view gives no context of where you are | UX confusion |
| F15 | **Security/MFA page is unreachable from nav** — only accessible via direct URL `/admin/security/mfa`; not linked from settings or the sidebar | Admins can't find how to set up MFA |
| F16 | **Business detail page is thin** — shows basic fields but does not render the transaction history (sales.count / sales.tpv_ghs) or member list in a usable way | Detail view doesn't justify the click |
| F17 | **No confirmation modal for agent delete** — uses `window.confirm()` (native browser dialog) instead of an in-app modal | Inconsistent with rest of UI |
| F18 | **Page search doesn't reset pagination** — typing in the business search while on page 3 keeps the offset; shows zero results | Broken pagination UX |
| F19 | **`/admin/dashboard` KYC queue shows `—` for Location and Agent** — these columns are hardcoded to `'—'`; the API does return region data | Wasted columns, dead UI |
| F20 | **No loading/error boundary on individual dashboard widgets** — if one panel's data fetch fails, there's no per-panel error state; the whole dashboard silently shows empty | Silent failures in prod |

---

## 3. Implementation Plan

Priority order: security holes first, then broken/missing flows, then UX polish and exports.

---

### Sprint 1 — Fix Security & Broken Flows (1–2 weeks)

**Goal:** Close all critical gaps. No go-live until these are done.

#### 1.1 Gate KYC review with TOTP (B4 + parallel frontend fix)

In `admin/router.py`, add `x_admin_totp: str | None = Header(None, alias="X-Admin-TOTP")` and `await _require_admin_totp(...)` to both `/kyc/{business_id}/review` and `/kyc/users/{user_id}/review`.

On the frontend, add a TOTP input field to the KYC review dialog in `kyc/page.tsx` — same pattern as the loan reject modal (Input + `X-Admin-TOTP` header).

#### 1.2 Replace all `window.prompt()` TOTP inputs (F1)

Audit every `window.prompt(...)` call. Found in `businesses/page.tsx`. Replace with a reusable `<TotpDialog>` component:

```
Web/src/components/admin/TotpDialog.tsx
```

The component receives `onConfirm(code: string)`, renders the same TOTP input pattern already in `loans/page.tsx`, and is imported everywhere a TOTP prompt is needed. Remove all `window.prompt()` and `window.confirm()` calls across the admin section.

#### 1.3 Add admin account management endpoints (B1, B2)

In `admin/router.py`, expose the existing service methods:

```
GET  /admin/admins                — list active admins (id, email, totp_enabled, last_login_at, created_at)
POST /admin/admins                — create admin (email, password, allowed_ips) — requires TOTP + pending-action approval
POST /admin/admins/{id}/deactivate — deactivate (TOTP-gated, pending-action)
```

The `create_platform_admin` and `deactivate_platform_admin` methods already exist in `AdminService`; they just need router wrappers. Route both through `request_pending_action` since they are the highest-impact admin actions.

#### 1.4 Add appeal resolution endpoints (B3)

Add to `admin/router.py`:

```
POST /admin/appeals/{appeal_id}/approve  — marks appeal.status = "approved", unsuspends business
POST /admin/appeals/{appeal_id}/reject   — marks appeal.status = "rejected" with reason
```

Add `reason: str | None` and `reviewed_by: UUID` fields to the `SuspensionAppeal` model (migration `0045_appeal_resolution.py`). Wire up the approve path to call `AdminService.unsuspend_business`.

Fix the `list_suspension_appeals` response to include `total` count (one-line fix in the return dict).

#### 1.5 Add admin token refresh (B5)

Add `POST /admin/auth/refresh` which accepts the current valid token and returns a new one (reset expiry to +1 hour). The endpoint validates the existing token is not expired and the fingerprint still matches. On the frontend, set up an axios response interceptor in `lib/api.ts` that on 401 attempts one refresh before redirecting to login.

---

### Sprint 2 — Complete Missing Workflows (1–2 weeks)

**Goal:** Everything that exists on the backend has a working frontend, and vice versa.

#### 2.1 Build agent applications page (F7)

Create `Web/src/app/admin/(app)/agents/applications/page.tsx`. Fetch from `GET /admin/agents/applications` (status filter: pending/approved/rejected). Show applicant phone, region, district, MoMo phone, submitted date. Approve/reject buttons with TOTP — same pattern as KYC review. Add a nav link in `AdminNav.tsx` under Agents.

#### 2.2 Fix KYC queue shape and add document preview (B7, F10)

**Backend:** Change `kyc_queue` to return `{ total: int, items: [...] }` instead of a bare list. This is a one-line change to the return statement (add `total: len(combined)` or run a proper count query).

**Frontend:** The review dialog currently shows Ghana Card ID and TIN as plain text. Extend it to show:
- The `documents` dict from `KYCVerification` rendered as clickable links (S3/GCS signed URLs or whatever storage is used).
- A `scope` badge (Business KYC vs User KYC).
- Submitted-at timestamp.
- TOTP input field (fixing B4 from Sprint 1).

#### 2.3 Add pagination to loans and agents pages (F5, F6)

**Loans:** The API already supports `limit`/`offset`. Add a `page` state variable and pagination controls (prev/next + total count) to `loans/page.tsx`. Default limit: 25.

**Agents:** Same pattern. The API returns `{ total, items }` already. Add page state and controls to `agents/page.tsx`.

#### 2.4 Add search to agents API and frontend (B18)

**Backend:** Add `search: str | None = Query(None)` to `GET /admin/agents`. In the service, filter by `ILIKE %search%` on the joined `User.name` or `User.phone`.

**Frontend:** Add a search input above the agents table, same as the businesses page.

#### 2.5 Fix `window.confirm()` — agent delete (F17)

Replace the native browser confirm dialog for agent deletion with an in-app confirmation modal (reuse the `Dialog` component already imported in the agents page).

#### 2.6 Fix appeals UI — add approve/reject actions (F3)

The `/admin/ops` appeals tab already lists appeals. Add Approve and Reject buttons to each row, pointing at the new endpoints from Sprint 1 task 1.4. Show a reason input for rejection (same Textarea pattern as KYC reject).

#### 2.7 Add `GET /admin/loans/{id}` endpoint (B8)

Single-loan detail: return full loan fields plus business name (join to `Business`), lender name (join to `LenderPartner`), any associated `LenderLoanRevenue` row, and repayment schedule if available. Wire up a loan detail drawer/modal on the frontend loans page (clicking a row opens the drawer).

---

### Sprint 3 — UX & Information Architecture (1 week)

**Goal:** The dashboard is professional and navigable.

#### 3.1 Replace notifications page with a real alert inbox (F4)

The current `/admin/notifications` page fetches audit logs and relabels them as "notifications." Replace this with an actual actionable alert feed:

- Query `GET /admin/kyc/queue` (new submissions), `GET /admin/fraud-queue` (new signals), `GET /admin/pending-actions?status=pending` (awaiting second approval).
- Group into sections: **Action required** vs **Recent events**.
- Each item links directly to the relevant page (KYC → `/admin/kyc`, fraud → `/admin/risk`, pending action → `/admin/ops`).
- Add an unread count badge to the nav item.

#### 3.2 Expand Settings page (F8)

`settings/page.tsx` currently only has commission rates. Restructure it into sections:

- **Commission rates** — existing content, keep as-is.
- **Platform fees** — input for `platform_fee_percent` per lender (hook into `PATCH /admin/lenders/{id}`).
- **Admin accounts** — table listing active admins (from new `GET /admin/admins`) with deactivate button and "Add admin" sheet (calling `POST /admin/admins`). Link to MFA setup from here.
- **Security** — link to `/admin/security/mfa`; show current MFA status.

Add a route to `AdminNav.tsx` that links directly to MFA setup from within Settings (fixing F15).

#### 3.3 Break up the Ops page (F12)

The 7-tab `/admin/ops` page is too dense. Move dedicated content to their own pages and redirect the tabs:

- **Transactions** tab → keep as `/admin/ops` default (most-used)
- **DVA payments** tab → move to `/admin/payments/dva` (new page)
- **Appeals** tab → move to `/admin/appeals` (new page, from Sprint 2 task 2.6)
- **Pending actions** tab → move to `/admin/pending-actions` (new page)
- **Readiness** tab → move to `/admin/settings#readiness`
- Remove the **money** and **lender-revenue** tabs (these are already separate pages)

Update `AdminNav.tsx` to add the new nav entries.

#### 3.4 Add breadcrumb navigation (F14)

Create `Web/src/components/admin/Breadcrumb.tsx`. The component reads the Next.js pathname and renders a two-level breadcrumb (e.g. `Admin › Businesses › Kumasi Mart`). Add it to the topbar area in the admin `(app)/layout.tsx`.

#### 3.5 Fix business search + pagination reset (F18)

In `businesses/page.tsx`, add a `useEffect` that resets `page` to `1` whenever `search` changes:

```typescript
useEffect(() => { setPage(1); }, [search]);
```

#### 3.6 Fix dashboard KYC queue Location/Agent columns (F19)

The API currently does not return location/agent info in the KYC queue. Two options:
- **Quick fix:** Remove the Location and Agent columns from the dashboard KYC table since the data is unavailable.
- **Full fix:** Extend `kyc_queue` response with `region` from the associated `Business` and agent code from `OnboardingReferral`.

Recommended: quick fix now, full data in a later sprint.

#### 3.7 Add per-widget error states to dashboard (F20)

Each panel on `/admin/dashboard` currently has no error boundary. Wrap each data-dependent panel in a simple `try/error` display: if `isError`, show a small inline error with a "Retry" button (call `refetch()`). Use the existing `isError` flag from `useQuery`.

---

### Sprint 4 — Audit, Business Detail & Exports (1 week)

**Goal:** Compliance tools are production-ready.

#### 4.1 Extend audit log UI filters (F9)

The `GET /admin/audit-logs` API supports `business_id`, `from_dt`, `to_dt`, and `action` filters but the UI only exposes `action`. Add:

- **Date range picker** — two `<input type="date">` fields for `from_dt` and `to_dt`.
- **Business ID search** — text input; validate as UUID before sending.
- **Actor filter** — text input for partial email match (requires adding `actor_email` search to the backend query — a one-line `ILIKE` on a joined `PlatformAdmin.email`).

#### 4.2 Improve business detail page (F16)

`businesses/[id]/page.tsx` fetches `AdminBusinessDetail` which includes `sales.count`, `sales.tpv_ghs`, `members[]`, and `billing`. Render all of it:

- **Overview card** — name, type, TIN, KYC status, created date, region.
- **Billing card** — plan, status, current_period_end, Paystack subscription ID.
- **Sales card** — transaction count + TPV. Link to `/admin/ops?business_id={id}` to view individual transactions.
- **Members table** — user_id, role, is_active, joined_at.
- **Actions card** — suspend/unsuspend, tier change (with proper TotpDialog, not window.prompt).

#### 4.3 Add CSV export endpoints (B13)

Add `format: Literal["json", "csv"] = Query("json")` to the following endpoints:

```
GET /admin/loans?format=csv
GET /admin/transactions?format=csv
GET /admin/agent-commissions/report?format=csv
GET /admin/audit-logs?format=csv
GET /admin/lender-revenue?format=csv
```

When `format=csv`, return a `StreamingResponse` with `Content-Type: text/csv` and `Content-Disposition: attachment`. Use Python's `csv.DictWriter` streaming pattern.

On the frontend, add a **Download CSV** button to each corresponding page that opens the URL with `format=csv` and the current filters applied.

#### 4.4 Add agent applications count to nav badge

In `AdminNav.tsx`, fetch `GET /admin/agents/applications?status=pending` (limit=1, just need total) and show a count badge on the Agents nav item. Re-use the same pattern for the KYC pending count already planned in the notifications work.

---

### Sprint 5 — Resilience & Platform Config (ongoing)

#### 5.1 Fix route ordering for agent applications (B12)

In `admin/router.py`, ensure `GET /admin/agents/applications` is registered **before** `GET /admin/agents/{agent_id}`. FastAPI matches routes top-to-bottom; the static path must come first. Current file order already has `/applications` after `{agent_id}` — swap them.

#### 5.2 Add bulk commission mark-paid (B9)

Add `POST /admin/agents/{agent_id}/commissions/bulk-mark-paid` accepting `{ commission_ids: list[UUID] }`. The `mark_commissions_paid_by_admin` service method already accepts a list; just expose it. On the frontend, add checkboxes to the commissions table and a "Mark selected paid" button.

#### 5.3 Add loan amount threshold to two-person approval (B11)

In `admin/router.py`, modify `admin_loan_action` for `action == "approve"`: if `loan.amount_requested >= settings.LOAN_HIGH_VALUE_THRESHOLD` (new config, default `50000`), route through `request_pending_action("loan_approve", ...)` instead of executing immediately. Add `LOAN_HIGH_VALUE_THRESHOLD` to `config.py`.

#### 5.4 Add audit trail for admin-on-admin actions (B17)

The `create_platform_admin` and `deactivate_platform_admin` service methods already call `logger.info`/`logger.warning`. Extend them to also write an `AuditLog` entry with `action="admin_created"` / `"admin_deactivated"` and `resource_type="platform_admin"`. This gives a searchable compliance record in the existing audit log table.

#### 5.5 Add real-time alert polling (F11)

A full WebSocket implementation is overkill for the current scale. Implement a polling-based alert system:

- Every 60 seconds, poll `GET /admin/kyc/queue?status=pending` (count only) and `GET /admin/fraud-queue`.
- If the count increases since the last poll, show a toast notification (`sonner` is already installed) with a link to the relevant page.
- Store the last-seen count in a React context (`AdminAlertContext`) so the nav badge stays accurate across pages.

Full SSE/WebSocket upgrade is a separate ticket once the polling baseline is validated.

#### 5.6 Platform settings endpoint (B14)

Add `GET /admin/settings` returning current mutable config values (platform fee %, LOAN_HIGH_VALUE_THRESHOLD, etc.) and `PATCH /admin/settings` to update them (TOTP-gated). Store overrides in a `platform_settings` key-value table (new migration). This decouples runtime config from environment variables for ops-safe settings.

---

## 4. Summary Table

| Area | Blocker / Critical | High | Medium | Total |
|---|---|---|---|---|
| API Backend | 5 | 7 | 7 | **19** |
| Web Frontend | 4 | 8 | 7 | **19** |
| **Total** | **9** | **15** | **14** | **38** |

**Sprint 1** closes all 9 critical gaps.  
**Sprints 2–4** close all 15 high-priority gaps plus most medium ones.  
**Sprint 5** hardens the system and adds platform-level config.

---

## 5. Quick Reference: Files to Touch Per Gap

| Gap | Files |
|---|---|
| B1/B2 — Admin management endpoints | `admin/router.py`, `admin/service.py` |
| B3/F3 — Appeal resolution | `admin/router.py`, `admin/models.py`, new migration, `Web/src/app/admin/(app)/ops/page.tsx` |
| B4 — KYC TOTP gate | `admin/router.py`, `Web/src/app/admin/(app)/kyc/page.tsx` |
| B5 — Token refresh | `admin/router.py`, `Web/src/lib/api.ts` |
| B7 — KYC queue shape | `admin/router.py` (1-line return fix) |
| B8 — Loan detail endpoint | `admin/router.py`, new `Web/src/app/admin/(app)/loans/[id]/page.tsx` |
| B9 — Bulk commission mark-paid | `admin/router.py`, `Web/src/app/admin/(app)/commissions/page.tsx` |
| B12 — Route ordering | `admin/router.py` (swap two route registrations) |
| B13 — CSV export | `admin/router.py` (5 endpoints), each corresponding frontend page |
| B18 — Agent search | `admin/router.py`, `agent_network/service.py` |
| F1 — Replace window.prompt | `Web/src/components/admin/TotpDialog.tsx` (new), `businesses/page.tsx`, `businesses/[id]/page.tsx` |
| F4 — Real notifications | `Web/src/app/admin/(app)/notifications/page.tsx` (rewrite) |
| F5/F6 — Pagination | `loans/page.tsx`, `agents/page.tsx` |
| F7 — Agent applications | `Web/src/app/admin/(app)/agents/applications/page.tsx` (new) |
| F8 — Settings expansion | `settings/page.tsx`, `AdminNav.tsx` |
| F9 — Audit log filters | `audit/page.tsx`, `admin/router.py` (actor filter) |
| F12 — Break up Ops page | `ops/page.tsx`, new `/appeals/`, `/payments/dva/`, `/pending-actions/` pages |
| F14 — Breadcrumbs | `Web/src/components/admin/Breadcrumb.tsx` (new), `(app)/layout.tsx` |
| F15 — MFA nav link | `AdminNav.tsx`, `settings/page.tsx` |
| F16 — Business detail | `businesses/[id]/page.tsx` |
| F20 — Widget error states | `dashboard/page.tsx` |
