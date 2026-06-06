# Agent API & Mobile Dashboard — Gap Analysis & Implementation Plan

_Reviewed: June 2026_

---

## 1. What Is There

### 1.1 Agent Network API (`/api/v1/agents/*`)

**Registration & profile**
- `POST /register` — self-register as agent (with optional MoMo phone, region, district)
- `GET /me` / `GET /dashboard` — returns agent dashboard (onboarded count, pending commission, total referrals)
- `GET /agents` — admin list of all agents (region filter, pagination)

**Trader onboarding**
- `POST /onboarding/start` — create or resume a trader user by phone
- `POST /onboarding/business` — create business and attribute to agent
- `POST /onboard` — single-step combined onboarding (phone → user → business → referral)
- `POST /onboarding/business/{id}/wallet` — attach MoMo account to trader
- `POST /onboarding/business/{id}/kyc` — submit trader KYC
- `POST /onboarding/business/{id}/complete` — mark referral active
- `POST /onboarding/bulk` — batch-onboard up to 50 traders in one request
- `GET /bulk-onboarding/template` — returns schema template for bulk CSV import

**Trader management**
- `GET /traders` — list agent's traders (status filter, pagination); returns business name, KYC status, owner phone
- `POST /attribute` — retroactively attribute an existing merchant to the agent

**Commission management**
- `POST /commissions/trigger` — manually fire a commission event
- `GET /commissions` — list commissions (status filter, pagination)
- `GET /commissions/summary` — period summary (by trigger, grand total, pending total, onboarded count)
- `POST /commissions/mark-paid` — admin: mark a set of commissions paid
- `POST /commissions/bulk-payout` — agent: bulk payout selected commissions

**Wallet & payout (`/api/v1/agents/wallet*`)**
- `GET /wallet` — balance summary: pending_balance, available_balance, total_paid_out, next Friday payout date, eligibility flag
- `GET /wallet/history` — payout batch history (per-agent slice of batch JSONB results)
- `GET /wallet/commissions` — commission list with status, available_at, paid_at, paid_via

**Admin payout (`/api/v1/admin/payouts/*`)**
- `GET /balance` — live Paystack platform balance
- `GET /agents/summary` — aggregate wallet stats across all agents
- `GET /batches` / `GET /batches/{id}` — payout batch list and detail
- `POST /agents/trigger` — manually queue weekly payout Celery task

---

### 1.2 Agent Mobile App (4 tabs)

**Dashboard tab (`app/agent/index.tsx`)**
- Performance hero: traders completed this month vs. target, period commission
- Progress bar toward monthly target
- Dark wallet card: available balance, next payout date, pending hold, paid out total
- Withdraw modal (amount input → `POST /api/v1/payouts/withdraw`)
- "Onboard new trader" CTA
- Pipeline preview (top 5 traders with KYC status badges)

**Pipeline tab (`app/agent/pipeline.tsx`)**
- Searchable list of all trader businesses with KYC status badge
- No other actions or detail navigation

**Onboard tab (`app/agent/onboard.tsx`)**
- Multi-step form in one screen: business name, owner name, phone, business type, wallet phone, address, Ghana Card, TIN
- Calls onboarding sequence directly with raw `apiClient.post` calls
- Resets form on success with Alert confirmation

**More tab (`app/agent/more.tsx`)**
- Wallet balances (duplicates Dashboard)
- Commission history (trigger, amount, status badge)
- Payout history (batch amount, date, transfer code)
- Profile card + logout

---

### 1.3 Owner (Merchant) Dashboard (`app/owner/index.tsx`)

- Greeting header with business initials, Twi salutation, notification bell with unread count
- Hero card: today's revenue (live), sparkline of hourly sales, % change vs. yesterday, avg sale
- Cash / Online-MoMo split cards
- Quick action strip: New Sale, Invoices, Payments, Inventory
- "Needs attention" section: live API alerts + local heuristics (low stock, tax deadline, credit score, loan status)
- Recent sales list with payment-method badge, tappable for detail sheet

---

## 2. Gaps

### 2.1 Agent API Gaps

#### Critical (blocks correct mobile behaviour)

