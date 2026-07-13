# UI/UX Consistency Revamp — Tier 1 (Badge Extension + Worst-Offender Screens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate hardcoded hex colors representing state (loan/instalment/payroll-run/purchase-order status, payment-provider brand color, sale-mode/payment-status tints, cart tile categories) across the six worst-offender mobile screens, replacing them with the app's existing theme tokens and a new generic `tone` prop on `Badge`.

**Architecture:** No new screens, no behavior changes, no file restructuring. One additive extension to `src/components/ui/Badge.tsx` (a `tone` prop alongside the existing `variant` prop, backward compatible). Every other task replaces a screen's local hardcoded-hex status/color map with either `<Badge tone=... label=... />` (for chip-style status renders) or a plain `colors.*` token reference (for status dots and tinted backgrounds, which aren't chip-shaped and don't fit `Badge`).

**Tech Stack:** React Native + Expo Router, TypeScript strict mode, Jest for tests, `useTheme()` from `src/lib/theme.ts`.

## Global Constraints

- No new features, no navigation changes, no business-logic changes — this is a pure styling/consistency pass.
- Every replaced color must preserve the *semantic* meaning of the original (danger stays danger, warning stays warning, success stays success, info stays info, neutral/grey stays neutral) — never guess a different meaning.
- Existing `variant` usages of `Badge` must keep working unchanged (additive change only).
- After every task: run `npm run typecheck` and, if a test file exists for the touched screen, `npm test -- <test file>` from `/Users/vincenttetteh/Desktop/SMEflow-App/mobile`. Both must pass before committing.
- Commit after each task individually (one task = one commit), on branch `production-readiness-hardening`.
- i18n, pull-to-refresh, confirmation dialogs, and structural file-splitting are explicitly out of scope for this plan (see spec, tiers 2/3 — separate follow-up plans).

---

### Task 1: Add `tone` prop to `Badge`

**Files:**
- Modify: `src/components/ui/Badge.tsx`

**Interfaces:**
- Produces: `export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';` and `Badge` now accepts an optional `tone?: BadgeTone` prop in addition to the existing optional `variant?: BadgeVariant`. When both are omitted, `Badge` falls back to `variant: 'draft'` styling (safe default, matches previous implicit behavior of always requiring a variant). All later tasks in this plan render `<Badge tone={...} label={...} />`.

- [ ] **Step 1: Replace the full contents of `src/components/ui/Badge.tsx`**

```tsx
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';

type BadgeVariant =
  | 'paid'
  | 'pending'
  | 'failed'
  | 'synced'
  | 'offline'
  | 'low-stock'
  | 'verified'
  | 'draft';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  label: string;
}

export function Badge({ variant, tone, label }: BadgeProps) {
  const { colors, fonts, radii, spacing } = useTheme();

  const variantConfig: { [key in BadgeVariant]: { bg: string; text: string } } = {
    paid: { bg: `${colors.brand}1a`, text: colors.brand },
    pending: { bg: `${colors.gold}33`, text: '#8a6a00' },
    failed: { bg: `${colors.danger}1a`, text: colors.danger },
    synced: { bg: `${colors.info}1a`, text: colors.info },
    offline: { bg: `${colors.ink}14`, text: colors.ink },
    'low-stock': { bg: `${colors.gold}33`, text: '#8a6a00' },
    verified: { bg: `${colors.brand}1a`, text: colors.brand },
    draft: { bg: `${colors.ink}14`, text: colors.ink },
  };

  // Tone mirrors the fg/bg convention already established by the home-screen
  // AlertRow component (app/owner/index.tsx) so status coloring is identical
  // wherever it appears in the app.
  const toneConfig: { [key in BadgeTone]: { bg: string; text: string } } = {
    success: { bg: `${colors.brand}15`, text: colors.brand },
    warning: { bg: `${colors.gold}18`, text: colors.gold },
    danger: { bg: `${colors.danger}15`, text: colors.danger },
    info: { bg: `${colors.info}15`, text: colors.info },
    neutral: { bg: `${colors.ink}10`, text: colors.muted },
  };

  const { bg, text } = tone ? toneConfig[tone] : variantConfig[variant ?? 'draft'];

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: bg,
          borderRadius: radii.full,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
      ]}
    >
      <Text style={{ color: text, fontSize: 11, fontFamily: fonts.bodySemiBold }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignSelf: 'flex-start' },
});
```

