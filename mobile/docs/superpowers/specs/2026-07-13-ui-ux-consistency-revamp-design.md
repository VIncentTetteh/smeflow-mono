# Mobile UI/UX Consistency Revamp

**Date:** 2026-07-13
**Status:** Approved

## Context

SMEflow's mobile app already has a deliberate, well-designed foundation: a warm editorial color palette + serif/sans font pairing (`src/lib/tokens.ts`), a `useTheme()` hook, and a shared component library (`Button`, `Badge`, `Card`, `Inputs`, `Overlays.Modal/BottomSheet/SnackBar`, `Screen`, `Skeleton`, `StatusMessage`). `owner/index.tsx` (home dashboard), `owner/settings.tsx`, and `owner/more.tsx` show what "done well" looks like: consistent token usage, loading skeletons, error-with-retry states, empty states, and confirmation dialogs on destructive actions.

An audit of all ~40 screens under `app/owner/`, `app/agent/`, and `app/(auth)/` found that quality is inconsistent — not because the design system is missing, but because many screens bypass it:

- **~150 hardcoded hex colors** scattered across screens, concentrated in the largest files: `credit.tsx` (28, via `LOAN_STATUS`/`INSTALMENT_STATUS` maps), `payroll.tsx`, `inventory.tsx`, `sell.tsx` (via `TILE_COLORS`), `cashier.tsx` (via `TILE_COLORS`), `payments-history.tsx`.
- **Missing confirmation dialogs** before destructive actions on 8+ screens (delete item, remove team member, void sale, cancel subscription, etc.) despite `Overlays.Modal` already supporting `confirmLabel`/`onConfirm` for exactly this.
- **Pull-to-refresh missing** on ~24 of 31 owner screens that display live/server data, despite the pattern already existing in `index.tsx` and `sync.tsx`.
- **Inconsistent disabled-button styling** — several screens use raw `TouchableOpacity` with ad-hoc `opacity` values (0.4, 0.6) instead of the shared `Button` component, which already handles `disabled`/`loading` correctly.
- One dead-end placeholder: `analytics.tsx` shows an unexplained "Coming soon" string.

This is a polish/consistency pass, not a rebuild. The goal is to bring every screen up to the bar `index.tsx` already sets, using only what already exists in the design system, plus one small necessary extension.

## Goals

- Every screen renders status/state information via `Badge`/`AlertRow`-style tone coloring — zero hardcoded hex colors for anything that represents state (status, role, payment method, tile category).
- Every destructive action (delete, remove, void, cancel) requires explicit confirmation.
- Every screen showing live server data supports pull-to-refresh.
- Every actionable button, including disabled states, goes through the shared `Button` component.
- No placeholder/dead-end UI ships without a real state (either implemented or an honest "not available on your plan" / roadmap message consistent with `UpgradePrompt`/`PlanGatedScreen`).

## Non-goals (explicitly out of scope)

- No i18n/Twi string extraction — deferred; noted as follow-up work.
- No structural refactor of mega-files (`payroll.tsx`, `inventory.tsx`, `sell.tsx` stay as single files) — only styling/consistency changes within them.
- No new features, no backend/API changes, no navigation/routing changes.
- No change to business logic, calculations, or data fetching behavior.

## Design

### 1. Design-system extension: generic `tone` on `Badge`

`Badge` (`src/components/ui/Badge.tsx`) currently exposes a fixed enum of domain-specific variants (`paid`, `pending`, `failed`, `synced`, `offline`, `low-stock`, `verified`, `draft`). This enum doesn't cover loan statuses, payroll roles, or payment methods, which is exactly why `credit.tsx` and others built their own hex-color maps instead of reusing `Badge`.

Add a parallel, more general prop:

```typescript
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;   // existing, kept for backward compatibility
  tone?: BadgeTone;         // new
  label: string;
}
```

When `tone` is provided, it takes precedence over `variant` and maps to the same visual language `AlertRow` on the home screen already uses (`warn` → gold, `info` → info blue, `success` → brand green, `danger` → danger red), plus `neutral` → ink-on-surface for default/no-status states. Existing `variant` usages are untouched — this is additive.

