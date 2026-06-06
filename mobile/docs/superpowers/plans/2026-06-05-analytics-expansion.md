# Analytics Screen Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Finance (P&L + cash flow) and Customers tabs to the existing analytics screen, plus an export button.

**Architecture:** `stock.tsx` already has the analytics screen. We add an `analyticsTab` state to switch between the existing Overview content and two new tabs. All new API calls reuse the existing `range` (from_date/to_date) computed from the period selector. No new screens needed.

**Tech Stack:** Expo React Native, TypeScript, React Query (TanStack), Axios, `useTheme()`, `MaterialCommunityIcons`, `Linking` from `expo-linking`

---

## File Map

| File | Change |
|---|---|
| `src/types/analytics.ts` | **Create** — PnLDto, CashFlowDto, TopCustomerDto, ExportJobDto |
| `src/api/analytics.api.ts` | Add 6 functions: getPnL, getCashFlow, getTopCustomers, getCustomerAnalytics, exportAnalytics, getExportDownload |
| `src/api/hooks/featureHooks.ts` | Add 5 hooks: useAnalyticsPnL, useAnalyticsCashFlow, useTopCustomers, useCustomerAnalytics, useExportAnalytics |
| `__tests__/api/featureHooksRoutes.test.tsx` | Add 4 route contract tests |
| `app/owner/stock.tsx` | Add tab bar + analyticsTab state + Finance tab + Customers tab + export button |

---

## Task 1: Types

**Files:**
- Create: `src/types/analytics.ts`

- [ ] **Step 1: Create the file**

Create `/Users/vincenttetteh/Desktop/SMEflow-App/mobile/src/types/analytics.ts` with:

```typescript
import type { UUID } from './common';

export interface PnLDto {
  revenue: number;
  net_revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
}

export interface CashFlowDto {
  from_date: string;
  to_date: string;
  cash_inflow: number;
  momo_inflow: number;
  total_inflow: number;
  outstanding_credit: number;
  total_sales: number;
}

export interface TopCustomerDto {
  customer_id: UUID;
  name: string;
  phone: string | null;
  purchase_count: number;
  total_spent: number;
  outstanding: number;
}

export interface ExportJobDto {
  job_id: string;
  status: string;
  download_url?: string | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/analytics.ts
git commit -m "feat(types): add PnLDto, CashFlowDto, TopCustomerDto, ExportJobDto"
```

---

## Task 2: API Functions

**Files:**
- Modify: `src/api/analytics.api.ts`

Currently the file only has `getRevenue`. Add the 6 new functions and their type imports.

- [ ] **Step 1: Add imports at the top of analytics.api.ts**

Add to the existing import block (find `import { apiClient }` and add below it):

```typescript
import type { CashFlowDto, ExportJobDto, PnLDto, TopCustomerDto } from '@/types/analytics';
```

- [ ] **Step 2: Add the 6 new API functions**

Append after `getRevenue` (end of file):

```typescript
export async function getPnL(params: {
  from_date: string;
  to_date: string;
}): Promise<PnLDto> {
  const response = await apiClient.get<PnLDto>('/api/v1/analytics/pnl', { params });
  return response.data;
}

export async function getCashFlow(params: {
  from_date: string;
  to_date: string;
}): Promise<CashFlowDto> {
  const response = await apiClient.get<CashFlowDto>('/api/v1/analytics/cash-flow', { params });
  return response.data;
}

export async function getTopCustomers(params: {
  from_date: string;
  to_date: string;
  limit?: number;
}): Promise<TopCustomerDto[]> {
  const response = await apiClient.get<TopCustomerDto[]>('/api/v1/analytics/customers/top', {
    params: { ...params, limit: params.limit ?? 10 },
  });
  return response.data;
}

export async function getCustomerAnalytics(params: {
  period: string;
  limit?: number;
}): Promise<TopCustomerDto[]> {
  const response = await apiClient.get<TopCustomerDto[]>('/api/v1/analytics/customers', {
    params: { ...params, limit: params.limit ?? 10, sort: 'revenue' },
  });
  return response.data;
}

export async function exportAnalytics(body: {
  report: string;
  format: string;
  group_by: string;
  from_date: string;
  to_date: string;
}): Promise<ExportJobDto> {
  const response = await apiClient.post<ExportJobDto>('/api/v1/analytics/export', body);
  return response.data;
}

export async function getExportDownload(params: {
  job_id: string;
}): Promise<ExportJobDto> {
  const response = await apiClient.get<ExportJobDto>('/api/v1/analytics/export/download', {
    params,
  });
  return response.data;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/analytics.api.ts
git commit -m "feat(api): add getPnL, getCashFlow, getTopCustomers, getCustomerAnalytics, exportAnalytics"
```