- [ ] **Step 2: Typecheck**

Run from `/Users/vincenttetteh/Desktop/SMEflow-App/mobile`: `npm run typecheck`
Expected: no new errors (existing 4 call sites — `app/agent/more.tsx`, `app/agent/pipeline.tsx`, `app/owner/kyc-status.tsx`, `src/components/feedback/SyncStatus.tsx` — all pass `variant`, which is now optional but they still supply it, so no change in behavior).

- [ ] **Step 3: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/src/components/ui/Badge.tsx
git commit -m "feat(mobile): add generic tone prop to Badge component

Screens with statuses Badge's fixed variant enum doesn't cover
(loan status, payroll run status, purchase-order status) currently
invent their own hardcoded hex-color maps instead of reusing Badge.
Adds an additive tone prop (success/warning/danger/info/neutral)
mirroring the AlertRow color convention already used on the home
screen, so any screen can render <Badge tone=\"warning\" label=\"...\" />
without a local color map."
```

---

### Task 2: `credit.tsx` — replace `LOAN_STATUS`/`INSTALMENT_STATUS` hex maps with `Badge tone`

**Files:**
- Modify: `app/owner/credit.tsx`
- Test: `__tests__/screens/creditScreen.test.tsx` (existing — run to confirm no regression)

**Interfaces:**
- Consumes: `Badge` and `BadgeTone` from Task 1 (`src/components/ui/Badge.tsx`).

- [ ] **Step 1: Add the `Badge` import**

In `app/owner/credit.tsx`, after the existing `Text` import (line 7: `import { Text } from '@/components/ui/Text';`), add:

```tsx
import { Badge } from '@/components/ui/Badge';
```

- [ ] **Step 2: Replace the two status maps (lines 21-39)**

Old:
```tsx
const LOAN_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending_partner: { label: 'Awaiting Lender', color: '#b6831e', bg: '#fff5cc' },
  approved:        { label: 'Approved',         color: '#2eb585', bg: '#e6f7f1' },
  rejected:        { label: 'Rejected',         color: '#b8351c', bg: '#fdecea' },
  confirmed:       { label: 'Confirmed',        color: '#1a73e8', bg: '#e8f0fe' },
  disbursing:      { label: 'Disbursing',       color: '#d4a23a', bg: '#fff5cc' },
  active:          { label: 'Active',           color: '#2eb585', bg: '#e6f7f1' },
  repaid:          { label: 'Repaid',           color: '#5c6b7a', bg: '#f0f3f5' },
  defaulted:       { label: 'Defaulted',        color: '#b8351c', bg: '#fdecea' },
  cancelled:       { label: 'Cancelled',        color: '#5c6b7a', bg: '#f0f3f5' },
};

const INSTALMENT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: 'Due',        color: '#b6831e', bg: '#fff5cc' },
  collecting: { label: 'Processing', color: '#1a73e8', bg: '#e8f0fe' },
  paid:       { label: 'Paid',       color: '#2eb585', bg: '#e6f7f1' },
  failed:     { label: 'Failed',     color: '#b8351c', bg: '#fdecea' },
  defaulted:  { label: 'Overdue',    color: '#b8351c', bg: '#fdecea' },
};
```

New:
```tsx
import type { BadgeTone } from '@/components/ui/Badge';

const LOAN_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending_partner: { label: 'Awaiting Lender', tone: 'warning' },
  approved:        { label: 'Approved',         tone: 'success' },
  rejected:        { label: 'Rejected',         tone: 'danger' },
  confirmed:       { label: 'Confirmed',        tone: 'info' },
  disbursing:      { label: 'Disbursing',       tone: 'warning' },
  active:          { label: 'Active',           tone: 'success' },
  repaid:          { label: 'Repaid',           tone: 'neutral' },
  defaulted:       { label: 'Defaulted',        tone: 'danger' },
  cancelled:       { label: 'Cancelled',        tone: 'neutral' },
};