**G-A1 — Dashboard shape mismatch**
The mobile `AgentDashboardDto` expects `target`, `completed`, `active_traders`, `pending_onboardings`, `period_commission` from `GET /dashboard`. The backend's `agent_dashboard()` returns `agent_id`, `region`, `is_active`, `onboarded_count`, `total_commission_earned`, `pending_commission`, `total_referrals`. None of the mobile fields map correctly. The period commission field shown on the dashboard hero is always zero.

**G-A2 — Missing withdraw endpoint**
The mobile's "Withdraw" button posts to `/api/v1/payouts/withdraw`. No such route exists in either `payouts/router.py` or the agent network router. The `agent_router` in `payouts/router.py` covers `/wallet`, `/wallet/history`, `/wallet/commissions` — there is no withdraw route wired anywhere.

**G-A3 — `PATCH /agents/me` missing**
Agents cannot update their own region, district, or MoMo phone after registration. The MoMo phone determines their Paystack recipient code, so if it changes the payout will fail silently.

#### High (significant UX or data correctness issue)

**G-A4 — No agent performance targets**
`target` in the dashboard is always 0 because there is no model or admin endpoint for setting monthly onboarding targets per agent or per region. The progress bar on the mobile never renders.

**G-A5 — Payout history query is O(batches × agents)**
`GET /wallet/history` loads every completed batch and filters by agent ID from the JSONB `results` blob in Python. For 1,000 batches × 500 agents this is expensive. The correct fix is a join table `agent_payout_allocations` or at minimum a GIN index on `results`.

**G-A6 — No individual trader detail endpoint**
`GET /traders` returns a list but there is no `GET /traders/{business_id}` to pull full KYC status, wallet status, and sales activity for a specific trader. The mobile pipeline has no way to navigate to a detail view.

**G-A7 — No agent referral code endpoint**
Agents need their own referral link/QR code to share with traders for self-onboarding (channel=`link` or `qr`). There is no `GET /agents/me/referral-code` or `POST /agents/me/referral-code` endpoint.

**G-A8 — No commission date-range filter**
`GET /commissions` and `GET /wallet/commissions` only support status filtering. Agents cannot view commissions for a specific month from the mobile app; the "commission history" section has no date picker because the API doesn't support it.

#### Medium (quality / operational)

**G-A9 — No push notification hooks for agent events**
Commission earned, hold released, payout sent, and payout failed events go through `_notify_payout_sent` / `_notify_payout_failed` but these call the notification module — there is no FCM/APNS push configured for the agent role. Agents only find out about payouts by opening the app.

**G-A10 — Business type is unvalidated free-text in onboard endpoint**
`/onboard` and `/onboarding/business` accept `type` as an arbitrary string. The DB stores whatever is passed. No enum validation exists at the API layer, leading to dirty data.

**G-A11 — Application flow unused in mobile**
`AgentApplication` model and `list_applications` / `approve_application` / `reject_application` service methods exist but there is no mobile screen for applying, and no admin UI for reviewing applications (outside the Next.js admin panel). Agents can bypass this with `/register` directly.

---

### 2.2 Agent Mobile Dashboard Gaps

**G-M1 — Agent name shows phone, not name**
Header renders `user?.phone ?? 'Agent'`. `user.name` is never shown. The auth store holds the user object but `name` is not being read.

**G-M2 — Hardcoded "Active" badge**
The green "Active" pill is hardcoded. If an agent is suspended (`is_active = false`) the app still shows them as active.

**G-M3 — "Available for Friday payout" is hardcoded**
The wallet card subtitle is a static string. The API returns `next_payout_date` — this label should use it (e.g., "Available for Fri 14 Jun payout").

**G-M4 — Commission display logic is inconsistent**
The hero shows `periodCommission > 0 ? periodCommission : totalPaidCommission` as a fallback. Because the dashboard endpoint doesn't return `period_commission`, this always falls back to total paid out — a misleading metric for the "this month" header.

**G-M5 — No skeleton/loading state on agent dashboard**
`wallet` and `workspace` load from two separate queries (`useAgentWorkspace` + `useAgentWalletWorkspace`). While loading, the hero shows zeroes with no shimmer. Compare with the owner dashboard which uses `CardSkeleton`.