---

## Task 3: React Query Hooks

**Files:**
- Modify: `src/api/hooks/featureHooks.ts`

- [ ] **Step 1: Add new analytics API imports**

Find the existing analytics import (search for `getRevenue`). Add the new functions to it:

```typescript
import {
  exportAnalytics,
  getCashFlow,
  getCustomerAnalytics,
  getExportDownload,
  getPnL,
  getRevenue,
  getTopCustomers,
} from '@/api/analytics.api';
```

Also import the new types:

```typescript
import type { PnLDto, CashFlowDto, TopCustomerDto, ExportJobDto } from '@/types/analytics';
```

- [ ] **Step 2: Add the 5 new hooks after useAnalyticsSummary**

Find `export function useAnalyticsSummary`. Add after it:

```typescript
export function useAnalyticsPnL(params: { from_date: string; to_date: string } | null) {
  return useQuery({
    enabled: !!params,
    queryKey: ['analytics-pnl', params],
    queryFn: () => getPnL(params!),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useAnalyticsCashFlow(params: { from_date: string; to_date: string } | null) {
  return useQuery({
    enabled: !!params,
    queryKey: ['analytics-cash-flow', params],
    queryFn: () => getCashFlow(params!),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useTopCustomers(params: { from_date: string; to_date: string } | null) {
  return useQuery({
    enabled: !!params,
    queryKey: ['analytics-top-customers', params],
    queryFn: () => getTopCustomers({ ...params!, limit: 10 }),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCustomerAnalytics(period: string | null) {
  return useQuery({
    enabled: !!period,
    queryKey: ['analytics-customers', period],
    queryFn: () => getCustomerAnalytics({ period: period!, limit: 10 }),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useExportAnalytics() {
  return useMutation({
    mutationFn: async (params: {
      report: string;
      format: string;
      group_by: string;
      from_date: string;
      to_date: string;
    }) => {
      const job = await exportAnalytics(params);
      // Poll until ready (max 10 × 2s = 20 seconds)
      for (let i = 0; i < 10; i++) {
        await new Promise<void>((r) => setTimeout(r, 2000));
        const status = await getExportDownload({ job_id: job.job_id });
        if (status.status === 'ready' && status.download_url) {
          return status.download_url;
        }
      }
      throw new Error('Export timed out. Try again later.');
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/hooks/featureHooks.ts
git commit -m "feat(hooks): add analytics P&L, cash flow, customer, and export hooks"
```

---

## Task 4: Route Contract Tests

**Files:**
- Modify: `__tests__/api/featureHooksRoutes.test.tsx`

- [ ] **Step 1: Add hook imports**

Add to the existing `import { ... } from '@/api/hooks/featureHooks'` block:
- `useAnalyticsPnL`
- `useAnalyticsCashFlow`
- `useTopCustomers`
- `useExportAnalytics`

- [ ] **Step 2: Add 4 tests inside the describe block**