const INSTALMENT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending:    { label: 'Due',        tone: 'warning' },
  collecting: { label: 'Processing', tone: 'info' },
  paid:       { label: 'Paid',       tone: 'success' },
  failed:     { label: 'Failed',     tone: 'danger' },
  defaulted:  { label: 'Overdue',    tone: 'danger' },
};
```

(Put the `import type { BadgeTone }` line with the other imports near the top of the file, not inline where shown above — shown here next to the maps only for readability.)

- [ ] **Step 3: Replace the requests-list status chip (around line 253-260)**

Old:
```tsx
                  {(() => {
                    const s = LOAN_STATUS[req.status] ?? { label: req.status, color: '#5c6b7a', bg: '#f0f3f5' };
                    return (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: s.bg }}>
                        <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: s.color }}>{s.label}</Text>
                      </View>
                    );
                  })()}
```

New:
```tsx
                  {(() => {
                    const s = LOAN_STATUS[req.status] ?? { label: req.status, tone: 'neutral' as BadgeTone };
                    return <Badge tone={s.tone} label={s.label} />;
                  })()}
```

- [ ] **Step 4: Replace the loan-detail status row (around line 396-406)**

Old:
```tsx
                  {(() => {
                    const st = LOAN_STATUS[loanDetail.status] ?? { label: loanDetail.status, color: '#5c6b7a', bg: '#f0f3f5' };
                    return (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, color: colors.muted }}>Status</Text>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: st.bg }}>
                          <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: st.color }}>{st.label}</Text>
                        </View>
                      </View>
                    );
                  })()}
```

New:
```tsx
                  {(() => {
                    const st = LOAN_STATUS[loanDetail.status] ?? { label: loanDetail.status, tone: 'neutral' as BadgeTone };
                    return (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, color: colors.muted }}>Status</Text>
                        <Badge tone={st.tone} label={st.label} />
                      </View>
                    );
                  })()}
```

- [ ] **Step 5: Replace the instalment-schedule status chip (around line 444-451)**

Old:
```tsx
                          {(() => {
                            const is = INSTALMENT_STATUS[inst.status ?? 'pending'] ?? { label: inst.status ?? 'due', color: '#b6831e', bg: '#fff5cc' };
                            return (
                              <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: is.bg }}>
                                <Text style={{ fontSize: 9, fontFamily: fonts.bodySemiBold, color: is.color }}>{is.label}</Text>
                              </View>
                            );
                          })()}
```

New:
```tsx
                          {(() => {
                            const is = INSTALMENT_STATUS[inst.status ?? 'pending'] ?? { label: inst.status ?? 'due', tone: 'warning' as BadgeTone };
                            return (
                              <View style={{ marginLeft: 8 }}>
                                <Badge tone={is.tone} label={is.label} />
                              </View>
                            );
                          })()}
```

- [ ] **Step 6: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- creditScreen.test.tsx
```
Expected: both pass with no failures.

- [ ] **Step 7: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/credit.tsx
git commit -m "refactor(mobile): route credit screen status chips through Badge tone

Replaces LOAN_STATUS/INSTALMENT_STATUS's 9 hardcoded hex pairs with
semantic tones rendered via the shared Badge component, matching the
color language used everywhere else in the app."
```

---

### Task 3: `payments-history.tsx` + `ProviderChip.tsx` — dedupe provider brand colors, fix status color

**Files:**
- Modify: `src/components/ui/ProviderChip.tsx`
- Modify: `app/owner/payments-history.tsx`
- Test: none exists for this screen — rely on typecheck only.

**Interfaces:**
- Produces (from `ProviderChip.tsx`): `export const PAYMENT_PROVIDER_BRAND_COLORS: Record<'mtn' | 'vodafone' | 'airteltigo', string>` — the single source of truth for these three payment providers' brand colors, consumed by both `ProviderChip` itself and `payments-history.tsx`.

- [ ] **Step 1: Add a shared brand-color export to `ProviderChip.tsx`**

Old (lines 15-21):
```tsx
const providerConfig: Record<PaymentProvider, { label: string; mark: string; color: string }> = {
  mtn: { label: 'MTN MoMo', mark: 'MTN', color: '#f6c600' },
  telecel: { label: 'Telecel Cash', mark: 'TC', color: '#d71920' },
  at: { label: 'AT Money', mark: 'AT', color: '#0072ce' },
  cash: { label: 'Cash', mark: 'GHc', color: '#1f6a4f' },
  ghqr: { label: 'GhQR', mark: 'QR', color: '#5b6be5' },
};
```

New:
```tsx
// Single source of truth for MTN/Vodafone(Telecel)/AirtelTigo brand colors —
// also consumed directly by app/owner/payments-history.tsx so both files
// render the same provider colors instead of maintaining separate copies.
export const PAYMENT_PROVIDER_BRAND_COLORS: Record<'mtn' | 'vodafone' | 'airteltigo', string> = {
  mtn: '#f6c600',
  vodafone: '#d71920',
  airteltigo: '#0072ce',
};