**G-M6 — No "See all" link from dashboard pipeline preview**
The pipeline section says "Active pipeline · N" but tapping anything goes nowhere. There is a Pipeline tab but no navigation shortcut from the preview rows.

**G-M7 — Onboard screen uses raw `apiClient.post` calls**
`onboard.tsx` makes five sequential raw API calls without React Query mutations. There is no `isPending` state per step, no optimistic update, no automatic retry, and partial failures leave orphaned user/business records with no recovery path shown to the agent.

**G-M8 — Business type is a free-text input**
`setBusinessType` defaults to `"market_stall"` but is a plain text input. The agent can type anything. Should be a `Picker` / bottom-sheet selector matching the backend's accepted types.

**G-M9 — No success screen after onboarding**
After successful onboarding, a basic `Alert` fires and the form resets. The trader profile is not shown. There is no flow to immediately collect KYC documents or walk through the next steps, which is the main job of a field agent.

**G-M10 — Pipeline shows only KYC status, not referral lifecycle status**
The `OnboardingReferral.status` field (`registered → first_sale → active → churned`) is separate from `kyc_status`. The pipeline only shows KYC, giving agents no visibility into which traders have actually made a first sale (triggering the higher `first_sale` commission).

**G-M11 — "More" tab duplicates wallet data**
Both the Dashboard index and the More tab render wallet balances and commission/payout history. This creates inconsistency and wastes screen real-estate. The More tab should pivot to account management; wallet detail belongs in a dedicated drawer or a wallet sub-screen.

**G-M12 — No referral code / QR share screen**
Agents have no way to generate or share their referral link from the mobile app.

---

### 2.3 Owner Dashboard Gaps

**G-O1 — Analytics menu item routes to `/owner/stock`**
In `more.tsx`, the "Analytics" menu item `route` is `/owner/stock`. This should be a dedicated analytics screen or at minimum `/owner/sales`. A user tapping "Analytics" lands in the stock/inventory screen.

**G-O2 — `handleRefresh` doesn't trigger local DB sync**
`useFocusEffect` runs `syncNow()` on focus, but the manual pull-to-refresh handler only invalidates React Query cache — it never calls `syncNow()`. A merchant who pulls to refresh after regaining connectivity won't get offline-recorded sales pushed up.

**G-O3 — `pctChange` comparison uses string-sorted date**
`previousRows.filter(row => row.day < todayKey)` compares dates as strings. If `row.day` comes back as a different format (e.g., `DD/MM/YYYY` instead of `YYYY-MM-DD`) the comparison silently produces NaN and the trend arrow disappears.

**G-O4 — No MoMo wallet setup nudge**
If `momoAccounts.length === 0` the card shows empty dots but there is no prompt to add a wallet. New merchants who haven't set up a wallet will never receive online payments but the dashboard gives no guidance.

**G-O5 — Quick actions are fixed; no personalisation**
The 4 quick action buttons are hardcoded. High-volume merchants who live in Invoices or Payroll have to navigate through More → Finance. There is no way to pin shortcuts.

**G-O6 — No weekly/monthly revenue trend view on home**
The sparkline shows intraday hourly bars only. Merchants need at-a-glance week-over-week context. The analytics module has the data but it is not surfaced on the home screen.

---

## 3. How to Fix It — Implementation Plan

### Phase 1 — Critical fixes (1–2 weeks)

These are broken things that directly cause wrong data or broken flows.

---

**Fix G-A1 — Align dashboard API response with mobile contract**

In `agent_network/router.py`, update `GET /dashboard` (and `GET /me`) to call `commission_period_summary` for the current month and merge the result:

```python
@router.get("/dashboard")
async def agent_dashboard(user_id, db):
    agent_id = await _current_agent_id(user_id, db)
    svc = AgentNetworkService(db)
    base = await svc.agent_dashboard(agent_id)            # existing
    now = datetime.now(timezone.utc)
    period = await svc.commission_period_summary(agent_id, now.year, now.month)

    # count active vs registered traders
    active_traders = await svc.count_traders_by_status(agent_id, "active")
    pending_onboardings = await svc.count_traders_by_status(agent_id, "registered")

    return {
        **base,
        "completed": base["onboarded_count"],
        "target": await svc.get_agent_target(agent_id, now.year, now.month),  # new
        "active_traders": active_traders,
        "pending_onboardings": pending_onboardings,
        "period_commission": str(period["grand_total"]),
        "commissions_due": str(period["pending_total"]),
    }
```