```typescript
  it('loads P&L through the versioned analytics route', async () => {
    mock
      .onGet('/api/v1/analytics/pnl', { params: { from_date: '2026-05-01', to_date: '2026-05-31' } })
      .reply(200, {
        revenue: 4200, net_revenue: 4200, cogs: 2100, gross_profit: 2100, gross_margin_pct: 50,
      });

    const { result, unmount } = renderHook(
      () => useAnalyticsPnL({ from_date: '2026-05-01', to_date: '2026-05-31' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toMatchObject({ gross_profit: 2100, gross_margin_pct: 50 });
    });
    unmount();
  });

  it('loads cash flow through the versioned analytics route', async () => {
    mock
      .onGet('/api/v1/analytics/cash-flow', { params: { from_date: '2026-05-01', to_date: '2026-05-31' } })
      .reply(200, {
        cash_inflow: 2500, momo_inflow: 1200, total_inflow: 3700,
        outstanding_credit: 500, total_sales: 42,
      });

    const { result, unmount } = renderHook(
      () => useAnalyticsCashFlow({ from_date: '2026-05-01', to_date: '2026-05-31' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toMatchObject({ total_inflow: 3700, total_sales: 42 });
    });
    unmount();
  });

  it('loads top customers through the versioned analytics route', async () => {
    mock
      .onGet('/api/v1/analytics/customers/top', {
        params: { from_date: '2026-05-01', to_date: '2026-05-31', limit: 10 },
      })
      .reply(200, [
        { customer_id: 'c1', name: 'Ama Mensah', phone: '+233244000001', purchase_count: 7, total_spent: 840, outstanding: 0 },
      ]);

    const { result, unmount } = renderHook(
      () => useTopCustomers({ from_date: '2026-05-01', to_date: '2026-05-31' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        expect.objectContaining({ name: 'Ama Mensah', purchase_count: 7 }),
      ]);
    });
    unmount();
  });

  it('exports analytics through the versioned export route', async () => {
    mock
      .onPost('/api/v1/analytics/export', {
        report: 'revenue', format: 'xlsx', group_by: 'day',
        from_date: '2026-05-01', to_date: '2026-05-31',
      })
      .reply(202, { job_id: 'job-1', status: 'pending' });
    mock
      .onGet('/api/v1/analytics/export/download', { params: { job_id: 'job-1' } })
      .reply(200, { job_id: 'job-1', status: 'ready', download_url: 'https://s3.example.com/export.xlsx' });

    const { result, unmount } = renderHook(() => useExportAnalytics(), { wrapper: createWrapper() });

    await expect(
      act(() =>
        result.current.mutateAsync({
          report: 'revenue', format: 'xlsx', group_by: 'day',
          from_date: '2026-05-01', to_date: '2026-05-31',
        })
      )
    ).resolves.toBe('https://s3.example.com/export.xlsx');
    unmount();
  }, 30_000);
```

Note: The export test has a 30-second timeout because it polls (up to 10 × 2s = 20s). In practice the mock responds immediately, so the first poll resolves — but set the Jest timeout explicitly to avoid flakiness.

