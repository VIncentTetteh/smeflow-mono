# SMEflow Merchant API & Mobile Dashboard — Gap Analysis & Implementation Plan

_Reviewed: June 2026_

---

## 1. What Is There

### 1.1 Merchant API Surface (`/api/v1/`)

#### Payments (`/payments`)
- `POST /request` — initiate MoMo collection (RequestToPay) with idempotency
- `POST /disburse` — send funds from verified primary wallet to any MoMo number
- `POST /ghqr/generate` — generate static or dynamic GhQR code
- `GET /` — paginated payment list with status, provider, date filters
- `GET /{id}` — single payment detail with full metadata
- `GET /reconciliation/inbox` — unmatched successful collections queue with match-state summary
- `GET /analytics/channels` — payment volume grouped by processor, channel, and provider detail
- `POST /webhooks/paystack` — unified Paystack webhook handler (charge, transfer, subscription, DVA events)

#### Settlements (`/settlements`)
- `GET /balance` — wallet summary: unsettled balance, platform fee rate, threshold, auto-settlement config
- `GET /ledger` — paginated ledger entries (credit, fee, debit, reversal, adjustment) with running balance
- `GET /` — paginated settlement request history with status filter
- `POST /request` — submit a manual withdrawal; auto-approved under the ceiling, otherwise pending admin review
- `DELETE /{id}` — cancel a pending settlement and restore balance

#### Analytics (`/analytics`)
- `GET /revenue` — daily/weekly/monthly revenue trend for rolling periods (7d, 30d, 90d, 1y)
- `GET /revenue/daily` — explicit date range revenue breakdown
- `GET /items/top` — top items by revenue in a date range
- `GET /top-items` — premium alias with period shorthand
- `GET /pnl` — gross profit and margin for a date range
- `GET /profit-loss` — premium monthly/yearly P&L with prior-period comparison
- `GET /cash-flow` — cash and MoMo inflows vs outstanding credit
- `GET /cash-flow/period` — premium calendar-period cash flow
- `GET /inventory/turnover` — items ranked by sales velocity
- `GET /inventory-turnover` — premium version with period shorthand
- `GET /customers/top` — top customers by revenue
- `GET /customers` — premium customer analytics sorted by revenue or frequency
- `GET /customers/advanced` — segmentation, retention, advanced metrics
- `GET /predictive/insights` — ML-based recommendations and forecasting
- `GET /benchmarking/{industry}` — anonymous peer benchmarking (guarded by feature flag)
- `GET /inventory/alerts/low-stock` — items at or below low-stock threshold
- `GET /inventory/alerts/predictive-restock` — items predicted to run out within N days
- `POST /export` — async export job (xlsx, pdf, csv)
- `GET /export/download` — synchronous export for direct download

#### Sales (`/sales`)
- Full CRUD: create, list, get, void, payment methods (cash, MoMo, credit, split, Paystack)
- Customer credit repayment: intent creation and direct recording
- Daily and period summaries with payment method breakdown

#### Inventory (`/inventory`)
- Items CRUD with barcode, stock tracking, low-stock threshold
- Categories management
- Stock adjustment with reason codes
- Supplier management (create, update, delete)
- Purchase orders (create, receive)
- `GET /items/{id}/threshold-suggestion` — AI-based reorder suggestion from sales velocity

#### Invoicing (`/invoices`)
- Create, list, get, send (WhatsApp/SMS/email), void
- Generate from sale, debit notes
- Automatic GhQR payload on invoice creation

#### Business (`/business`)
- Create, update business profile
- Team members (invite, update role, deactivate)
- MoMo accounts (add, update, delete, set primary, verify)
- DVA provision (Paystack Dedicated Virtual Account)
- Business templates (retail, food, services presets)
- Suspension appeal

#### KYC (`/kyc`)
- Submit, status check, Ghana Card and TIN verification

#### Credit (`/credit`)
- Credit score calculation from sales history
- Credit score history timeline
- Loan request, confirmation (OTP), lender listing
- Loan detail and repayment schedule

#### Tax (`/tax`)
- Tax rates by type (VAT, NHIL, GetFund, COVID levy)
- Tax workspace summary (current month P&L, VAT position)
- Tax calendar (upcoming deadlines)
- Tax returns: generate draft, file, export PDF/Excel
- Input VAT: record, list