const providerConfig: Record<PaymentProvider, { label: string; mark: string; color: string }> = {
  mtn: { label: 'MTN MoMo', mark: 'MTN', color: PAYMENT_PROVIDER_BRAND_COLORS.mtn },
  telecel: { label: 'Telecel Cash', mark: 'TC', color: PAYMENT_PROVIDER_BRAND_COLORS.vodafone },
  at: { label: 'AT Money', mark: 'AT', color: PAYMENT_PROVIDER_BRAND_COLORS.airteltigo },
  cash: { label: 'Cash', mark: 'GHc', color: '#1f6a4f' },
  ghqr: { label: 'GhQR', mark: 'QR', color: '#5b6be5' },
};
```

- [ ] **Step 2: Source `payments-history.tsx`'s provider colors from the shared export**

Old (lines 14-22):
```tsx
const PROVIDER_COLORS: Record<string, { bg: string; fg: string }> = {
  mtn:      { bg: '#f6c600', fg: '#1a1208' },
  vodafone: { bg: '#d71920', fg: '#fff' },
  airteltigo: { bg: '#0072ce', fg: '#fff' },
};

function providerColor(provider: string) {
  return PROVIDER_COLORS[provider.toLowerCase()] ?? { bg: '#6b6860', fg: '#fff' };
}
```

New:
```tsx
import { PAYMENT_PROVIDER_BRAND_COLORS } from '@/components/ui/ProviderChip';

const PROVIDER_COLORS: Record<string, { bg: string; fg: string }> = {
  mtn:        { bg: PAYMENT_PROVIDER_BRAND_COLORS.mtn, fg: '#1a1208' },
  vodafone:   { bg: PAYMENT_PROVIDER_BRAND_COLORS.vodafone, fg: '#fff' },
  airteltigo: { bg: PAYMENT_PROVIDER_BRAND_COLORS.airteltigo, fg: '#fff' },
};

function providerColor(provider: string) {
  return PROVIDER_COLORS[provider.toLowerCase()] ?? { bg: '#6b6860', fg: '#fff' };
}
```

(Add the `import { PAYMENT_PROVIDER_BRAND_COLORS } from '@/components/ui/ProviderChip';` line with the file's other imports near the top, not inline where shown.)

- [ ] **Step 3: Fix the one non-theme status color in `statusColor()` (line 51-57)**

Old:
```tsx
function statusColor(status: string, colors: { brand: string; danger: string; muted: string; ink: string }) {
  const normalized = status.toLowerCase();
  if (['completed', 'paid', 'verified'].includes(normalized)) return colors.brand;
  if (['failed', 'cancelled', 'reversed'].includes(normalized)) return colors.danger;
  if (['processing', 'approved'].includes(normalized)) return '#7a5a14';
  return colors.muted;
}
```

New:
```tsx
function statusColor(
  status: string,
  colors: { brand: string; danger: string; muted: string; ink: string; gold: string }
) {
  const normalized = status.toLowerCase();
  if (['completed', 'paid', 'verified'].includes(normalized)) return colors.brand;
  if (['failed', 'cancelled', 'reversed'].includes(normalized)) return colors.danger;
  if (['processing', 'approved'].includes(normalized)) return colors.gold;
  return colors.muted;
}
```

Then update its one call site (around line 524) from:
```tsx
                    <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: statusColor(settlement.status, colors), textTransform: 'capitalize' }}>
```
to (passing the already-destructured `colors` object, which already includes `.gold` — no change needed at the call site itself since `colors` is the full theme object; only the type annotation above changed to stop narrowing it out).

- [ ] **Step 4: Typecheck**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/src/components/ui/ProviderChip.tsx mobile/app/owner/payments-history.tsx
git commit -m "refactor(mobile): dedupe payment-provider brand colors, fix status color

payments-history.tsx maintained its own copy of MTN/Vodafone/AirtelTigo
brand colors identical to ProviderChip's. Now both read from one
exported constant. Also replaces the one non-theme hex ('#7a5a14' for
processing/approved) with colors.gold."
```

---