Add `count_traders_by_status(agent_id, status)` to the service. Update `AgentDashboardDto` in the mobile to reflect the new fields.

---

**Fix G-A2 — Add withdraw endpoint**

In `payouts/router.py`, add to `agent_router`:

```python
class WithdrawRequest(BaseModel):
    amount: Decimal

@agent_router.post("/withdraw")
async def withdraw_balance(body: WithdrawRequest, user_id=Depends(get_current_user_id), db=Depends(get_db)):
    agent_id = await _current_agent_id_for_wallet(user_id, db)
    svc = AgentNetworkService(db)
    result = await svc.initiate_agent_withdrawal(agent_id, body.amount)
    await db.commit()
    return result
```

`initiate_agent_withdrawal` validates `amount <= available_balance`, creates a Paystack transfer, and records it. Return `{ status, transfer_code, amount, message }` — matching `AgentWithdrawResponseDto`.

---

**Fix G-A3 — Add `PATCH /agents/me`**

```python
class UpdateAgentRequest(BaseModel):
    region: str | None = None
    district: str | None = None
    momo_phone: str | None = None

@router.patch("/me")
async def update_agent(body: UpdateAgentRequest, user_id=Depends(get_current_user_id), db=Depends(get_db)):
    agent_id = await _current_agent_id(user_id, db)
    agent = await AgentNetworkService(db).update_agent(agent_id, body.dict(exclude_none=True))
    if body.momo_phone:
        await AgentNetworkService(db).ensure_recipient_code(agent)  # re-provision Paystack
    await db.commit()
    return AgentResponse.model_validate(agent)
```

---

**Fix G-M1 — Show agent name in header**

In `app/agent/index.tsx`:
```tsx
// was: user?.phone ?? 'Agent'
// fix:
{user?.name ?? user?.phone ?? 'Agent'}
```

---

**Fix G-M2 — Active badge from API**

Fetch `workspace.is_active` from the corrected dashboard response and conditionally render the badge colour and label.

---

**Fix G-M7 — Migrate onboard screen to React Query mutations**

Replace the raw sequential `apiClient.post` chain with a single mutation that calls a new dedicated hook:

```ts
// api/agents.api.ts
export async function onboardTraderFull(body: OnboardTraderPayload): Promise<OnboardResultDto> {
  const start = await apiClient.post('/api/v1/agents/onboarding/start', { phone: body.phone, name: body.ownerName });
  const biz = await apiClient.post('/api/v1/agents/onboarding/business', { ... });
  // ... wallet, kyc, complete
  return { businessId: biz.data.business_id, ... };
}

// hooks/featureHooks.ts
export function useOnboardTrader() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: onboardTraderFull,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-workspace'] });
      qc.invalidateQueries({ queryKey: ['agent-traders'] });
    },
  });
}
```

Show per-step progress in the UI. On partial failure, surface which step failed and allow retry.

---

**Fix G-M8 — Business type picker**

Replace `StyledTextInput` for business type with a bottom-sheet picker:

```tsx
const BUSINESS_TYPES = [
  { label: 'Market stall', value: 'market_stall' },
  { label: 'Retail shop', value: 'retail_shop' },
  { label: 'Food & beverage', value: 'food_beverage' },
  { label: 'Services', value: 'services' },
  { label: 'Other', value: 'other' },
];
```

Mirror this enum as a `Literal` type on the backend `BusinessCreate.type` schema.

---

**Fix G-O2 — Add `syncNow` to pull-to-refresh**

```ts
async function handleRefresh() {
  setRefreshing(true);
  await syncNow();                             // ← add this
  await Promise.all([...queryClient.invalidateQueries(...)]);
  await reload();
  setRefreshing(false);
}
```

---

**Fix G-O3 — Date comparison robustness**

Parse dates properly before comparing:
```ts
const previousRows = rows.filter(row => {
  const d = String(row.day ?? row.period ?? '');
  return d && new Date(d) < new Date(todayKey);
});
```

---

**Fix G-O1 — Fix analytics route**

