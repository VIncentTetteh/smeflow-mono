# UI/UX Consistency Revamp — Tier 2 Batch 2 (Pull-to-Refresh: Payroll & Inventory) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pull-to-refresh to `app/owner/payroll.tsx` (2 tabs) and `app/owner/inventory.tsx` (4 sections), the two screens deferred from Tier 2 Batch 1 because each has multiple tab/section-specific `ScrollView`s instead of one main list.

**Architecture:** Same established pattern as Batch 1 and `app/owner/tax.tsx`: a `refreshing` boolean state, an async `handleRefresh()`, and `<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />` wired onto each relevant `ScrollView`. Both screens have **horizontal filter-chip strips** (payroll's employee filter, inventory's item-category filter) that must NOT receive `RefreshControl` — only the main vertical content `ScrollView` per tab/section does. Both screens share `refreshing` state across their tabs/sections (one flag, not one per tab), with `handleRefresh` branching on which tab/section is currently active so a pull only refetches what's visible.

**Tech Stack:** React Native + Expo Router, TypeScript strict mode, `@tanstack/react-query`, WatermelonDB (`syncNow()` + local `reload()` for inventory's "items" section only), Jest.

## Global Constraints

- No new features, no navigation changes, no business-logic changes — this only adds a refresh affordance.
- Match the exact `tax.tsx` pattern: `refreshing` state name, `handleRefresh` function name, `tintColor={colors.brand}`, `RefreshControl` from `react-native`.
- Do NOT add `RefreshControl` to any horizontal filter-chip `ScrollView` (payroll's employee-filter strip, inventory's item-category-filter strip) — only to the main vertical content `ScrollView` per tab/section.
- `npm run typecheck` must show no NEW errors versus the baseline of exactly 3 pre-existing errors (in `__tests__/screens/billingScreen.test.tsx` and `__tests__/screens/reconciliationScreen.test.tsx`, an unrelated `Alert.alert` mock signature issue).
- Existing test files (`__tests__/screens/payrollScreen.test.tsx`, `__tests__/screens/inventoryScreen.test.tsx`) must still pass unchanged.

---

### Task 1: `payroll.tsx` — pull-to-refresh across both tabs

**Files:**
- Modify: `app/owner/payroll.tsx`
- Test: `__tests__/screens/payrollScreen.test.tsx` (existing — run to confirm no regression)

**Interfaces:**
- Consumes: the existing `usePayroll()` query, which backs BOTH tabs (`data.employees` for the "team" tab, `data.runs` for the "history" tab) — captured as a full object so `.refetch()` is reachable.

This screen has exactly 2 tabs, controlled by `const [activeTab, setActiveTab] = useState<Tab>('team');` where `type Tab = 'team' | 'history';` (already defined at the top of the file). There are 3 `ScrollView`s total:
- Line ~326 (`{activeTab === 'team' && (<ScrollView ...>`): the TEAM tab's main content — **needs** `RefreshControl`.
- Line ~584 (`horizontal` employee-filter chip strip inside the HISTORY tab): **must NOT** get `RefreshControl` (horizontal filter chips, not a refreshable list).
- Line ~643 (the HISTORY tab's "Runs list", `contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 }}`): the HISTORY tab's main content — **needs** `RefreshControl`.

Both tabs are refreshed via the same underlying query (`usePayroll()`), so one shared `handleRefresh` covers both.

- [ ] **Step 1: Add `RefreshControl` to the `react-native` import**

Old:
```tsx
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
```

New:
```tsx
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
```

- [ ] **Step 2: Capture the payroll query as a full object, add refresh state**

Old (line 38):
```tsx
  const { data, isLoading } = usePayroll();
```

New:
```tsx
  const payrollQuery = usePayroll();
  const { data, isLoading } = payrollQuery;
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await payrollQuery.refetch();
    setRefreshing(false);
  }
```

- [ ] **Step 3: Wire `RefreshControl` onto the TEAM tab's `ScrollView`**

Old:
```tsx
      {activeTab === 'team' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
        >
```

New:
```tsx
      {activeTab === 'team' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
        >
```

- [ ] **Step 4: Wire `RefreshControl` onto the HISTORY tab's "Runs list" `ScrollView` only (not the horizontal filter-chip strip above it)**

Old:
```tsx
          {/* Runs list */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 }}
          >
```

New:
```tsx
          {/* Runs list */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
          >
```

Do NOT touch the `horizontal` employee-filter-chip `ScrollView` that appears just above this one (the "Employee filter chips" block) — it must remain exactly as-is, with no `refreshControl` prop.

- [ ] **Step 5: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- payrollScreen.test.tsx
```
Expected: typecheck shows exactly the 3 pre-existing baseline errors (none mentioning `payroll.tsx` or `payrollScreen.test.tsx`); all existing `payrollScreen.test.tsx` tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/payroll.tsx
git commit -m "feat(mobile): add pull-to-refresh to payroll screen (team + history tabs)

Both tabs are backed by the same usePayroll() query (employees and
runs are both fields on its single response), so one shared
handleRefresh refetches it and serves RefreshControl on both tabs'
main content ScrollViews. The horizontal employee-filter chip strip
inside the history tab is explicitly left untouched."
```

---

### Task 2: `inventory.tsx` — pull-to-refresh across all four sections

**Files:**
- Modify: `app/owner/inventory.tsx`
- Test: `__tests__/screens/inventoryScreen.test.tsx` (existing — run to confirm no regression)

**Interfaces:**
- Consumes: `syncNow()` from `@/db/sync/service` (already used identically in `app/owner/index.tsx`), `reload()` from the existing `useLocalItems()` destructure, and the existing `topItems`/`suppliers`/`purchaseOrders` query objects (already bound as full objects, not destructured — `.refetch()` is already reachable on all three with no refactor needed).

This screen has 4 sections, controlled by `const [section, setSection] = useState<'items' | 'suppliers' | 'orders' | 'performance'>('items');`. There are 6 `ScrollView`s in the main `InventoryScreen` component (a 7th, at line ~147, belongs to a different, earlier component in this file and is out of scope — that's an item-detail sub-screen, not part of `InventoryScreen`'s section switcher):
- Line ~661 (`horizontal` item-category-filter chip strip, "All" / "Low stock", inside the ITEMS section): **must NOT** get `RefreshControl`.
- Line ~706 (`{/* Item list */}`, the ITEMS section's main vertical list, uses `useLocalItems()`'s `items`/`loading`): **needs** `RefreshControl`, refreshed via `syncNow()` + `reload()` (WatermelonDB local-first pattern, matching `index.tsx`).
- Line ~767 (PERFORMANCE section, backed by `topItems`): **needs** `RefreshControl`, refreshed via `topItems.refetch()`.
- Line ~847 (SUPPLIERS section, backed by `suppliers`): **needs** `RefreshControl`, refreshed via `suppliers.refetch()`.
- Line ~901 (ORDERS section, backed by `purchaseOrders`): **needs** `RefreshControl`, refreshed via `purchaseOrders.refetch()`.
- Lines ~1002, ~1176, ~1283: all inside modals (add-item, create-PO wizard steps) — **out of scope**, do not touch.

One shared `refreshing` state covers all 4 sections; `handleRefresh` branches on the current `section` so a pull only refetches the data actually visible.

- [ ] **Step 1: Add `RefreshControl` to the `react-native` import**

Old:
```tsx
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
```

New:
```tsx
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
```

- [ ] **Step 2: Add the `syncNow` import**

Add this import alongside the other `@/` imports near the top of the file (any position among them is fine — match the file's existing import grouping style):
```tsx
import { syncNow } from '@/db/sync/service';
```

- [ ] **Step 3: Add refresh state and the section-aware `handleRefresh`**

Add this right after `const [expandedPoId, setExpandedPoId] = useState<string | null>(null);` (so `reload`, `topItems`, `suppliers`, and `purchaseOrders` are all already in scope above this point):
```tsx
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      if (section === 'items') {
        await syncNow();
        await reload();
      } else if (section === 'performance') {
        await topItems.refetch();
      } else if (section === 'suppliers') {
        await suppliers.refetch();
      } else if (section === 'orders') {
        await purchaseOrders.refetch();
      }
    } finally {
      setRefreshing(false);
    }
  }
```

- [ ] **Step 4: Wire `RefreshControl` onto the ITEMS section's main list `ScrollView` (not the horizontal filter-chip strip above it)**

Old:
```tsx
      {/* Item list */}
      {section === 'items' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
```

New:
```tsx
      {/* Item list */}
      {section === 'items' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
        >
```

Do NOT touch the `horizontal` item-category-filter `ScrollView` ("All" / "Low stock" chips) that appears just above this, inside the same `section === 'items'` block.

- [ ] **Step 5: Wire `RefreshControl` onto the PERFORMANCE section's `ScrollView`**

Old:
```tsx
      {/* ── PERFORMANCE TAB ── */}
      {section === 'performance' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
```

New:
```tsx
      {/* ── PERFORMANCE TAB ── */}
      {section === 'performance' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
        >
```

- [ ] **Step 6: Wire `RefreshControl` onto the SUPPLIERS section's `ScrollView`**

Old:
```tsx
      {/* ── SUPPLIERS TAB ── */}
      {section === 'suppliers' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
```

New:
```tsx
      {/* ── SUPPLIERS TAB ── */}
      {section === 'suppliers' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
        >
```

- [ ] **Step 7: Wire `RefreshControl` onto the ORDERS section's `ScrollView`**

Old:
```tsx
      {/* ── ORDERS TAB ── */}
      {section === 'orders' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
```

New:
```tsx
      {/* ── ORDERS TAB ── */}
      {section === 'orders' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
        >
```

- [ ] **Step 8: Typecheck and run the existing screen test**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npm run typecheck
npm test -- inventoryScreen.test.tsx
```
Expected: typecheck shows exactly the 3 pre-existing baseline errors (none mentioning `inventory.tsx` or `inventoryScreen.test.tsx`); all existing `inventoryScreen.test.tsx` tests pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App
git add mobile/app/owner/inventory.tsx
git commit -m "feat(mobile): add pull-to-refresh to inventory screen (all 4 sections)

One shared refreshing flag with a section-aware handleRefresh: the
items section re-syncs WatermelonDB (syncNow + reload, matching
index.tsx's pattern) while performance/suppliers/orders each refetch
their own TanStack Query. Both horizontal filter-chip strips (item
category, and payroll's employee filter in a separate file) are left
without RefreshControl."
```

---

## Explicitly not covered by this plan

- The item-detail sub-screen at the top of `inventory.tsx` (the component before `export default function InventoryScreen()`, containing the `ScrollView` at line ~147) is a separate, smaller component reached by tapping an item — out of scope; it's a single-item view, not a refreshable list.
- Modal/wizard `ScrollView`s in both files (payroll's add/edit-employee forms, inventory's add-item and create-PO wizard steps) are explicitly out of scope — forms don't get pull-to-refresh.
- Tier 3 (destructive-action confirmations) remains a separate plan.
- The two leftover minor color spots identified in Tier 1's final review (`credit.tsx:178-179`, `cashier.tsx:689`) are still unaddressed and can be folded into whichever future plan touches those files next.