### Task 4: `cashier.tsx` — move `TILE_COLORS` into shared tokens

**Files:**
- Modify: `src/lib/tokens.ts`
- Modify: `app/owner/cashier.tsx`

**Interfaces:**
- Produces (from `tokens.ts`): `export const categoryTileColors: readonly string[]` — a small decorative palette (NOT semantic — these 12 colors exist purely to give cart tiles visual variety across many item categories, not to represent status/tone. Documented as such so nobody mistakes it for something that needs a `BadgeTone` mapping.)

- [ ] **Step 1: Add the palette export to `src/lib/tokens.ts`**

Append to the end of `src/lib/tokens.ts` (after the existing `radii` export):

```ts
// Decorative-only palette for rotating cart-tile swatches (e.g. cashier quick-tap
// grid). Not semantic — do not map these to BadgeTone/status meaning.
export const categoryTileColors = [
  '#dc2626', '#0f6d4f', '#d4a23a', '#1d4ed8',
  '#7c2d12', '#0891b2', '#a16207', '#92400e',
  '#15803d', '#b91c1c', '#6b6860', '#1f6a4f',
] as const;
```

- [ ] **Step 2: Replace `cashier.tsx`'s local array with the import**

Old (line 19):
```tsx
const TILE_COLORS = ['#dc2626', '#0f6d4f', '#d4a23a', '#1d4ed8', '#7c2d12', '#0891b2', '#a16207', '#92400e', '#15803d', '#b91c1c', '#6b6860', '#1f6a4f'];
```

New: delete that line entirely, and add this import alongside `cashier.tsx`'s existing `@/lib/theme` import:
```tsx
import { categoryTileColors as TILE_COLORS } from '@/lib/tokens';
```

(The rename via `as TILE_COLORS` means the rest of the file — e.g. `TILE_COLORS[i % TILE_COLORS.length]` at line 389 — needs no further changes.)

- [ ] **Step 3: Typecheck**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/src/lib/tokens.ts mobile/app/owner/cashier.tsx
git commit -m "refactor(mobile): move cashier tile-color palette into shared tokens

Centralizes the 12-color cart-tile swatch palette in src/lib/tokens.ts
instead of embedding it in cashier.tsx, documented as decorative-only
so it isn't mistaken for a semantic status mapping."
```

---

### Task 5: `payroll.tsx` — fix status-dot function and two inline status badges

**Files:**
- Modify: `app/owner/payroll.tsx`
- Test: `__tests__/screens/payrollScreen.test.tsx` (existing — run to confirm no regression)

**Interfaces:**
- Consumes: `Badge` from Task 1.

- [ ] **Step 1: Add the `Badge` import**

Add near `payroll.tsx`'s other component imports:
```tsx
import { Badge, type BadgeTone } from '@/components/ui/Badge';
```

- [ ] **Step 2: Fix `statusColor()` (lines 101-107)**

Old:
```tsx
  function statusColor(status?: string) {
    if (status === 'disbursed') return colors.brand;
    if (status === 'completed') return '#f59e0b';
    if (status === 'approved') return '#10b981';
    if (status === 'processing') return '#6366f1';
    return colors.muted;
  }
```

New:
```tsx
  function statusColor(status?: string) {
    if (status === 'disbursed') return colors.brand;
    if (status === 'completed') return colors.gold;
    if (status === 'approved') return colors.brand;
    if (status === 'processing') return colors.info;
    return colors.muted;
  }
```

This is used only as a small 6×6 status-dot background (line 812: `backgroundColor: statusColor(run.status)`) next to a text label that's already `colors.muted` regardless of status, so no further change is needed at that call site.

- [ ] **Step 3: Replace the employee base-pay paid/pending chip (around lines 559-578)**

Old:
```tsx
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View
                        style={{
                          paddingHorizontal: 7,
                          paddingVertical: 2,
                          borderRadius: 999,
                          backgroundColor:
                            status === 'paid' ? `${colors.brand}15` : '#fff5cc',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            fontFamily: fonts.bodySemiBold,
                            color: status === 'paid' ? colors.brand : '#b6831e',
                          }}
                        >
                          {status === 'paid' ? 'Paid' : 'Pending'}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => openEdit(emp)} hitSlop={8}>
```

New:
```tsx
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Badge tone={status === 'paid' ? 'success' : 'warning'} label={status === 'paid' ? 'Paid' : 'Pending'} />
                      <TouchableOpacity onPress={() => openEdit(emp)} hitSlop={8}>
