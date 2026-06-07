# Billing Enforcement — Full-Screen Plan Gating

**Date:** 2026-06-07
**Status:** Approved
**Scope:** Mobile app (`mobile/`)

---

## Problem

Screens show their full content regardless of the user's subscription plan. When the backend rejects a request due to a plan limit (HTTP 402), the mobile app shows a raw error string (e.g. "Request failed with status code 402") instead of a clear upgrade prompt. Users are confused; there is no consistent billing enforcement at the UI layer.

---

## Goal

- Every screen that requires a paid feature shows a full-screen upgrade wall instead of its content when the plan doesn't cover it.
- 402 errors from mutations show an upgrade prompt card rather than a raw error string.
- Billing data is fetched once per owner session (warm cache), not once per screen.

---

## Design

### 1. Data layer

**App-level prefetch** — `app/owner/_layout.tsx` calls `useBillingWorkspace()` on mount. React Query caches the result under `['billing-workspace', businessId]`. All downstream hooks read from cache; no extra network requests.

**`usePlanGate(feature)` hook** — `src/api/hooks/planGate.ts`

Returns `{ allowed: boolean, requiredPlan: 'starter' | 'pro', loading: boolean }`.

- While loading → `allowed: true` (no flash of upgrade wall)
- On billing fetch error → `allowed: true` (fail open, same as current pattern)

Feature gate map:

| Feature key | Limit field | Required plan |
|---|---|---|
| `analytics_basic` | `limits.analytics !== false` | `starter` |
| `analytics_full` | `limits.analytics === 'full'` | `pro` |
| `credit_scoring` | `limits.credit_scoring` | `pro` |
| `tax_summary` | `limits.tax_summary` | `starter` |
| `gra_submission` | `limits.gra_submission` | `pro` |
| `payroll` | `limits.employees !== 0` | `starter` |
| `invoices` | `limits.invoices !== 0` | `starter` |
| `invoice_pdf` | `limits.invoice_pdf` | `starter` |
| `team` | `limits.team_members !== 0` | `starter` |
| `customers` | `limits.customers !== 0` | `starter` |
| `assistant` | `limits.ai_messages !== 0` | `starter` |
| `add_business` | `usage.businesses < limits.businesses` | `starter` |
| `bulk_momo_payout` | `limits.bulk_momo_payout` | `pro` |
| `cost_margin` | `limits.cost_margin_tracking` | `pro` |
| `export` | `limits.export` | `pro` |
| `recurring_invoices` | `limits.recurring_invoices` | `pro` |

**`is402Error(err)` utility** — added to `src/api/errors.ts`. Returns `true` when `AxiosError.response.status === 402`. Used in mutation catch blocks as a reactive fallback.

---

### 2. Component layer

**`<UpgradePrompt>` extended** — add `fullScreen?: boolean` prop to `src/components/ui/UpgradePrompt.tsx`.

- `fullScreen={false}` (default): existing card style, used inline within tabs
- `fullScreen={true}`: centered layout filling available space — large icon, headline, description, gold CTA button. Header stays visible above.

**`<PlanGatedScreen>` new component** — `src/components/ui/PlanGatedScreen.tsx`

```tsx
<PlanGatedScreen feature="payroll" description="Starter unlocks payroll...">
  {/* normal screen body */}
</PlanGatedScreen>
```

Internally: calls `usePlanGate(feature)`, renders nothing while loading, renders `<UpgradePrompt fullScreen>` when not allowed, renders `children` when allowed.

---

### 3. Screen rollout

**New `<PlanGatedScreen>` wrapping:**

| Screen | Feature key | Plan | Description |
|---|---|---|---|
| `payroll.tsx` | `payroll` | starter | Starter unlocks payroll runs, employee management, and P9 tax certificates. |
| `tax.tsx` | `tax_summary` | starter | Starter unlocks your monthly tax summary, VAT tracking, and GRA return generation. |
| `invoices.tsx` | `invoices` | starter | Starter unlocks invoice generation, PDF receipts, and payment tracking. |
| `team.tsx` | `team` | starter | Starter lets you add team members and control access by role. |
| `customers.tsx` | `customers` | starter | Starter unlocks your full customer list and purchase history. |
| `assistant.tsx` | `assistant` | starter | Starter gives you AI assistant messages to manage your business by voice or text. |
| `reconciliation.tsx` | `bulk_momo_payout` | pro | Pro unlocks payment reconciliation and bulk MoMo payout review. |

**Existing screens cleaned up:**

- `analytics.tsx` — replace inline `billing.data?.planUsage?.limits?.analytics` checks with `usePlanGate('analytics_basic')` / `usePlanGate('analytics_full')`. Move period/groupby/tab filter controls inside the gate so they don't render when the wall is showing.
- `stock.tsx` — replace inline limit checks with `usePlanGate`.
- `credit.tsx` — replace inline limit check with `usePlanGate('credit_scoring')`.

**`add-business.tsx`** — in `submit()` catch block, call `is402Error(err)`. If true, set error state to a sentinel value that renders `<UpgradePrompt>` (card, not full-screen) above the submit button instead of the raw error string.

**`owner/_layout.tsx`** — add `useBillingWorkspace()` call to prime the cache. No rendering logic.

---

## Out of scope

- `sell.tsx`, `sales.tsx`, `payments-history.tsx`, `more.tsx` — free-tier features, no gating needed
- Web app — separate effort
- Backend enforcement — already in place (402 responses)
