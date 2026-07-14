# UI/UX Consistency Revamp — Tier 2 (Pull-to-Refresh, Batch 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pull-to-refresh (`RefreshControl`) to four owner screens that display live server data but currently lack it: `team.tsx`, `credit.tsx`, `message-deliveries.tsx`, `customers.tsx`.

**Architecture:** Each screen gets a local `refreshing` boolean state, an async `handleRefresh()` that re-fetches the screen's own query data, and a `RefreshControl` wired onto its main `ScrollView` — following the exact pattern already shipped in `app/owner/tax.tsx` (`refreshing` state + `Promise.all([...refetch()])` + `refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}`). No new components, no query-key/backend changes.

**Tech Stack:** React Native + Expo Router, TypeScript strict mode, `@tanstack/react-query` (`.refetch()` on query results), Jest for tests.

## Global Constraints

- No new features, no navigation changes, no business-logic changes — this only adds a refresh affordance.
- Match the exact `tax.tsx` pattern: `refreshing` state name, `handleRefresh` function name, `tintColor={colors.brand}`, `RefreshControl` from `react-native`.
- `npm run typecheck` must show no NEW errors versus the current baseline of exactly 3 pre-existing errors (in `__tests__/screens/billingScreen.test.tsx` and `__tests__/screens/reconciliationScreen.test.tsx`, an unrelated `Alert.alert` mock signature issue).
- Where a screen has an existing test file, it must still pass unchanged (pure additive UI change, no behavior change to existing flows).
- `team.tsx`'s member list is NOT backed by a mounted `useQuery` in this screen — it reads `useAuthStore((state) => state.members)`, a Zustand slice populated by `applySessionBootstrap()` (see `app/_layout.tsx:81-83` and `110-111`, and `src/api/hooks/sessionHooks.ts:166-193`'s mutations, which all invalidate `['session-bootstrap']` but rely on `_layout.tsx`'s mount to actually refetch). Its refresh handler must call `fetchSessionBootstrap()` + `applySessionBootstrap(data)` directly (both exported from `@/api/hooks/sessionHooks`), not `queryClient.invalidateQueries`.

---

### Task 1: `team.tsx` — pull-to-refresh via session bootstrap

**Files:**
- Modify: `app/owner/team.tsx`
- Test: `__tests__/screens/teamScreen.test.tsx` (existing — run to confirm no regression)

**Interfaces:**
- Consumes: `fetchSessionBootstrap(): Promise<BootstrapResult>` and `applySessionBootstrap(data: BootstrapResult): void`, both exported from `@/api/hooks/sessionHooks` (already used identically in `app/_layout.tsx`).

- [ ] **Step 1: Add `RefreshControl` to the `react-native` import**

Old (line 2):
```tsx
import { ActivityIndicator, Alert, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
```

New:
```tsx
import { ActivityIndicator, Alert, RefreshControl, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
```

- [ ] **Step 2: Import the session-bootstrap helpers**

Add this import alongside the existing `@/api/hooks/sessionHooks` import (lines 6-10):
```tsx
import {
  useDeactivateBusinessMember,
  useInviteBusinessMember,
  useUpdateBusinessMember,
  fetchSessionBootstrap,
  applySessionBootstrap,
} from '@/api/hooks/sessionHooks';
```

- [ ] **Step 3: Add `refreshing` state and `handleRefresh`**

Add this right after the existing state declarations (after line 34, `const [inviteRole, ...] = useState(...)`):
```tsx
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const data = await fetchSessionBootstrap();
      applySessionBootstrap(data);
    } finally {
      setRefreshing(false);
    }
  }
```

`useState` is already imported from `react` at the top of this file — no new import needed for that.

- [ ] **Step 4: Wire `RefreshControl` onto the main `ScrollView`**

Old (line 91):
```tsx
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
```

New:
```tsx
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
      >
```

- [ ] **Step 5: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- teamScreen.test.tsx
```
Expected: typecheck shows exactly the 3 pre-existing baseline errors (none mentioning `team.tsx` or `teamScreen.test.tsx`); all existing `teamScreen.test.tsx` tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/team.tsx
git commit -m "feat(mobile): add pull-to-refresh to team screen

Team membership is a Zustand slice populated by applySessionBootstrap
(app/_layout.tsx), not a locally-mounted query, so refresh re-runs
fetchSessionBootstrap + applySessionBootstrap directly rather than
queryClient.invalidateQueries."
```

---

### Task 2: `credit.tsx` — pull-to-refresh via query refetch

**Files:**
- Modify: `app/owner/credit.tsx`
- Test: `__tests__/screens/creditScreen.test.tsx` (existing — run to confirm no regression)

**Interfaces:**
- Consumes: the existing `useCreditScore`, `useCreditRequests`, `useActiveLenders` query result objects already destructured in this screen (`scoreLoading`/`scoreData` via `useCreditScore`, `requests` via `useCreditRequests`, `lendersQuery` via `useActiveLenders` — note `lendersQuery` is already bound to the full query object, not destructured, so `lendersQuery.refetch()` is directly available).

- [ ] **Step 1: Add `RefreshControl` to the `react-native` import**

Old (line 2):
```tsx
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
```

New:
```tsx
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
```

- [ ] **Step 2: Capture the two currently-destructured queries as full objects too, and add refresh state**

Old (lines 46-49):
```tsx
  const { data: scoreData, isLoading: scoreLoading } = useCreditScore(creditReady);
  const { data: requests } = useCreditRequests(creditReady);
  const lendersQuery = useActiveLenders(creditReady);
  const lenders = lendersQuery.data ?? [];
```