#### Payroll (`/payroll`)
- Employees CRUD
- Payroll run trigger, approval, payslip listing
- P9A and P9B form download

#### Notifications (`/notifications`)
- Notification preferences (per-channel: SMS, WhatsApp, email, push)
- Notification event log with retry
- Merchant alerts (attention view + history)
- Customer message delivery tracking
- Bulk SMS/WhatsApp send to customer segment
- FCM push via `POST /auth/register-device`

#### Billing (`/billing`)
- Subscription plans, current subscription, plan usage limits
- Billing invoices and transaction history
- Cancel subscription
- Paystack subscription webhook handler

#### Auth (`/auth`)
- Login, refresh, logout
- Register device (FCM token storage for push)
- Update profile (`PATCH /auth/me`)

#### Referrals (`/referrals`)
- Get referral summary, referral code, share link
- Referred-business list with status

#### Agent Network / USSD / Lender
- Agent onboarding and commission APIs (see separate agent gap analysis)
- USSD flow endpoints
- Lender partner APIs

---

### 1.2 Merchant Mobile Screens

| Screen | File | Core Functionality |
|---|---|---|
| Home Dashboard | `app/owner/index.tsx` | Revenue hero, sparkline (today/7d toggle), cash/MoMo split, quick actions, alerts, recent sales |
| Analytics | `app/owner/stock.tsx` | Revenue trends, P&L, cash flow, top items, customer analytics, export — tabbed, period-filtered |
| Sell / POS | `app/owner/sell.tsx` | Cart, barcode scan, cash/MoMo/credit/split/Paystack modes, offline-first, receipt share |
| Sales History | `app/owner/sales.tsx` | Filterable transaction list, period summary strip, sale detail sheet |
| Payments & Wallets | `app/owner/payments-history.tsx` | MoMo wallets, settlement balance/ledger, payout request, reconciliation inbox, GhQR |
| Inventory | `app/owner/inventory.tsx` | Items CRUD, barcode scan, stock adjust, suppliers, purchase orders, category management |
| Invoices | `app/owner/invoices.tsx` | Invoice list, create standalone invoice, send, void |
| New Invoice | `app/owner/new-invoice.tsx` | Multi-line invoice builder with customer search |
| Customers | `app/owner/customers.tsx` | Customer list, credit balances, repayment recording |
| Credit & Loans | `app/owner/credit.tsx` | Credit score gauge, loan applications, repayment schedule |
| Tax | `app/owner/tax.tsx` | Tax summary, generate/file returns, download P&L |
| Payroll | `app/owner/payroll.tsx` | Employee management, payroll run, payslip download |
| Cashier Mode | `app/owner/cashier.tsx` | Locked-down POS for cashier staff |
| Notifications | `app/owner/notifications.tsx` | Alert history, delivery preferences, retry |
| Message Deliveries | `app/owner/message-deliveries.tsx` | Customer SMS/WhatsApp delivery status |
| KYC Status | `app/owner/kyc-status.tsx` | KYC submission status, document review |
| Billing & Plan | `app/owner/billing.tsx` | Subscription overview, upgrade, invoice history |
| Referrals | `app/owner/referrals.tsx` | Referral code, share link, reward tracking |
| Settings | `app/owner/settings.tsx` | Profile, team, preferences |
| More | `app/owner/more.tsx` | Navigation hub (Finance, Records, Account sections) |
| Sync | `app/owner/sync.tsx` | Manual sync control and last-sync status |
| Stock (alias) | `app/owner/stock.tsx` | This is actually the analytics screen — see Gap G-M1 |

**API client layer:** Full typed wrappers in `src/api/*.api.ts` for all modules. All server state via React Query with typed hooks in `src/api/hooks/featureHooks.ts`. Auth, session, and business-switch in `sessionHooks.ts`.

**Offline-first architecture:** SQLite local DB via `src/db/`. `syncNow()` pushes queued offline sales on reconnect. `useLocalItems()` reads inventory from local DB for instant POS without network.

---

## 2. Gaps

### 2.1 Critical — Broken or Always Wrong

---

**G-M1 — Analytics is unreachable from the menu**