In `app/owner/more.tsx`:
```ts
{ icon: 'trending-up', label: 'Analytics', sub: '...', route: '/owner/analytics' },
// or if no analytics screen yet:
route: '/owner/sales',
```

---

### Phase 2 — High priority improvements (2–3 weeks)

**G-A4 — Agent performance targets**

Add `AgentTarget` model: `{ agent_id, year, month, target_count }`. Admin endpoint `POST /admin/agents/{id}/target` to set. Service method `get_agent_target(agent_id, year, month)` falls back to a platform default (e.g., 20). Expose target in the dashboard response.

**G-A5 — Fix payout history query**

Add a `agent_payout_allocations` table: `{ batch_id, agent_id, amount_ghs, transfer_code, status }`. Populate it in `record_payout_batch_result`. Replace the JSONB scan with a simple indexed join. Add a DB migration.

**G-A6 — Trader detail endpoint**

```python
@router.get("/traders/{business_id}")
async def get_trader_detail(business_id: UUID, user_id=Depends(get_current_user_id), db=Depends(get_db)):
    agent_id = await _current_agent_id(user_id, db)
    return await AgentNetworkService(db).get_trader_detail(agent_id, business_id)
```

Return: referral status, KYC status, wallet status, last sale date, total sales count, commissions earned from this trader. Wire a `TraderDetailScreen` in mobile navigated from Pipeline row taps.

**G-A7 — Agent referral code**

Add `referral_code: str` to the `Agent` model (generated on registration as `AG-{short_uuid}`). Expose via `GET /agents/me/referral-code → { code, qr_data_url }`. Add a share sheet in mobile More tab.

**G-A8 — Commission date-range filter**

Add `from_date` and `to_date` query params to `GET /commissions` and `GET /wallet/commissions`. In the mobile More tab, add a month-picker chip row (current month pre-selected).

**G-M3 — Dynamic payout label**

```tsx
const nextDate = wallet?.next_payout_date ? new Date(wallet.next_payout_date).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Friday';
// "Available for Fri 14 Jun payout"
```

**G-M4 — Fix commission display**

After fixing G-A1, `workspace.period_commission` will be populated. Remove the fallback to `totalPaidCommission` entirely. Display both clearly: "This month: GH₵X earned" and "Total paid: GH₵Y".

**G-M5 — Skeleton loading on agent dashboard**

Wrap the hero card and wallet card in `isLoading` guards using the existing `CardSkeleton` component, matching the owner dashboard pattern.

**G-M6 — Pipeline preview navigation**

Make each trader row in the dashboard preview tappable: `router.push(`/agent/pipeline?highlight=${t.id}`)`. In the Pipeline tab, accept a `highlight` param and scroll to + expand that row.

**G-M9 — Post-onboard success screen**

After successful onboarding, navigate to a `SuccessScreen` that shows the new trader's name, business, KYC status, and a "Collect KYC documents" CTA (opens `kyc` sub-screen with the trader pre-filled).

**G-M10 — Show referral lifecycle in Pipeline**

Add a second badge to each pipeline row for referral status (`registered | first_sale | active | churned`) alongside the KYC badge. Colour-code: registered = grey, first_sale = blue, active = green, churned = red.

**G-O4 — MoMo wallet setup nudge**

In the owner dashboard, when `momoAccounts.length === 0`, insert an `AlertRow` with tone `warn` above the attention section:

```tsx
{ tone: 'warn', icon: 'wallet-plus-outline', title: 'Add a MoMo wallet',
  sub: 'Accept online payments from customers', cta: 'Add wallet',
  onPress: () => router.push('/owner/payments-history') }
```

---

### Phase 3 — Polish & growth (3–4 weeks)

**G-M11 — Restructure More tab**