Each screen keeps a small local `status → tone` lookup (strings only, no color values), e.g.:

```typescript
const LOAN_STATUS_TONE: Record<string, BadgeTone> = {
  disbursed: 'success',
  repaid: 'success',
  pending_partner: 'warning',
  rejected: 'danger',
  defaulted: 'danger',
  collecting: 'info',
};
```

This is the only new code introduced by this project. Everything else is applying existing components consistently.

### 2. Screen remediation, in priority order

**Tier 1 — worst offenders (hardcoded colors + largest files):**
`credit.tsx`, `payroll.tsx`, `inventory.tsx`, `sell.tsx`, `cashier.tsx`, `payments-history.tsx`.
For each: replace local hex-color maps and inline `backgroundColor: '#...'` with `Badge tone=...` or `theme.colors`; replace `TILE_COLORS` arrays with a small derived palette from `theme.colors` (e.g., rotating brand/gold/info/muted at set opacities) so tile coloring stays visually varied without inventing new hex values. Fix `analytics.tsx`'s "Coming soon" to either link to the real feature if it exists, or use `UpgradePrompt`/a clear "not yet available" `StatusMessage`.

**Tier 2 — pull-to-refresh:**
Add `RefreshControl` (matching the `index.tsx`/`sync.tsx` pattern: local `refreshing` state, invalidate the relevant TanStack Query keys, `syncNow()` if the screen reads WatermelonDB data) to the ~18 screens currently missing it, prioritizing high-traffic ones: `inventory.tsx`, `stock.tsx`, `team.tsx`, `credit.tsx`, `payroll.tsx`, `tax.tsx`, `reconciliation.tsx`, `message-deliveries.tsx`, `customers.tsx`, `invoices.tsx` (if missing), etc.

**Tier 3 — confirmations + disabled-button consistency:**
Add `Alert.alert(...)` (simple case) or `Overlays.Modal` with `confirmLabel`/`onConfirm` (when more context/detail is needed) before destructive actions on: `inventory.tsx` (delete item), `stock.tsx`, `team.tsx` (remove member), `customers.tsx` (delete customer), plus any sale-voiding/subscription-cancelling actions found missing one during implementation. Replace raw `TouchableOpacity` + manual `opacity` for disabled states with the shared `Button` component wherever the action is a standard button (not a custom tile/card tap target, which can keep its own layout but should use `theme.colors.muted`-based dimming instead of arbitrary opacity numbers).

### 3. Validation

This project changes styling and adds UX affordances but not business logic, so:
- Existing test suites (mobile Jest/RTL, `__tests__/`) must stay green — no logic changes means no test changes expected, except where a test snapshots exact colors/styles that change.
- Run `tsc`/`make lint` (or mobile equivalent) after each screen change.
- Manually spot-check the three highest-traffic touched screens (`sell.tsx`, `credit.tsx`, `payroll.tsx`) in the simulator/device for visual regressions and to confirm confirmation dialogs and pull-to-refresh work end-to-end. Not every one of the ~40 screens needs a manual pass — the Tier 1 screens are the highest-risk/highest-visibility and get direct verification; Tier 2/3 changes are mechanical enough (adding `RefreshControl`, adding `Alert.alert`) to verify via code review + lint/typecheck.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Replacing hardcoded colors changes visual meaning (e.g., a status that was red becomes a different tone) | Preserve existing color *semantics* per status when mapping to `tone` — read each current hex value's intent (danger/warning/success/info) before mapping, don't guess |
| `RefreshControl` added to a screen whose data source doesn't actually support a cheap refetch | Check each screen's query hooks before adding; skip (and note) any screen where refresh would be a no-op or expensive with no visible benefit |
| Large screens (1000+ lines) become error-prone to edit safely without splitting first | Explicitly deferred (non-goal) — apply changes as scoped, minimal diffs; if a screen proves genuinely unsafe to touch without splitting, flag it rather than force the change |