```

- [ ] **Step 4: Replace the payslip status map/badge (around lines 884-889 and its render)**

Old:
```tsx
                        const statusStyles: Record<string, { bg: string; color: string; label: string }> = {
                          paid:    { bg: `${colors.brand}15`, color: colors.brand,  label: 'Paid' },
                          pending: { bg: '#fff5cc',           color: '#b6831e',     label: 'Pending' },
                          skipped: { bg: '#fee2e2',           color: '#dc2626',     label: 'Skipped' },
                        };
                        const ss = statusStyles[slipStatus];
```

New:
```tsx
                        const statusStyles: Record<string, { tone: BadgeTone; label: string }> = {
                          paid:    { tone: 'success', label: 'Paid' },
                          pending: { tone: 'warning', label: 'Pending' },
                          skipped: { tone: 'danger',  label: 'Skipped' },
                        };
                        const ss = statusStyles[slipStatus];
```

Then find wherever `ss.bg`/`ss.color`/`ss.label` are used to render this payslip's status chip (search for `ss.bg` in the file) and replace that `<View>`/`<Text>` pair with `<Badge tone={ss.tone} label={ss.label} />`, following the exact same pattern as Step 3.

- [ ] **Step 5: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- payrollScreen.test.tsx
```
Expected: both pass with no failures.

- [ ] **Step 6: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/payroll.tsx
git commit -m "refactor(mobile): replace payroll's hardcoded status colors with theme tokens/Badge

statusColor() used 3 raw hex values instead of theme colors; the
base-pay and payslip status chips duplicated their own bg/color pairs
instead of using Badge. All now map to colors.*/Badge tone consistently
with the rest of the app."
```

---

### Task 6: `inventory.tsx` — fix `poStatusColor()` and the low-stock hero tint

**Files:**
- Modify: `app/owner/inventory.tsx`
- Test: `__tests__/screens/inventoryScreen.test.tsx` (existing — run to confirm no regression)

- [ ] **Step 1: Fix `poStatusColor()` (lines 450-456)**

Old:
```tsx
  function poStatusColor(status: string) {
    if (status === 'received') return colors.brand;
    if (status === 'submitted' || status === 'ordered') return '#3b82f6';
    if (status === 'partially_received') return '#b6831e';
    if (status === 'cancelled') return colors.danger;
    return colors.muted; // draft
  }
```

New:
```tsx
  function poStatusColor(status: string) {
    if (status === 'received') return colors.brand;
    if (status === 'submitted' || status === 'ordered') return colors.info;
    if (status === 'partially_received') return colors.gold;
    if (status === 'cancelled') return colors.danger;
    return colors.muted; // draft
  }