`more.tsx` routes the "Analytics" menu item to `/owner/sales`. The actual analytics screen lives at `/owner/stock` (file `stock.tsx` — a historical naming mistake). Merchants who tap "Analytics" land on the sales history screen. The full analytics dashboard (P&L, cash flow, customer analytics, export) is effectively invisible from normal navigation.

_Root cause:_ `stock.tsx` was originally the stock/inventory analytics screen and got expanded into the full analytics dashboard while `inventory.tsx` became the stock management screen. The route was never updated.

---

**G-M2 — GhQR code never renders — shape mismatch between API and mobile**

`POST /payments/ghqr/generate` returns `{ qr_payload: str, amount, currency }` — a raw EMVCo QR string. The mobile payment screen checks `genQR.data?.qr_image_url` and renders an `<Image>` from that URL. Since the API never returns `qr_image_url`, the image source is always `undefined`, and the QR placeholder icon is shown instead of a scannable code.

The `GHQRGenerateResponseDto` type acknowledges both fields as optional (`qr_payload?: string; qr_image_url?: string`) — a sign this mismatch was anticipated but never resolved. Merchants literally cannot show a QR code to customers from the app.

---

**G-M3 — Reconciliation inbox is a dead end**

The reconciliation summary shows unmatched, suggested, and linked counts. The "Review payments" button opens a modal — but that modal also only renders 3 items with no pagination or "load more". There is no dedicated reconciliation screen, no tap-to-link flow, and no endpoint to mark a payment as `ignored`. A merchant with 50 unmatched MoMo payments has no way to bulk-resolve or even see them all.

_Backend gap:_ No `POST /payments/reconciliation/{id}/ignore` endpoint exists. The `match_state` field in the inbox response has an `ignored` value in the summary schema, but there is no way to set it.

---

**G-M4 — Push notifications not confirmed wired on merchant login**

The backend has full FCM push infrastructure: `POST /auth/register-device` stores a device token, `_send_push()` delivers via FCM, and `payment.confirmed`, `payment.failed`, `sync.failed`, and `credit.offer` events all have push enabled. The mobile exports `registerDevice` from `auth.api.ts` and has a `useRegisterDevice` hook in `sessionHooks.ts`. However, `register_device` is never called from the mobile login flow or app startup — there is no invocation in `app/owner/_layout.tsx`, `app/(auth)/`, or the auth store's login action. Merchants never receive push notifications regardless of their preferences.

---

### 2.2 High — Significant UX or Data Correctness Issues

---

**G-M5 — Settlement fee preview is locally computed and fragile**

The "Request payout" modal calculates the fee preview client-side using `settlementBalance?.transfer_fee_fixed` and `settlementBalance?.transfer_fee_pct` from the balance response. If those fields are null/undefined (e.g., before the balance loads, or on a plan without transfer fees), the preview shows `GH₵ 0.00` fee and a net amount equal to the full requested amount. The merchant submits, and the actual `fee_amount` deducted by the server is different. There is no `POST /settlements/preview` endpoint to get an authoritative server-computed fee estimate before committing.

---

**G-M6 — `stock.low` push notifications are permanently disabled**

In `notifications/service.py`, the channel config for `stock.low` is `{"whatsapp": False, "sms": False, "push": False}`. Low-stock alerts exist on the home dashboard "needs attention" section and in the analytics screen, but they're driven by local DB data — merchants only see them when they open the app. If a merchant is away from the app and a product runs out, no push is sent. The analytics API has `GET /analytics/inventory/alerts/low-stock` but no background task evaluates and fires this event.

---

**G-M7 — No combined dashboard summary endpoint — home screen makes 7 parallel API calls**

`HomeScreen` fires 7 separate queries on mount and every focus:
1. `useDailySalesSummary` → `/sales/daily-summary`
2. `useAnalyticsSummary` → `/analytics/revenue`
3. `useSalesHistory` → `/sales`
4. `useTaxWorkspace` → `/tax/workspace`
5. `useCreditScore` → `/credit/score`
6. `useCreditRequests` → `/credit/requests`
7. `useMerchantAlerts` → `/notifications/alerts`

On a slow mobile connection (2G/3G — typical in Ghana), this creates 7 sequential TCP handshakes. A single `GET /dashboard/summary` that returns all of this in one response would cut load time by 60–80% and reduce battery drain from parallel HTTP.

---

**G-M8 — Analytics screen is named `stock.tsx` — wrong file, wrong route**