New:
```tsx
  const scoreQuery = useCreditScore(creditReady);
  const { data: scoreData, isLoading: scoreLoading } = scoreQuery;
  const requestsQuery = useCreditRequests(creditReady);
  const { data: requests } = requestsQuery;
  const lendersQuery = useActiveLenders(creditReady);
  const lenders = lendersQuery.data ?? [];
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([
      scoreQuery.refetch(),
      requestsQuery.refetch(),
      lendersQuery.refetch(),
    ]);
    setRefreshing(false);
  }
```

- [ ] **Step 3: Wire `RefreshControl` onto the main `ScrollView`**

Old (line 170):
```tsx
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
```

New:
```tsx
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
      >
```

Do NOT touch the second `ScrollView` in this file (inside the loan-detail modal, `showsVerticalScrollIndicator={false}`) — that's a sub-view for one selected loan, not the main list, and is out of scope.

- [ ] **Step 4: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- creditScreen.test.tsx
```
Expected: typecheck shows exactly the 3 pre-existing baseline errors (none mentioning `credit.tsx` or `creditScreen.test.tsx`); all existing `creditScreen.test.tsx` tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/credit.tsx
git commit -m "feat(mobile): add pull-to-refresh to credit & loans screen

Refetches the score, loan-requests, and active-lenders queries in
parallel, following the same Promise.all(...refetch()) pattern
already used in tax.tsx."
```

---

### Task 3: `message-deliveries.tsx` — pull-to-refresh via query refetch

**Files:**
- Modify: `app/owner/message-deliveries.tsx`
- Test: `__tests__/screens/messageDeliveries.test.tsx` (existing — run to confirm no regression)

**Interfaces:**
- Consumes: the existing `deliveries` query result object (`const deliveries = useCustomerDeliveries();`) — `deliveries.refetch()` is directly available.

- [ ] **Step 1: Add `useState` and `RefreshControl` imports**

Old (line 1):
```tsx
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
```

New:
```tsx
import { ActivityIndicator, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
```

This file currently has no top-level `react` import at all (confirmed: no `useState` is used anywhere in it today). Add this as a new line immediately before the `react-native` import:
```tsx
import { useState } from 'react';
```

- [ ] **Step 2: Add refresh state and handler**

Old (lines 9-13):
```tsx
export default function MessageDeliveriesScreen() {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const deliveries = useCustomerDeliveries();
  const retry = useRetryCustomerDelivery();
```

New:
```tsx
export default function MessageDeliveriesScreen() {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const deliveries = useCustomerDeliveries();
  const retry = useRetryCustomerDelivery();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await deliveries.refetch();
    setRefreshing(false);
  }
```

- [ ] **Step 3: Wire `RefreshControl` onto the `ScrollView`**

Old (line 24):
```tsx
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
```

New:
```tsx
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
      >
```

- [ ] **Step 4: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- messageDeliveries.test.tsx
```
Expected: typecheck shows exactly the 3 pre-existing baseline errors (none mentioning `message-deliveries.tsx` or `messageDeliveries.test.tsx`); all existing tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/message-deliveries.tsx
git commit -m "feat(mobile): add pull-to-refresh to customer messages screen"
```

---

### Task 4: `customers.tsx` — pull-to-refresh via query refetch

**Files:**
- Modify: `app/owner/customers.tsx`
- Test: none exists for this screen — rely on typecheck only.

**Interfaces:**
- Consumes: the existing `useCustomers(debouncedSearch || undefined)` query — needs to be captured as a full object (currently destructured directly) so `.refetch()` is reachable.

- [ ] **Step 1: Add `RefreshControl` to the `react-native` import**

Old (line 2):
```tsx
import { Modal, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
```

New:
```tsx
import { Modal, RefreshControl, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
```

- [ ] **Step 2: Capture the customers query as a full object and add refresh state**

Old (line 138):
```tsx
  const { data, isLoading } = useCustomers(debouncedSearch || undefined);
```

New:
```tsx
  const customersQuery = useCustomers(debouncedSearch || undefined);
  const { data, isLoading } = customersQuery;
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await customersQuery.refetch();
    setRefreshing(false);
  }
```

`useState` is already imported from `react` at the top of this file (it's used for `search`/`selectedId`) — no new import needed.

- [ ] **Step 3: Wire `RefreshControl` onto the main `ScrollView`**

Old (line 177):
```tsx
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
```

New:
```tsx
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
      >
```

Do NOT touch the `ScrollView` at line 29 — that one belongs to `CustomerDetailSheet`, a separate sub-component (a modal showing one customer's detail), not the main list, and is out of scope.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
```
Expected: exactly the 3 pre-existing baseline errors, none mentioning `customers.tsx`.

- [ ] **Step 5: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/customers.tsx
git commit -m "feat(mobile): add pull-to-refresh to customers screen"
```

---

## Explicitly not covered by this plan

- `payroll.tsx` and `inventory.tsx` also need pull-to-refresh, but each has 3-4 separate tab-specific `ScrollView`s requiring individual `RefreshControl` wiring (not a single main list) — these need their own follow-up plan (Tier 2, Batch 2) with the same per-tab reading rigor applied here, rather than being folded into this batch.
- The remaining screens named in the original design spec's Tier 2 list (`stock.tsx`) turned out to be an orphaned duplicate of `analytics.tsx` reachable only via a buggy onboarding route — fixed separately (see commit `ebc9833`, "fix(mobile): route onboarding's inventory step to the real inventory screen") and removed from scope entirely rather than given pull-to-refresh.
- Tier 3 (destructive-action confirmations) remains a separate plan, written after this one lands.