- [ ] **Step 3: Run tests**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npx jest __tests__/api/featureHooksRoutes.test.tsx --no-coverage
```

Expected: 31 tests passing (27 existing + 4 new).

- [ ] **Step 4: Commit**

```bash
git add __tests__/api/featureHooksRoutes.test.tsx
git commit -m "test(hooks): add route contract tests for analytics P&L, cash flow, customers, export"
```

---

## Task 5: Tab Bar + Export Button in stock.tsx

**Files:**
- Modify: `app/owner/stock.tsx`

Context: `stock.tsx` is 307 lines. The screen header is lines 111–122. The ScrollView starts at line 124 with period + group-by controls. The existing full analytics content is inside this ScrollView. All you need to do is:
1. Add `analyticsTab` state
2. Add an export button to the header
3. Add a 3-tab bar (`Overview | Finance | Customers`) below the group-by controls
4. Wrap the existing ScrollView content in `{analyticsTab === 'overview' && ...}` (tasks 6 and 7 add the other tab content)

- [ ] **Step 1: Add imports**

At the top of the file, update the react-native import to include `Alert` (if not already present). Also add:

```typescript
import * as Linking from 'expo-linking';
import {
  useAnalyticsCashFlow,
  useAnalyticsPnL,
  useAnalyticsSummary,
  useCustomerAnalytics,
  useExportAnalytics,
  useSalesHistory,
  useTopCustomers,
} from '@/api/hooks/featureHooks';
```

- [ ] **Step 2: Add analyticsTab state and hooks**

Inside `AnalyticsScreen`, after `const range = useMemo(...)`, add:

```typescript
const [analyticsTab, setAnalyticsTab] = useState<'overview' | 'finance' | 'customers'>('overview');
const pnl = useAnalyticsPnL(analyticsTab === 'finance' ? range : null);
const cashFlow = useAnalyticsCashFlow(analyticsTab === 'finance' ? range : null);
const topCustomers = useTopCustomers(analyticsTab === 'customers' ? range : null);
const customerAnalytics = useCustomerAnalytics(analyticsTab === 'customers' ? period : null);
const exportJob = useExportAnalytics();
const [isExporting, setIsExporting] = useState(false);
```

- [ ] **Step 3: Add export handler function**

After the hook declarations, add:

```typescript
function handleExport() {
  setIsExporting(true);
  exportJob.mutate(
    { report: 'revenue', format: 'xlsx', group_by: groupBy, ...range },
    {
      onSuccess: (url) => {
        setIsExporting(false);
        void Linking.openURL(url);
      },
      onError: (e: Error) => {
        setIsExporting(false);
        Alert.alert('Export failed', e.message ?? 'Could not export. Try again.');
      },
    }
  );
}
```

- [ ] **Step 4: Add export button to the header**

Find the header `<View>` block (around lines 113–122). Change it from:

```tsx
<View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Analytics</Text>
  <Text style={{ fontSize: 12, color: colors.muted }}>{business?.name ?? 'Your business'} · revenue, mix, trends</Text>
</View>
```

to:

```tsx
<View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center' }}>
  <View style={{ flex: 1 }}>
    <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Analytics</Text>
    <Text style={{ fontSize: 12, color: colors.muted }}>{business?.name ?? 'Your business'} · revenue, mix, trends</Text>
  </View>
  <TouchableOpacity onPress={handleExport} disabled={isExporting} hitSlop={8} style={{ padding: 6 }}>
    {isExporting
      ? <ActivityIndicator size="small" color={colors.brand} />
      : <MaterialCommunityIcons name="share-outline" size={20} color={colors.muted} />}
  </TouchableOpacity>
</View>
```

- [ ] **Step 5: Add the analytics tab bar**

Find the existing group-by toggle (the last control before the data content — search for `handleGroupByChange` or `setGroupBy`). After the group-by `</View>`, add the tab bar:

```tsx
{/* Analytics section tabs */}
<View style={{ flexDirection: 'row', gap: 8 }}>
  {(['overview', 'finance', 'customers'] as const).map((tab) => {
    const sel = analyticsTab === tab;
    const label = tab === 'overview' ? 'Overview' : tab === 'finance' ? 'Finance' : 'Customers';
    return (
      <TouchableOpacity
        key={tab}
        onPress={() => setAnalyticsTab(tab)}
        style={{
          paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
          backgroundColor: sel ? colors.brand : colors.surface,
          borderWidth: sel ? 0 : 1, borderColor: colors.border,
        }}
      >
        <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: sel ? '#fff' : colors.muted }}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  })}