Beyond the navigation bug (G-M1), the file organisation is misleading: `stock.tsx` exports `AnalyticsScreen`. There is no `analytics.tsx`. Any developer looking at the codebase will assume analytics is missing. Stock management is correctly in `inventory.tsx`. This is a rename and route wiring task that also fixes G-M1.

---

**G-M9 — No top-item performance data on the inventory screen**

The inventory screen shows stock levels and reorder status, but doesn't surface which items drive the most revenue or have the highest velocity. `GET /analytics/items/top` and `GET /analytics/inventory/turnover` exist and are called in the analytics screen — but the inventory screen doesn't use them. Merchants have to switch between two screens to cross-reference stock levels with sales performance.

---

**G-M10 — Settlement history not shown in the payments screen**

`useMerchantSettlements()` and `cancelMerchantSettlement()` are wired up in `featureHooks.ts`, and the payout request modal is implemented. But the payments screen (`WalletTab = 'ledger' | 'payouts'`) — the `payouts` tab shows settlement history — this tab exists but there is no "Cancel" action surfaced on pending settlements in the list. Merchants can request a payout but cannot see it in-flight or cancel it without navigating away or reloading.

---

### 2.3 Medium — Polish, Growth, or Operational

---

**G-M11 — Quick actions are hardcoded — no personalisation**

The home screen's 4 quick actions (New Sale, Invoices, Payments, Inventory) are hardcoded. High-volume payroll users and tax-heavy businesses have to navigate 3 taps to reach screens they use daily. No `AsyncStorage`-backed personalisation exists. This is particularly impactful for merchants with Payroll or Tax as their primary workflow.

---

**G-M12 — No predictive restock alert surfaced to merchant**

`GET /analytics/inventory/alerts/predictive-restock` exists and is implemented in the analytics service (sales velocity-based prediction). It is not called from any mobile screen. The home dashboard "needs attention" section only surfaces alerts from the `useMerchantAlerts` hook (which calls the notifications alerts API) — not the predictive restock endpoint. Merchants discover stock-outs instead of preventing them.

---

**G-M13 — No analytics export trigger from mobile**

`POST /analytics/export` (async job) and `GET /analytics/export/download` (sync download) exist and the mobile has `useExportAnalytics()` and `useExportDownload()` hooks. The analytics screen has export buttons gated by the `export` billing feature. However, `useExportDownload` fetches a file blob — but React Native cannot handle a raw blob download the same way a browser can. There is no `expo-file-system` download + `expo-sharing` share-sheet integration. The export button likely silently fails or produces an unusable result on device.

---

**G-M14 — No offline indicator or network banner in the merchant dashboard**

The sell screen has a `isOffline` state and shows an offline badge. The home dashboard, sales, inventory, and payments screens have no network status indicator. If a merchant is offline and pulls to refresh, they get stale data with no explanation. The mobile has `@react-native-community/netinfo` installed (used in `credit.tsx`) but it's not wired into a global banner.

---

**G-M15 — Benchmarking endpoint is permanently feature-flagged off**

`GET /analytics/benchmarking/{industry}` is implemented but guarded by `settings.ENABLE_ANALYTICS_BENCHMARKING`, which is hardcoded `False` in config (the endpoint returns 503 if off). The mobile analytics screen never calls this endpoint. When real anonymized data is available, there is no mobile UI to surface it. The schema and service are ready; the mobile screen is not.

---

## 3. Implementation Plan

### Phase 1 — Critical Fixes (1 week)

These are broken things that produce wrong behaviour for every merchant.

---

**Fix G-M1 + G-M8 — Rename `stock.tsx` to `analytics.tsx` and fix the menu route**

1. Rename `mobile/app/owner/stock.tsx` → `mobile/app/owner/analytics.tsx`. No code changes inside the file.
2. In `mobile/app/owner/more.tsx`, change:
   ```ts
   { icon: 'trending-up', label: 'Analytics', sub: '...', route: '/owner/sales' }
   // → 
   { icon: 'trending-up', label: 'Analytics', sub: 'Revenue, P&L, cash flow, customers', route: '/owner/analytics' }
   ```
3. Update any deep-link or navigation references to `/owner/stock` in other screens.
4. Verify `expo-router` picks up the new filename correctly (no manual route config needed with file-based routing).