Remove wallet balances from More tab (they're already on Dashboard). Replace with:
- Agent settings (edit region/district/MoMo phone — calls `PATCH /agents/me`)
- Referral code + QR share
- Support / help link
- App version + logout

Move commission and payout history to a dedicated "Earnings" tab (replace Onboard tab, which should move to a FAB).

**G-A9 — Push notifications for agent events**

In `_notify_payout_sent` and `_notify_payout_failed`, add an FCM push call after the in-app notification. Require agents to register a device token on login (add `POST /agents/me/device-token`). Notification payloads:
- Commission earned: "You earned GH₵X for onboarding [Business Name]"
- Hold released: "GH₵X is now available for payout"
- Payout sent: "GH₵X sent to your MoMo [phone]"

**G-A10 — Business type validation**

Define a shared `BusinessType` enum in `business/schemas.py` and reference it from the agent onboarding schemas. Return a 422 with a readable message for unknown types.

**G-A11 — Application review flow**

Wire a mobile screen for agent applicants (`/agent/apply`) that posts to a new `POST /agents/apply` endpoint (creates `AgentApplication`). Add a notification to the admin panel when an application is pending. This enables a managed agent onboarding process rather than open self-registration.

**G-O5 — Pinnable quick actions**

Store 4 pinned shortcuts in `AsyncStorage` per user. Add a long-press reorder flow on the quick action strip. Default pins: New Sale, Invoices, Payments, Inventory (current behaviour unchanged for existing users).

**G-O6 — Weekly trend on home**

Add a "This week" toggle to the hero card. When selected, replace the intraday sparkline with 7-day bars using the existing `analytics-summary` query (`period=7d, group_by=day`). No new API needed.

---

## 4. Prioritised Summary

| Priority | ID | Gap | Area | Effort |
|---|---|---|---|---|
| P0 | G-A1 | Dashboard API shape mismatch | API | S |
| P0 | G-A2 | Missing withdraw endpoint | API | S |
| P0 | G-M7 | Onboard uses raw API calls, no retry | Mobile | M |
| P1 | G-A3 | No agent profile update endpoint | API | S |
| P1 | G-M1 | Agent name shows phone | Mobile | XS |
| P1 | G-M2 | Active badge hardcoded | Mobile | XS |
| P1 | G-M8 | Business type free-text input | Mobile | S |
| P1 | G-O1 | Analytics menu links to wrong screen | Mobile | XS |
| P1 | G-O2 | Pull-to-refresh skips local sync | Mobile | XS |
| P1 | G-O3 | pctChange uses fragile string sort | Mobile | XS |
| P2 | G-A4 | No performance targets | API | M |
| P2 | G-A5 | Payout history O(batches×agents) query | API | M |
| P2 | G-A6 | No trader detail endpoint | API | S |
| P2 | G-A7 | No referral code endpoint | API | S |
| P2 | G-A8 | No date-range filter on commissions | API | S |
| P2 | G-M3 | Hardcoded payout label | Mobile | XS |
| P2 | G-M4 | Commission display logic fallback | Mobile | XS |
| P2 | G-M5 | No loading skeleton on agent dashboard | Mobile | S |
| P2 | G-M6 | No tap-to-navigate from pipeline preview | Mobile | S |
| P2 | G-M9 | No success screen after onboarding | Mobile | M |
| P2 | G-M10 | Pipeline missing referral lifecycle status | Mobile | S |
| P2 | G-O4 | No MoMo wallet nudge for new merchants | Mobile | S |
| P3 | G-A9 | No push notifications for agent events | API + Infra | L |
| P3 | G-A10 | Business type unvalidated | API | S |
| P3 | G-A11 | Agent application flow unused | API + Mobile | L |
| P3 | G-M11 | More tab duplicates wallet data | Mobile | M |
| P3 | G-M12 | No referral QR share screen | Mobile | M |
| P3 | G-O5 | Quick actions not personalisable | Mobile | L |
| P3 | G-O6 | No weekly trend on home | Mobile | M |

_Effort: XS < 1 hour · S = half day · M = 1–2 days · L = 3–5 days_

---

## 5. Recommended Build Order

1. Fix G-A1 first — every other agent dashboard gap cascades from the wrong API shape.
2. Fix G-A2 immediately after — the withdraw button is dead without it.
3. Fix G-M7 alongside — the onboard flow is the agent's primary job.
4. Batch all XS/S mobile cosmetic fixes (G-M1, G-M2, G-M3, G-M4, G-O1, G-O2, G-O3) in one PR.
5. Then tackle G-A4 + G-A5 + G-A6 together — they share a DB migration cycle.
6. G-A9 (push notifications) should be scoped as its own sprint and requires infrastructure decisions (FCM setup, device token storage).