```

(Used only as a 6×6 status-dot background at line 939 — no call-site change needed.)

- [ ] **Step 2: Fix the low-stock hero tint (lines 149-161)**

Old:
```tsx
        <View style={{
          padding: 14, borderRadius: 16,
          backgroundColor: isLow ? '#fff5cc' : `${colors.brand}10`,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                On hand
              </Text>
              <Text style={{
                fontFamily: fonts.displaySemiBold, fontSize: 32, marginTop: 2,
                color: isLow ? '#b6831e' : colors.brand,
              }}>
```

New:
```tsx
        <View style={{
          padding: 14, borderRadius: 16,
          backgroundColor: isLow ? `${colors.gold}18` : `${colors.brand}10`,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                On hand
              </Text>
              <Text style={{
                fontFamily: fonts.displaySemiBold, fontSize: 32, marginTop: 2,
                color: isLow ? colors.gold : colors.brand,
              }}>
```

- [ ] **Step 3: Fix the two remaining `isLow` low-stock tint occurrences in this file**

Search `inventory.tsx` for `'#fff5cc'` and `'#b6831e'` (there are two more pairs, around lines 690-692 and 729-754, both gating on `isLow`/`t.warn`). For each, replace `'#fff5cc'` with `` `${colors.gold}18` `` and `'#b6831e'` with `colors.gold`, keeping the surrounding ternary/ ` isLow ? X : Y` structure exactly as-is — only the hex literals change.

- [ ] **Step 4: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- inventoryScreen.test.tsx
```
Expected: both pass with no failures.

- [ ] **Step 5: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/inventory.tsx
git commit -m "refactor(mobile): replace inventory's hardcoded warning-tint hex with theme tokens

poStatusColor() and the low-stock highlight both used raw hex
('#3b82f6', '#b6831e', '#fff5cc') instead of colors.info/colors.gold,
producing a slightly different amber than the rest of the app uses
for warnings."
```

---

### Task 7: `sell.tsx` — consolidate duplicate warning-tint hex values

**Files:**
- Modify: `app/owner/sell.tsx`
- Test: `__tests__/screens/sellScreen.test.tsx` (existing — run to confirm no regression)

**Interfaces:**
- None new — this task only consolidates three near-duplicate amber/gold tints already used elsewhere in the app (`'#fff5cc'`/`'#b6831e'` and the close variant `'#fff8e1'`/`'#78350f'`/`'#92650a'`) into the single canonical `` `${colors.gold}18` ``/`colors.gold` pair established in Task 1/2/6.

- [ ] **Step 1: Fix the credit payment-mode tile accent (lines 399-417)**

Old:
```tsx
            { mode: 'credit' as SaleMode, icon: 'file-document', label: 'Credit', sub: 'Pay later', accent: '#b6831e' },
          ].map((m) => (
```
and
```tsx
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: m.mode === 'credit' ? '#fff5cc' : `${m.accent}15`,
                alignItems: 'center', justifyContent: 'center',
              }}>
```

New:
```tsx
            { mode: 'credit' as SaleMode, icon: 'file-document', label: 'Credit', sub: 'Pay later', accent: colors.gold },
          ].map((m) => (
```
and
```tsx
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: m.mode === 'credit' ? `${colors.gold}18` : `${m.accent}15`,
                alignItems: 'center', justifyContent: 'center',
              }}>
```

- [ ] **Step 2: Fix the "waiting for MoMo approval" banner (lines 665-673)**

Old:
```tsx
          <View style={{
            backgroundColor: '#fff8e1', borderRadius: 10,
            paddingHorizontal: 12, paddingVertical: 7,
            marginTop: 6, marginHorizontal: 24,
          }}>
            <Text style={{ fontSize: 12, color: '#78350f', textAlign: 'center' }}>
```

New:
```tsx
          <View style={{
            backgroundColor: `${colors.gold}18`, borderRadius: 10,
            paddingHorizontal: 12, paddingVertical: 7,
            marginTop: 6, marginHorizontal: 24,
          }}>
            <Text style={{ fontSize: 12, color: colors.gold, textAlign: 'center' }}>
```

- [ ] **Step 3: Fix the receipt status chip (lines 696-704)**

Old:
```tsx
              <View style={{
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                backgroundColor: isOffline ? '#fff5cc' : method === 'momo' ? '#fff8e1' : `${colors.brand}15`,
              }}>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: isOffline ? '#b6831e' : method === 'momo' ? '#92650a' : colors.brand }}>
                  {isOffline ? 'Queued' : method === 'credit' ? 'Due' : method === 'momo' ? 'Pending' : 'Paid'}
                </Text>
              </View>
```

New:
```tsx
              <View style={{
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                backgroundColor: isOffline || method === 'momo' ? `${colors.gold}18` : `${colors.brand}15`,
              }}>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: isOffline || method === 'momo' ? colors.gold : colors.brand }}>
                  {isOffline ? 'Queued' : method === 'credit' ? 'Due' : method === 'momo' ? 'Pending' : 'Paid'}
                </Text>
              </View>
```

- [ ] **Step 4: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- sellScreen.test.tsx
```
Expected: both pass with no failures.

- [ ] **Step 5: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/sell.tsx
git commit -m "refactor(mobile): consolidate sell screen's duplicate warning-tint hex values

Three near-identical amber tints ('#fff5cc'/'#b6831e' and
'#fff8e1'/'#78350f'/'#92650a') collapsed into the one canonical
colors.gold-based warning tone used across the rest of the app."
```

---

## Explicitly not covered by this plan

- `analytics.tsx`'s "Industry benchmarks" tab was checked and found to already use theme tokens throughout, with an honest "we're building this" disclaimer — no fix needed (the original spec assumption that it needed a placeholder fix didn't hold up once the code was read).
- Pull-to-refresh sweep (spec Tier 2) and destructive-action confirmations (spec Tier 3) are separate follow-up plans, written after this one has landed and been reviewed.