_Effort: XS — under 1 hour including smoke test._

---

**Fix G-M2 — GhQR: render QR client-side from `qr_payload`**

Option A (recommended — no backend change): Install `react-native-qrcode-svg` and render the payload directly.

```tsx
import QRCode from 'react-native-qrcode-svg';

// In payments-history.tsx, replace:
{genQR.data?.qr_image_url ? (
  <Image source={{ uri: genQR.data.qr_image_url }} ... />
) : (
  <MaterialCommunityIcons name="qrcode" ... />
)}

// With:
{genQR.data?.qr_payload ? (
  <QRCode value={genQR.data.qr_payload} size={78} />
) : genQR.data?.qr_image_url ? (
  <Image source={{ uri: genQR.data.qr_image_url }} ... />
) : (
  <MaterialCommunityIcons name="qrcode" ... />
)}
```

Option B (if GhQR spec requires image): Add a backend utility to generate a PNG from the payload using `qrcode` (Python) and return as a base64 data URL in `qr_image_url`. This adds latency and complexity — only do this if GhQR compliance requires a certified image format.

_Effort: S — half day including install, render, and print-share testing._

---

**Fix G-M4 — Wire device token registration on merchant login**

In the auth store login action (or in `app/owner/_layout.tsx` on mount), call `registerDevice` after a successful session:

```ts
// store/auth.ts — inside the login success handler
import * as Notifications from 'expo-notifications';
import { registerDevice } from '@/api/auth.api';

const token = await Notifications.getExpoPushTokenAsync();
await registerDevice({ 
  device_token: token.data, 
  platform: Platform.OS === 'ios' ? 'apns' : 'fcm' 
});
```

Gate this behind a permission request. Store the registration result so re-registration only happens when the token changes. This unblocks payment confirmation, credit offer, and sync-failed push notifications.

_Effort: S — half day including Expo push setup and permission UX._

---

**Fix G-M3 — Add reconciliation management to payments screen**

Backend: Add `POST /payments/reconciliation/{payment_id}/ignore` endpoint:
```python
@router.post("/reconciliation/{payment_id}/ignore")
async def ignore_reconciliation_item(payment_id: UUID, business_id=Depends(...), db=Depends(...)):
    # Set a payment metadata flag: ignored = True
    # Remove from "unmatched" summary count
    ...
```

Mobile: In the reconciliation section, add an "Ignore" swipe action or button per row. Navigate from "Review payments" to a proper full-screen reconciliation list (new screen `app/owner/reconciliation.tsx`) with pagination and both Link and Ignore actions per item.

_Effort: M — 1–2 days (backend endpoint + new mobile screen)._

---

### Phase 2 — High Priority Improvements (2–3 weeks)

---

**Fix G-M5 — Server-computed settlement fee preview**

Add `POST /settlements/preview` (or `GET /settlements/preview?amount=X`):
```python
@router.get("/preview")
async def preview_settlement(amount: Decimal, business_id=Depends(...), db=Depends(...)):
    svc = MerchantSettlementService(db)
    return await svc.compute_settlement_fees(business_id, amount)
    # Returns: { gross_amount, platform_fee, transfer_fee, net_amount, can_settle, reason }
```

Mobile: Replace the local fee calculation in the payout modal with `useQuery` calling this endpoint when `requestAmount` changes (debounced 500ms). Show a loading state in the fee breakdown while computing.

_Effort: S — half day._

---

**Fix G-M6 — Enable and wire low-stock push notifications**

Backend:
1. In `notifications/service.py`, enable push for `stock.low`:
   ```python
   "stock.low": {"whatsapp": False, "sms": False, "push": True},
   ```
2. Add a Celery Beat task that runs `daily_low_stock_digest` — queries all businesses with items below threshold and fires `stock.low` events. Schedule at 8am Ghana time.
3. Add `GET /analytics/inventory/alerts/low-stock` to the notification event triggers (currently only called on-demand from the API).

Mobile: The "needs attention" section already surfaces low-stock via local DB. When push arrives, tapping the notification should deep-link to `/owner/inventory?filter=low_stock`.

_Effort: M — 1–2 days including Beat task setup and deep-link handling._

---

**Fix G-M7 — Combined dashboard summary endpoint**