</View>
```

- [ ] **Step 6: Wrap existing content in overview guard**

Find the existing metrics cards, trend chart, payment mix, and top sellers sections. They are all inside the single `<ScrollView>` as siblings. Wrap them (but NOT the period selector + group-by + tab bar) in:

```tsx
{analyticsTab === 'overview' && (
  <>
    {/* ...existing metrics cards, trend chart, payment mix, top sellers... */}
  </>
)}
```

Be careful to keep the period selector, group-by toggle, and the new tab bar **outside** this guard.

- [ ] **Step 7: Commit**

```bash
git add app/owner/stock.tsx
git commit -m "feat(analytics): add tab bar, overview guard, and export button"
```

---

## Task 6: Finance Tab in stock.tsx

**Files:**
- Modify: `app/owner/stock.tsx`

Add the Finance tab content immediately after the `{analyticsTab === 'overview' && ...}` block.

- [ ] **Step 1: Add the Finance tab JSX**

After the overview guard closing tag, add:

```tsx
{analyticsTab === 'finance' && (
  <>
    {/* P&L Card */}
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 }}>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, marginBottom: 12 }}>Profit & Loss</Text>
      {pnl.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />}
      {pnl.isError && (
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Text style={{ fontSize: 13, color: colors.muted }}>Could not load P&L data</Text>
          <TouchableOpacity onPress={() => void pnl.refetch()} style={{ marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {pnl.data && (
        <>
          {[
            { label: 'Revenue', value: pnl.data.revenue, bold: false },
            { label: 'Cost of goods', value: pnl.data.cogs, bold: false },
            { label: 'Gross profit', value: pnl.data.gross_profit, bold: true },
          ].map((row) => (
            <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
              <Text style={{ fontSize: 13, fontFamily: row.bold ? fonts.bodySemiBold : fonts.body, color: row.bold ? colors.brand : colors.ink }}>
                {ghc(row.value)}
              </Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Gross margin</Text>
            <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{pnl.data.gross_margin_pct.toFixed(1)}%</Text>
          </View>
        </>
      )}
    </View>

    {/* Cash Flow Card */}
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 }}>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, marginBottom: 12 }}>Cash Flow</Text>
      {cashFlow.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />}
      {cashFlow.isError && (
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Text style={{ fontSize: 13, color: colors.muted }}>Could not load cash flow data</Text>
          <TouchableOpacity onPress={() => void cashFlow.refetch()} style={{ marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {cashFlow.data && (
        <>
          {[
            { label: 'Cash collected', value: Number(cashFlow.data.cash_inflow) },
            { label: 'MoMo collected', value: Number(cashFlow.data.momo_inflow) },
            { label: 'Total inflow', value: Number(cashFlow.data.total_inflow), bold: true },
          ].map((row) => (
            <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
              <Text style={{ fontSize: 13, fontFamily: row.bold ? fonts.bodySemiBold : fonts.body, color: row.bold ? colors.brand : colors.ink }}>
                {ghc(row.value)}
              </Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Outstanding credit</Text>
            <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#b6831e' }}>{ghc(Number(cashFlow.data.outstanding_credit))}</Text>
          </View>
        </>
      )}
    </View>
  </>
)}
```

- [ ] **Step 2: Commit**

```bash
git add app/owner/stock.tsx
git commit -m "feat(analytics): add Finance tab with P&L and cash flow cards"
```

---

## Task 7: Customers Tab in stock.tsx

**Files:**
- Modify: `app/owner/stock.tsx`

Add the Customers tab content after the Finance tab block.

- [ ] **Step 1: Add the Customers tab JSX**

After the Finance tab closing `)}`, add:

```tsx
{analyticsTab === 'customers' && (
  <>
    {/* Stats row — computed from customerAnalytics */}
    {customerAnalytics.data && customerAnalytics.data.length > 0 && (() => {
      const rows = customerAnalytics.data;
      const totalSpent = rows.reduce((s, r) => s + Number(r.total_spent), 0);
      const totalPurchases = rows.reduce((s, r) => s + r.purchase_count, 0);
      const avgOrderValue = totalPurchases > 0 ? totalSpent / totalPurchases : 0;
      const repeatCount = rows.filter((r) => r.purchase_count > 1).length;
      const repeatPct = rows.length > 0 ? Math.round((repeatCount / rows.length) * 100) : 0;
      return (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { label: 'Customers', value: String(rows.length) },
            { label: 'Avg order', value: ghc(avgOrderValue) },
            { label: 'Repeat', value: `${repeatPct}%` },
          ].map((stat) => (
            <View key={stat.label} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink }}>{stat.value}</Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{stat.label}</Text>
            </View>
          ))}
        </View>
      );
    })()}

    {/* Top customers list */}
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' }}>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, padding: 14, paddingBottom: 10 }}>Top Customers</Text>
      {topCustomers.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />}
      {topCustomers.isError && (
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Text style={{ fontSize: 13, color: colors.muted }}>Could not load customers</Text>
          <TouchableOpacity onPress={() => void topCustomers.refetch()} style={{ marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {!topCustomers.isLoading && !topCustomers.isError && (topCustomers.data ?? []).length === 0 && (
        <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>No customer data for this period.</Text>
      )}
      {(topCustomers.data ?? []).map((customer, i) => (
        <View
          key={customer.customer_id}
          style={{
            flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12,
            borderTopWidth: i === 0 ? 1 : 0, borderTopColor: colors.border,
            borderBottomWidth: i < (topCustomers.data ?? []).length - 1 ? 1 : 0,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ width: 26, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.bodySemiBold }}>#{i + 1}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>{customer.name}</Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>{customer.purchase_count} purchase{customer.purchase_count !== 1 ? 's' : ''}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{ghc(Number(customer.total_spent))}</Text>
            {Number(customer.outstanding) > 0 && (
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: '#fff5cc' }}>
                <Text style={{ fontSize: 10, color: '#b6831e', fontFamily: fonts.bodySemiBold }}>
                  {ghc(Number(customer.outstanding))} owed
                </Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  </>
)}
```

- [ ] **Step 2: Commit**

```bash
git add app/owner/stock.tsx
git commit -m "feat(analytics): add Customers tab with stats and top customers list"
```

---

## Self-Review

**Spec coverage:**
- ✅ Types: `PnLDto`, `CashFlowDto`, `TopCustomerDto`, `ExportJobDto` — Task 1
- ✅ API functions: `getPnL`, `getCashFlow`, `getTopCustomers`, `getCustomerAnalytics`, `exportAnalytics`, `getExportDownload` — Task 2
- ✅ Hooks: 5 new hooks with correct query keys and stale times — Task 3
- ✅ Export polling (max 10 × 2s) — Task 3
- ✅ Route contract tests (4 new) — Task 4
- ✅ Tab bar (Overview/Finance/Customers) — Task 5
- ✅ Export button with spinner — Task 5
- ✅ Wrap existing overview content in guard — Task 5
- ✅ Finance tab: P&L + cash flow cards with error/loading states — Task 6
- ✅ Customers tab: stats chips + top customers list with error/loading/empty states — Task 7

**Type consistency:**
- `PnLDto.revenue` is `number` in Task 1 and accessed as `pnl.data.revenue` in Task 6 — ✅
- `CashFlowDto.cash_inflow` is `number` in Task 1 and accessed as `Number(cashFlow.data.cash_inflow)` in Task 6 — ✅ (defensive cast, fine)
- `TopCustomerDto.total_spent` is `number` in Task 1 and accessed as `Number(r.total_spent)` in Task 7 — ✅
- `useAnalyticsPnL` called with `range` (Task 5) which is `{ from_date: string, to_date: string }` — matches param type in Task 3 ✅
- `useExportAnalytics` `mutateAsync` called with `{ report, format, group_by, ...range }` in Task 5 — matches type in Task 3 ✅

**Placeholder scan:** No TBDs. No "add appropriate error handling" — all error states are explicitly coded.