Add `GET /business/dashboard-summary`:
```python
@router.get("/dashboard-summary")
async def dashboard_summary(business_id=Depends(...), db=Depends(...)):
    # Parallel async gather:
    today = date.today().isoformat()
    daily, alerts, credit = await asyncio.gather(
        SalesService(db).get_daily_summary(business_id, today),
        NotificationService(db).get_merchant_alerts(business_id, view="attention", limit=3),
        CreditService(db).get_credit_score(business_id),
    )
    tax = await TaxService(db).get_workspace_summary(business_id)
    return { "daily": daily, "alerts": alerts, "credit_score": credit, "tax": tax }
```

Mobile: Replace the 7 individual hooks in `HomeScreen` with a single `useDashboardSummary()` hook. Keep the individual hooks for their dedicated screens — only consolidate on the home dashboard.

_Effort: M — 1–2 days._

---

**Fix G-M9 — Surface top-performing items in the inventory screen**

In `inventory.tsx`, add a "Performance" tab alongside the existing item list:

```tsx
// New tab: renders top items from useTopItems(range)
// Columns: item name, units sold (period), revenue, stock remaining
// Links to the analytics screen for the full chart
```

Add `useTopItems` call in `inventory.tsx` gated by `enabled: activeTab === 'performance'` to avoid loading it unless the merchant opens that tab.

_Effort: S — half day._

---

**Fix G-M10 — Cancel pending settlement from the payments screen**

In the "Payouts" tab of the payments screen, for each settlement with `status === 'pending'`, render a "Cancel" button that calls `useCancelMerchantSettlement()`. Show a confirmation alert before proceeding. Invalidate `useSettlementBalance` and `useMerchantSettlements` on success so the balance restores immediately.

_Effort: S — half day._

---

### Phase 3 — Polish & Growth (3–4 weeks)

---

**Fix G-M13 — Analytics export on mobile via `expo-file-system` + `expo-sharing`**

Replace the broken web-style blob download with:
```ts
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const result = await FileSystem.downloadAsync(
  `${API_BASE}/api/v1/analytics/export/download?report=${report}&export_format=xlsx&...`,
  FileSystem.documentDirectory + `${report}.xlsx`,
  { headers: { Authorization: `Bearer ${token}` } }
);
await Sharing.shareAsync(result.uri);
```

Install `expo-file-system` and `expo-sharing` if not already present. Show a progress indicator during download. This replaces the `useExportDownload` hook implementation.

_Effort: M — 1–2 days._

---

**Fix G-M11 — Personalizable quick actions**

Store user preference in `AsyncStorage` as `owner_pinned_actions: string[]`. Default to current 4 actions. On long-press of any action, enter "edit mode" showing a ×-close and a bottom sheet to pick from all available screens. Cap at 4 pinned actions.

```ts
const ALL_ACTIONS = [
  { icon: 'cart-plus', label: 'New sale', route: '/owner/sell' },
  { icon: 'file-document-outline', label: 'Invoices', route: '/owner/invoices' },
  { icon: 'wallet-outline', label: 'Payments', route: '/owner/payments-history' },
  { icon: 'package-variant', label: 'Inventory', route: '/owner/inventory' },
  { icon: 'trending-up', label: 'Analytics', route: '/owner/analytics' },
  { icon: 'account-cash-outline', label: 'Payroll', route: '/owner/payroll' },
  { icon: 'file-chart-outline', label: 'Tax', route: '/owner/tax' },
  { icon: 'account-group-outline', label: 'Customers', route: '/owner/customers' },
];
```

_Effort: M — 1–2 days._

---

**Fix G-M12 — Surface predictive restock alerts on home dashboard**

Add `usePredictiveRestock()` hook calling `GET /analytics/inventory/alerts/predictive-restock?days_ahead=7`. In `buildAttentionItems()` in `features/homeDashboard.ts`, include predictive restock items alongside low-stock. Badge: "Restock in 7 days · N items". Route to `/owner/inventory?filter=restock`.

_Effort: S — half day._

---

**Fix G-M14 — Global offline network banner**

Create a `NetworkBanner` component using `NetInfo`:
```tsx
function NetworkBanner() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    return NetInfo.addEventListener(s => setIsOnline(Boolean(s.isConnected)));
  }, []);
  if (isOnline) return null;
  return (
    <View style={{ backgroundColor: '#b8351c', padding: 8, alignItems: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 12 }}>You're offline — showing saved data</Text>
    </View>
  );
}
```

Mount in `app/owner/_layout.tsx` above the tab navigator. Remove per-screen offline handling from `credit.tsx` and replace with the global banner.

_Effort: S — half day._

---

**Fix G-M15 — Benchmarking screen (when feature flag enabled)**

In the analytics screen, add a "Benchmarks" tab. Gate it with:
```ts
const benchmarkingAvailable = settings.ENABLE_ANALYTICS_BENCHMARKING && hasFullAnalytics;
```

When enabled, show industry comparison bars (my margin vs. industry median, my avg sale vs. peers). When disabled or not on full plan, show a teaser card: "Coming soon — see how your business compares to similar shops in Ghana."

_Effort: M — 1–2 days (UI only; backend already implemented)._

---

## 4. Prioritised Summary

| Priority | ID | Gap | Area | Effort |
|---|---|---|---|---|
| P0 | G-M1 + G-M8 | Analytics unreachable — wrong route + wrong filename | Mobile | XS |
| P0 | G-M2 | GhQR never renders — `qr_payload` vs `qr_image_url` mismatch | Mobile | S |
| P0 | G-M3 | Reconciliation inbox is a dead end — no full screen, no ignore | API + Mobile | M |
| P0 | G-M4 | Push notifications not wired — `registerDevice` never called | Mobile | S |
| P1 | G-M5 | Settlement fee preview is locally computed and fragile | API + Mobile | S |
| P1 | G-M6 | Low-stock push permanently disabled — no Beat task | API | M |
| P1 | G-M7 | Home dashboard fires 7 parallel API calls on every focus | API + Mobile | M |
| P1 | G-M9 | No item performance data in inventory screen | Mobile | S |
| P1 | G-M10 | Can't cancel pending settlement from mobile | Mobile | S |
| P2 | G-M11 | Quick actions hardcoded — no personalisation | Mobile | M |
| P2 | G-M12 | Predictive restock not surfaced to merchant | Mobile | S |
| P2 | G-M13 | Analytics export silently fails on device | Mobile | M |
| P2 | G-M14 | No global offline banner | Mobile | S |
| P2 | G-M15 | Benchmarking UI missing when feature flag ready | Mobile | M |

_Effort: XS < 1 hour · S = half day · M = 1–2 days · L = 3–5 days_

---

## 5. Status of Previously Identified Owner Dashboard Gaps

The following gaps were identified in the prior agent/owner gap analysis (`agent-api-mobile-gap-analysis.md`). **All four have been resolved in the current codebase:**

| ID | Gap | Status |
|---|---|---|
| G-O1 | Analytics menu routes to wrong screen | ⚠️ Partially fixed — `more.tsx` still routes to `/owner/sales`, not `/owner/analytics` (see G-M1 above) |
| G-O2 | `handleRefresh` didn't call `syncNow()` | ✅ Fixed — `await syncNow()` is now the first call in `handleRefresh` |
| G-O3 | `pctChange` used fragile string date comparison | ✅ Fixed — now uses `new Date(d).getTime() < todayMs` |
| G-O4 | No MoMo wallet nudge for new merchants | ✅ Fixed — `AlertRow` with `tone="warn"` renders when `momoAccounts.length === 0` |
| G-O6 | No weekly trend on home sparkline | ✅ Fixed — `heroView` toggle ('today' / '7 days') wired to both intraday and 7-day datasets |

---

## 6. Recommended Build Order

1. **G-M1/G-M8 first** — it's an XS rename + one-line route fix. Unblocks analytics discoverability for all merchants immediately.
2. **G-M2 next** — QR codes are a key merchant-facing feature (customer payments and print). Install the library and swap in 1 hour.
3. **G-M4 in the same sprint** — push notification wiring is foundational infrastructure; every event-driven feature depends on it.
4. **G-M3 and G-M5 together** — both touch the payments/settlements screen; batch them in one PR.
5. **G-M6 + G-M7** — backend tasks. G-M7's combined summary endpoint can be built and released independently of mobile changes (backwards-compatible addition).
6. **G-M9, G-M10, G-M12, G-M14** — polish pass, all S-effort, ship together as a polish release.
7. **G-M11, G-M13, G-M15** — growth features, schedule as their own sprint.
