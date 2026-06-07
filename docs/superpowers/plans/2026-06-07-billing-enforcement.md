# Billing Enforcement — Full-Screen Plan Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a full-screen upgrade wall instead of feature content when a user's plan doesn't cover the feature, and replace raw 402 errors with upgrade prompts.

**Architecture:** `usePlanGate(feature)` reads from the already-cached `useBillingWorkspace()` result (primed once in `owner/_layout.tsx`) and returns `{ allowed, requiredPlan, loading }`. `PlanGatedScreen` wraps each screen body — renders children when allowed, full-screen `UpgradePrompt` when not. Seven ungated screens get the wrapper; three existing screens drop their inline billing logic for the hook. `is402Error()` handles the reactive fallback in `add-business`.

**Tech Stack:** React Native, Expo Router, @tanstack/react-query, axios, TypeScript, Jest + @testing-library/react-native

---

## File Map

| Action | Path |
|---|---|
| Modify | `mobile/src/api/errors.ts` |
| Create | `mobile/src/api/hooks/planGate.ts` |
| Modify | `mobile/src/components/ui/UpgradePrompt.tsx` |
| Create | `mobile/src/components/ui/PlanGatedScreen.tsx` |
| Modify | `mobile/app/owner/_layout.tsx` |
| Modify | `mobile/app/owner/payroll.tsx` |
| Modify | `mobile/app/owner/tax.tsx` |
| Modify | `mobile/app/owner/invoices.tsx` |
| Modify | `mobile/app/owner/team.tsx` |
| Modify | `mobile/app/owner/customers.tsx` |
| Modify | `mobile/app/owner/assistant.tsx` |
| Modify | `mobile/app/owner/reconciliation.tsx` |
| Modify | `mobile/app/owner/add-business.tsx` |
| Modify | `mobile/app/owner/analytics.tsx` |
| Modify | `mobile/app/owner/stock.tsx` |
| Modify | `mobile/app/owner/credit.tsx` |
| Create | `mobile/__tests__/api/planGate.test.ts` |
| Create | `mobile/__tests__/components/PlanGatedScreen.test.tsx` |

---

### Task 1: Add `is402Error` utility to `errors.ts`

**Files:**
- Modify: `mobile/src/api/errors.ts`
- Test: `mobile/__tests__/api/errors.test.ts` (existing file — add new test cases)

- [ ] **Step 1: Read the existing test file**

```bash
cat mobile/__tests__/api/errors.test.ts
```

- [ ] **Step 2: Add failing tests for `is402Error`**

Append to `mobile/__tests__/api/errors.test.ts`:

```ts
import { is402Error } from '@/api/errors';

describe('is402Error', () => {
  it('returns true for a 402 AxiosError', () => {
    const err = { response: { status: 402 } };
    expect(is402Error(err)).toBe(true);
  });

  it('returns false for a 404 AxiosError', () => {
    const err = { response: { status: 404 } };
    expect(is402Error(err)).toBe(false);
  });

  it('returns false for a non-axios error', () => {
    expect(is402Error(new Error('network'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(is402Error(null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd mobile && npx jest __tests__/api/errors.test.ts --no-coverage
```

Expected: FAIL — `is402Error is not a function`

- [ ] **Step 4: Add `is402Error` to `mobile/src/api/errors.ts`**

Add at the bottom of the file:

```ts
export function is402Error(error: unknown): boolean {
  const axiosError = error as { response?: { status?: number } } | null | undefined;
  return axiosError?.response?.status === 402;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd mobile && npx jest __tests__/api/errors.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mobile/src/api/errors.ts mobile/__tests__/api/errors.test.ts
git commit -m "feat(billing): add is402Error utility"
```

---

### Task 2: Create `usePlanGate` hook

**Files:**
- Create: `mobile/src/api/hooks/planGate.ts`
- Create: `mobile/__tests__/api/planGate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/api/planGate.test.ts`:

```ts
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

import React, { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import MockAdapter from 'axios-mock-adapter';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/store/auth';
import { usePlanGate } from '@/api/hooks/planGate';

const mock = new MockAdapter(apiClient);
let queryClient: QueryClient | null = null;

function createWrapper() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(QueryClientProvider, { client: queryClient! }, children);
  };
}

const PLAN_USAGE_RESPONSE = {
  subscription: { plan: 'free', status: 'active' },
  plan: 'free',
  usage: { businesses: 1, employees: 0, ai_messages: 0 },
  limits: {
    analytics: false,
    credit_scoring: false,
    tax_summary: false,
    gra_submission: false,
    employees: 0,
    invoices: 0,
    invoice_pdf: false,
    team_members: 0,
    customers: 0,
    ai_messages: 0,
    businesses: 1,
    included_businesses: 1,
    bulk_momo_payout: false,
    cost_margin_tracking: false,
    export: false,
    recurring_invoices: false,
  },
};

beforeEach(() => {
  useAuthStore.setState({ businessId: 'biz-1' } as never);
  mock.reset();
  mock.onGet('/api/v1/billing/plans').reply(200, []);
  mock.onGet('/api/v1/billing/subscription').reply(200, {});
  mock.onGet('/api/v1/billing/transactions').reply(200, []);
  mock.onGet('/api/v1/billing/invoices').reply(200, []);
  mock.onGet('/api/v1/billing/plan-usage').reply(200, PLAN_USAGE_RESPONSE);
});

afterEach(() => {
  queryClient?.clear();
  mock.reset();
});

describe('usePlanGate — free plan', () => {
  it('returns allowed:false for analytics_basic on free plan', async () => {
    const { result } = renderHook(() => usePlanGate('analytics_basic'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(result.current.requiredPlan).toBe('starter');
  });

  it('returns allowed:false for payroll on free plan (employees: 0)', async () => {
    const { result } = renderHook(() => usePlanGate('payroll'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });

  it('returns allowed:true while loading', () => {
    mock.onGet('/api/v1/billing/plan-usage').reply(() => new Promise(() => {}));
    const { result } = renderHook(() => usePlanGate('payroll'), { wrapper: createWrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.allowed).toBe(true);
  });

  it('returns allowed:true on billing fetch error (fail open)', async () => {
    mock.onGet('/api/v1/billing/plan-usage').reply(500);
    const { result } = renderHook(() => usePlanGate('payroll'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(true);
  });
});

describe('usePlanGate — starter plan', () => {
  beforeEach(() => {
    mock.onGet('/api/v1/billing/plan-usage').reply(200, {
      ...PLAN_USAGE_RESPONSE,
      plan: 'starter',
      limits: {
        ...PLAN_USAGE_RESPONSE.limits,
        analytics: 'basic',
        tax_summary: true,
        employees: 10,
        invoices: null,
        invoice_pdf: true,
        team_members: 3,
        customers: null,
        ai_messages: 50,
        businesses: 3,
      },
    });
  });

  it('returns allowed:true for analytics_basic on starter', async () => {
    const { result } = renderHook(() => usePlanGate('analytics_basic'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(true);
  });

  it('returns allowed:false for analytics_full on starter', async () => {
    const { result } = renderHook(() => usePlanGate('analytics_full'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(result.current.requiredPlan).toBe('pro');
  });

  it('returns allowed:true for payroll when employees > 0', async () => {
    const { result } = renderHook(() => usePlanGate('payroll'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(true);
  });

  it('returns allowed:true for invoices when limit is null (unlimited)', async () => {
    const { result } = renderHook(() => usePlanGate('invoices'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(true);
  });

  it('returns allowed:false for add_business when usage meets limit', async () => {
    mock.onGet('/api/v1/billing/plan-usage').reply(200, {
      ...PLAN_USAGE_RESPONSE,
      plan: 'starter',
      usage: { ...PLAN_USAGE_RESPONSE.usage, businesses: 3 },
      limits: { ...PLAN_USAGE_RESPONSE.limits, businesses: 3 },
    });
    const { result } = renderHook(() => usePlanGate('add_business'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd mobile && npx jest __tests__/api/planGate.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/api/hooks/planGate'`

- [ ] **Step 3: Create `mobile/src/api/hooks/planGate.ts`**

```ts
import { useBillingWorkspace } from '@/api/hooks/featureHooks';
import type { BillingLimitsDto, BillingUsageDto } from '@/types/billing';

export type FeatureKey =
  | 'analytics_basic'
  | 'analytics_full'
  | 'credit_scoring'
  | 'tax_summary'
  | 'gra_submission'
  | 'payroll'
  | 'invoices'
  | 'invoice_pdf'
  | 'team'
  | 'customers'
  | 'assistant'
  | 'add_business'
  | 'bulk_momo_payout'
  | 'cost_margin'
  | 'export'
  | 'recurring_invoices';

export type PlanTier = 'starter' | 'pro';

interface GateConfig {
  requiredPlan: PlanTier;
  check: (limits: BillingLimitsDto, usage?: BillingUsageDto) => boolean;
}

function numericAllowed(limit: number | null | undefined): boolean {
  return limit === null || (limit != null && limit > 0);
}

const FEATURE_GATES: Record<FeatureKey, GateConfig> = {
  analytics_basic: {
    requiredPlan: 'starter',
    check: (l) => l.analytics != null && l.analytics !== false,
  },
  analytics_full: {
    requiredPlan: 'pro',
    check: (l) => l.analytics === 'full',
  },
  credit_scoring: {
    requiredPlan: 'pro',
    check: (l) => l.credit_scoring === true,
  },
  tax_summary: {
    requiredPlan: 'starter',
    check: (l) => l.tax_summary === true,
  },
  gra_submission: {
    requiredPlan: 'pro',
    check: (l) => l.gra_submission === true,
  },
  payroll: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.employees),
  },
  invoices: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.invoices),
  },
  invoice_pdf: {
    requiredPlan: 'starter',
    check: (l) => l.invoice_pdf === true,
  },
  team: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.team_members),
  },
  customers: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.customers),
  },
  assistant: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.ai_messages),
  },
  add_business: {
    requiredPlan: 'starter',
    check: (l, u) =>
      l.businesses === null ||
      (l.businesses != null && (u?.businesses ?? 0) < l.businesses),
  },
  bulk_momo_payout: {
    requiredPlan: 'pro',
    check: (l) => l.bulk_momo_payout === true,
  },
  cost_margin: {
    requiredPlan: 'pro',
    check: (l) => l.cost_margin_tracking === true,
  },
  export: {
    requiredPlan: 'pro',
    check: (l) => l.export === true,
  },
  recurring_invoices: {
    requiredPlan: 'pro',
    check: (l) => l.recurring_invoices === true,
  },
};

export interface PlanGateResult {
  allowed: boolean;
  requiredPlan: PlanTier;
  loading: boolean;
}

export function usePlanGate(feature: FeatureKey): PlanGateResult {
  const billing = useBillingWorkspace();
  const config = FEATURE_GATES[feature];

  if (billing.isLoading) {
    return { allowed: true, requiredPlan: config.requiredPlan, loading: true };
  }

  if (billing.isError || !billing.data?.planUsage?.limits) {
    return { allowed: true, requiredPlan: config.requiredPlan, loading: false };
  }

  const limits = billing.data.planUsage.limits;
  const usage = billing.data.planUsage.usage;

  return {
    allowed: config.check(limits, usage),
    requiredPlan: config.requiredPlan,
    loading: false,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd mobile && npx jest __tests__/api/planGate.test.ts --no-coverage
```

Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/hooks/planGate.ts mobile/__tests__/api/planGate.test.ts
git commit -m "feat(billing): add usePlanGate hook with feature gate map"
```

---

### Task 3: Extend `UpgradePrompt` with `fullScreen` prop

**Files:**
- Modify: `mobile/src/components/ui/UpgradePrompt.tsx`

No new test file — this is a presentational change verified visually. The existing card variant is unchanged.

- [ ] **Step 1: Replace the entire content of `mobile/src/components/ui/UpgradePrompt.tsx`**

```tsx
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';

interface UpgradePromptProps {
  feature: string;
  requiredPlan: 'starter' | 'pro';
  description: string;
  fullScreen?: boolean;
}

export function UpgradePrompt({ feature, requiredPlan, description, fullScreen = false }: UpgradePromptProps) {
  const { colors, fonts, spacing } = useTheme();
  const router = useRouter();
  const planLabel = requiredPlan === 'pro' ? 'Pro' : 'Starter';

  if (fullScreen) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <Text style={{ fontSize: 52 }}>⭐</Text>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, textAlign: 'center' }}>
          {feature}
        </Text>
        <Text style={{ color: colors.muted, textAlign: 'center', fontSize: 15, lineHeight: 22 }}>
          {description}
        </Text>
        <View style={{ width: '100%', marginTop: 8 }}>
          <Button
            label={`Upgrade to ${planLabel}`}
            onPress={() => router.push('/owner/billing')}
            variant="gold"
          />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { borderColor: colors.gold, backgroundColor: `${colors.gold}18`, gap: spacing.sm },
      ]}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: spacing.sm }}>
        <Text style={{ fontSize: 20 }}>⭐</Text>
        <Text style={{ fontFamily: fonts.bodySemiBold }}>{feature}</Text>
      </View>
      <Text style={{ color: colors.muted }}>{description}</Text>
      <Button
        label={`Upgrade to ${planLabel}`}
        onPress={() => router.push('/owner/billing')}
        variant="gold"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 16,
  },
});
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `UpgradePrompt`

- [ ] **Step 3: Commit**

```bash
git add mobile/src/components/ui/UpgradePrompt.tsx
git commit -m "feat(billing): add fullScreen variant to UpgradePrompt"
```

---

### Task 4: Create `PlanGatedScreen` wrapper component

**Files:**
- Create: `mobile/src/components/ui/PlanGatedScreen.tsx`
- Create: `mobile/__tests__/components/PlanGatedScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/PlanGatedScreen.test.tsx`:

```tsx
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import React, { type PropsWithChildren } from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import MockAdapter from 'axios-mock-adapter';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/store/auth';
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';

const mock = new MockAdapter(apiClient);
let queryClient: QueryClient;

function createWrapper() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const FREE_LIMITS = {
  analytics: false,
  employees: 0,
  ai_messages: 0,
  invoices: 0,
  team_members: 0,
  customers: 0,
  businesses: 1,
  tax_summary: false,
  credit_scoring: false,
  gra_submission: false,
  invoice_pdf: false,
  bulk_momo_payout: false,
  cost_margin_tracking: false,
  export: false,
  recurring_invoices: false,
};

function mockBilling(limits: object, usage = { businesses: 1 }) {
  mock.onGet('/api/v1/billing/plans').reply(200, []);
  mock.onGet('/api/v1/billing/subscription').reply(200, {});
  mock.onGet('/api/v1/billing/transactions').reply(200, []);
  mock.onGet('/api/v1/billing/invoices').reply(200, []);
  mock.onGet('/api/v1/billing/plan-usage').reply(200, { limits, usage });
}

beforeEach(() => {
  useAuthStore.setState({ businessId: 'biz-1' } as never);
  mock.reset();
});

afterEach(() => {
  queryClient?.clear();
});

it('renders children when feature is allowed', async () => {
  mockBilling({ ...FREE_LIMITS, employees: 10 });
  const { getByText } = render(
    <PlanGatedScreen feature="payroll">
      <Text>Payroll content</Text>
    </PlanGatedScreen>,
    { wrapper: createWrapper() }
  );
  await waitFor(() => expect(getByText('Payroll content')).toBeTruthy());
});

it('renders upgrade prompt when feature is not allowed', async () => {
  mockBilling(FREE_LIMITS);
  const { getByText, queryByText } = render(
    <PlanGatedScreen feature="payroll">
      <Text>Payroll content</Text>
    </PlanGatedScreen>,
    { wrapper: createWrapper() }
  );
  await waitFor(() => expect(getByText('Upgrade to Starter')).toBeTruthy());
  expect(queryByText('Payroll content')).toBeNull();
});

it('renders children while billing is loading (fail open)', () => {
  mock.onGet('/api/v1/billing/plan-usage').reply(() => new Promise(() => {}));
  mock.onGet('/api/v1/billing/plans').reply(() => new Promise(() => {}));
  mock.onGet('/api/v1/billing/subscription').reply(() => new Promise(() => {}));
  mock.onGet('/api/v1/billing/transactions').reply(() => new Promise(() => {}));
  mock.onGet('/api/v1/billing/invoices').reply(() => new Promise(() => {}));
  const { getByText } = render(
    <PlanGatedScreen feature="payroll">
      <Text>Payroll content</Text>
    </PlanGatedScreen>,
    { wrapper: createWrapper() }
  );
  expect(getByText('Payroll content')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd mobile && npx jest __tests__/components/PlanGatedScreen.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module '@/components/ui/PlanGatedScreen'`

- [ ] **Step 3: Create `mobile/src/components/ui/PlanGatedScreen.tsx`**

```tsx
import type { ReactNode } from 'react';
import { usePlanGate } from '@/api/hooks/planGate';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import type { FeatureKey } from '@/api/hooks/planGate';

const FEATURE_NAMES: Record<FeatureKey, string> = {
  analytics_basic: 'Analytics',
  analytics_full: 'Finance Analytics',
  credit_scoring: 'Credit Scoring',
  tax_summary: 'Tax & Compliance',
  gra_submission: 'GRA Submission',
  payroll: 'Payroll',
  invoices: 'Invoices',
  invoice_pdf: 'Invoice PDF',
  team: 'Team & Roles',
  customers: 'Customers',
  assistant: 'AI Assistant',
  add_business: 'Multi-Business',
  bulk_momo_payout: 'Reconciliation',
  cost_margin: 'Cost & Margin',
  export: 'Export',
  recurring_invoices: 'Recurring Invoices',
};

const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
  analytics_basic: 'Starter unlocks revenue trends, payment mix, and seller performance for this business.',
  analytics_full: 'Pro unlocks profit and loss, cash flow, and deeper financial analysis.',
  credit_scoring: 'Pro unlocks credit scoring and loan access for your business.',
  tax_summary: 'Starter unlocks your monthly tax summary, VAT tracking, and GRA return generation.',
  gra_submission: 'Pro unlocks GRA e-filing and tax return submission.',
  payroll: 'Starter unlocks payroll runs, employee management, and P9 tax certificates.',
  invoices: 'Starter unlocks invoice generation, PDF receipts, and payment tracking.',
  invoice_pdf: 'Starter unlocks invoice PDF generation and sharing.',
  team: 'Starter lets you add team members and control access by role.',
  customers: 'Starter unlocks your full customer list and purchase history.',
  assistant: 'Starter gives you AI assistant messages to manage your business by voice or text.',
  add_business: 'Upgrade your plan to add another business to your account.',
  bulk_momo_payout: 'Pro unlocks payment reconciliation and bulk MoMo payout review.',
  cost_margin: 'Pro unlocks cost and margin tracking across your inventory.',
  export: 'Pro unlocks data export for analytics reports.',
  recurring_invoices: 'Pro unlocks recurring invoice scheduling.',
};

interface PlanGatedScreenProps {
  feature: FeatureKey;
  children: ReactNode;
}

export function PlanGatedScreen({ feature, children }: PlanGatedScreenProps) {
  const { allowed, requiredPlan, loading } = usePlanGate(feature);

  if (loading || allowed) {
    return <>{children}</>;
  }

  return (
    <UpgradePrompt
      feature={FEATURE_NAMES[feature]}
      requiredPlan={requiredPlan}
      description={FEATURE_DESCRIPTIONS[feature]}
      fullScreen
    />
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd mobile && npx jest __tests__/components/PlanGatedScreen.test.tsx --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/ui/PlanGatedScreen.tsx mobile/__tests__/components/PlanGatedScreen.test.tsx
git commit -m "feat(billing): add PlanGatedScreen wrapper component"
```

---

### Task 5: Prime billing cache in `owner/_layout.tsx`

**Files:**
- Modify: `mobile/app/owner/_layout.tsx`

- [ ] **Step 1: Add `useBillingWorkspace` import and call**

In `mobile/app/owner/_layout.tsx`, add the import at the top with the other imports:

```ts
import { useBillingWorkspace } from '@/api/hooks/featureHooks';
```

Inside `OwnerLayout`, add this line immediately after the existing `const` declarations (before the `useEffect` blocks):

```ts
useBillingWorkspace(); // Prime React Query cache so plan gates have data before screens mount
```

Full relevant section of `OwnerLayout` after the change (for reference):

```tsx
export default function OwnerLayout() {
  const { colors, spacing } = useTheme();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  const hasBusinessContext = useAuthStore((state) => state.hasBusinessContext());
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const deviceRegistered = useRef(false);

  useBillingWorkspace(); // Prime React Query cache so plan gates have data before screens mount

  useEffect(() => {
    // ... existing effects unchanged
```

- [ ] **Step 2: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add mobile/app/owner/_layout.tsx
git commit -m "feat(billing): prime billing cache in owner layout"
```

---

### Task 6: Gate `payroll.tsx`

**Files:**
- Modify: `mobile/app/owner/payroll.tsx`

- [ ] **Step 1: Add import**

In `mobile/app/owner/payroll.tsx`, add to the existing import block:

```ts
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

- [ ] **Step 2: Wrap the screen body**

In `PayrollScreen`, locate the `return` statement. The screen renders a `<SafeAreaView>` containing a header `<View>` followed by the body content (tabs, modals, ScrollView). Wrap everything after the header `<View>` with `<PlanGatedScreen feature="payroll">`.

Find the closing `</View>` of the header block (it ends just before the first `<Modal` or `<ScrollView`/`<View>` that is the body). The pattern to apply:

```tsx
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    {/* --- keep header View exactly as-is --- */}
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, ... }}>
      ...existing header content...
    </View>

    {/* --- wrap body --- */}
    <PlanGatedScreen feature="payroll">
      {/* everything that was here before: Modals, ScrollView, tabs, etc. */}
    </PlanGatedScreen>
  </SafeAreaView>
);
```

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep payroll
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add mobile/app/owner/payroll.tsx
git commit -m "feat(billing): gate payroll screen behind starter plan"
```

---

### Task 7: Gate `tax.tsx`

**Files:**
- Modify: `mobile/app/owner/tax.tsx`

- [ ] **Step 1: Add import**

```ts
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

- [ ] **Step 2: Wrap the screen body after the header**

In `TaxScreen`'s return, wrap everything after the header `<View>` (the `<KeyboardAvoidingView>` or `<ScrollView>` that forms the body) with `<PlanGatedScreen feature="tax_summary">`:

```tsx
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <View style={{ /* header styles */ }}>
      ...existing header...
    </View>
    <PlanGatedScreen feature="tax_summary">
      {/* KeyboardAvoidingView / ScrollView body — unchanged */}
    </PlanGatedScreen>
  </SafeAreaView>
);
```

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep tax
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add mobile/app/owner/tax.tsx
git commit -m "feat(billing): gate tax screen behind starter plan"
```

---

### Task 8: Gate `invoices.tsx`

**Files:**
- Modify: `mobile/app/owner/invoices.tsx`

- [ ] **Step 1: Add import**

```ts
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

- [ ] **Step 2: Wrap the screen body after the header**

```tsx
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <View style={{ /* header */ }}>
      ...existing header...
    </View>
    <PlanGatedScreen feature="invoices">
      {/* ScrollView + modals body — unchanged */}
    </PlanGatedScreen>
  </SafeAreaView>
);
```

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep invoices
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add mobile/app/owner/invoices.tsx
git commit -m "feat(billing): gate invoices screen behind starter plan"
```

---

### Task 9: Gate `team.tsx`

**Files:**
- Modify: `mobile/app/owner/team.tsx`

- [ ] **Step 1: Add import**

```ts
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

- [ ] **Step 2: Wrap the screen body after the header**

```tsx
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <View style={{ /* header */ }}>
      ...existing header...
    </View>
    <PlanGatedScreen feature="team">
      {/* ScrollView + modal body — unchanged */}
    </PlanGatedScreen>
  </SafeAreaView>
);
```

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep team
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add mobile/app/owner/team.tsx
git commit -m "feat(billing): gate team screen behind starter plan"
```

---

### Task 10: Gate `customers.tsx`

**Files:**
- Modify: `mobile/app/owner/customers.tsx`

- [ ] **Step 1: Add import**

```ts
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

- [ ] **Step 2: Wrap the screen body after the header**

```tsx
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <View style={{ /* header */ }}>
      ...existing header...
    </View>
    <PlanGatedScreen feature="customers">
      {/* body — unchanged */}
    </PlanGatedScreen>
  </SafeAreaView>
);
```

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep customers
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add mobile/app/owner/customers.tsx
git commit -m "feat(billing): gate customers screen behind starter plan"
```

---

### Task 11: Gate `assistant.tsx`

**Files:**
- Modify: `mobile/app/owner/assistant.tsx`

- [ ] **Step 1: Add import**

```ts
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

- [ ] **Step 2: Wrap the screen body after the header**

The assistant screen is a tab screen — it has a `<SafeAreaView>` with a header `<View>` and then the chat body (`<KeyboardAvoidingView>` / `<ScrollView>`). Wrap the body:

```tsx
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <View style={{ /* header */ }}>
      ...existing header...
    </View>
    <PlanGatedScreen feature="assistant">
      {/* KeyboardAvoidingView chat body — unchanged */}
    </PlanGatedScreen>
  </SafeAreaView>
);
```

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep assistant
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add mobile/app/owner/assistant.tsx
git commit -m "feat(billing): gate assistant screen behind starter plan"
```

---

### Task 12: Gate `reconciliation.tsx`

**Files:**
- Modify: `mobile/app/owner/reconciliation.tsx`

- [ ] **Step 1: Add import**

```ts
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

- [ ] **Step 2: Wrap the screen body after the header**

```tsx
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <View style={{ /* header */ }}>
      ...existing header...
    </View>
    <PlanGatedScreen feature="bulk_momo_payout">
      {/* body — unchanged */}
    </PlanGatedScreen>
  </SafeAreaView>
);
```

- [ ] **Step 3: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep reconciliation
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add mobile/app/owner/reconciliation.tsx
git commit -m "feat(billing): gate reconciliation screen behind pro plan"
```

---

### Task 13: Fix `add-business.tsx` 402 error handling

**Files:**
- Modify: `mobile/app/owner/add-business.tsx`

- [ ] **Step 1: Add `is402Error` import**

In `mobile/app/owner/add-business.tsx`, update the errors import:

```ts
import { toApiErrorMessage, is402Error } from '@/api/errors';
```

Also add the `UpgradePrompt` import:

```ts
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
```

- [ ] **Step 2: Add `upgradeRequired` state**

Add a new state variable inside `AddBusinessScreen` alongside the existing `error` state:

```ts
const [upgradeRequired, setUpgradeRequired] = useState(false);
```

- [ ] **Step 3: Update the `submit` catch block**

Replace the existing catch block:

```ts
// BEFORE:
} catch (err) {
  setError(toApiErrorMessage(err));
}

// AFTER:
} catch (err) {
  if (is402Error(err)) {
    setUpgradeRequired(true);
  } else {
    setError(toApiErrorMessage(err));
  }
}
```

- [ ] **Step 4: Reset `upgradeRequired` on input changes**

In the `setName` onChangeText handler:

```ts
// BEFORE:
onChangeText={(v) => { setName(v); setError(null); }}

// AFTER:
onChangeText={(v) => { setName(v); setError(null); setUpgradeRequired(false); }}
```

- [ ] **Step 5: Add the upgrade prompt card above the submit button**

Replace the existing error display and button section:

```tsx
{/* BEFORE: */}
{error ? <StatusMessage message={error} tone="error" /> : null}

<TouchableOpacity
  onPress={submit}
  ...
>

{/* AFTER: */}
{error ? <StatusMessage message={error} tone="error" /> : null}

{upgradeRequired ? (
  <UpgradePrompt
    feature="Multiple businesses"
    requiredPlan="starter"
    description="You've reached your plan's business limit. Upgrade to add more businesses to your account."
  />
) : null}

<TouchableOpacity
  onPress={submit}
  disabled={loading || !name.trim() || upgradeRequired}
  style={{
    height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: loading || !name.trim() || upgradeRequired ? `${colors.brand}50` : colors.brand,
    marginTop: 8,
  }}
>
```

- [ ] **Step 6: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep add-business
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add mobile/app/owner/add-business.tsx
git commit -m "feat(billing): replace 402 raw error with upgrade prompt in add-business"
```

---

### Task 14: Clean up `analytics.tsx`

Replace inline `billing.data?.planUsage?.limits?.analytics` checks with `usePlanGate` and move the filter controls inside the gate.

**Files:**
- Modify: `mobile/app/owner/analytics.tsx`

- [ ] **Step 1: Update imports**

Replace the `useBillingWorkspace` import with `usePlanGate`:

```ts
// REMOVE from the featureHooks import list:
useBillingWorkspace,

// ADD new import (separate line, after the featureHooks import block):
import { usePlanGate } from '@/api/hooks/planGate';
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

- [ ] **Step 2: Replace inline billing logic in the component body**

In `AnalyticsScreen`, replace:

```ts
// REMOVE these 5 lines:
const billing = useBillingWorkspace();
const analyticsLimit = billing.data?.planUsage?.limits?.analytics;
const hasBasicAnalytics = billing.isError || analyticsLimit === true || analyticsLimit === 'basic' || analyticsLimit === 'full';
const hasFullAnalytics = billing.isError || analyticsLimit === 'full';
const canExport = billing.data?.planUsage?.limits?.export === true;

// ADD these 3 lines:
const { allowed: hasBasicAnalytics } = usePlanGate('analytics_basic');
const { allowed: hasFullAnalytics } = usePlanGate('analytics_full');
const { allowed: canExport } = usePlanGate('export');
```

- [ ] **Step 3: Update the `pnl`, `cashFlow`, `topCustomers`, `customerAnalytics`, `analytics` query enabled conditions**

These already reference `hasBasicAnalytics` and `hasFullAnalytics` — no change needed; the variable names are preserved.

- [ ] **Step 4: Move the ScrollView inside `PlanGatedScreen`**

In the JSX return, wrap the `<ScrollView>` (and everything inside it) with `<PlanGatedScreen feature="analytics_basic">`. Remove the inline `UpgradePrompt` card that was at line 178-184 (the `{!billing.isLoading && !hasBasicAnalytics ? <UpgradePrompt .../> : null}` block) — `PlanGatedScreen` replaces it.

Also change `{analyticsTab === 'overview' && hasBasicAnalytics && (...)}` to `{analyticsTab === 'overview' && (...)}` since the content is now inside the gate.

```tsx
{/* BEFORE structure: */}
<ScrollView ...>
  {!billing.isLoading && !hasBasicAnalytics ? <UpgradePrompt ... /> : null}
  <View> {/* period selector */} </View>
  <View> {/* groupby selector */} </View>
  <View> {/* tab row */} </View>
  {analyticsTab === 'overview' && hasBasicAnalytics && (...)}
  ...
</ScrollView>

{/* AFTER structure: */}
<PlanGatedScreen feature="analytics_basic">
  <ScrollView ...>
    <View> {/* period selector */} </View>
    <View> {/* groupby selector */} </View>
    <View> {/* tab row */} </View>
    {analyticsTab === 'overview' && (...)}
    ...
  </ScrollView>
</PlanGatedScreen>
```

The Finance and Customers tab inline `<UpgradePrompt>` cards (for `hasFullAnalytics`) stay as-is — they are tab-level gates within the already-accessible screen.

- [ ] **Step 5: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep analytics
```

Expected: no errors

- [ ] **Step 6: Run existing tests**

```bash
cd mobile && npx jest --no-coverage 2>&1 | tail -10
```

Expected: all existing tests pass

- [ ] **Step 7: Commit**

```bash
git add mobile/app/owner/analytics.tsx
git commit -m "feat(billing): replace inline billing logic with usePlanGate in analytics"
```

---

### Task 15: Clean up `stock.tsx`

`stock.tsx` is a near-identical copy of `analytics.tsx`. Apply the exact same changes.

**Files:**
- Modify: `mobile/app/owner/stock.tsx`

- [ ] **Step 1: Update imports** — same as Task 14 Step 1

- [ ] **Step 2: Replace inline billing logic** — same 5-line replacement as Task 14 Step 2

- [ ] **Step 3: Restructure JSX** — same `<PlanGatedScreen feature="analytics_basic">` wrapper around the `<ScrollView>`, remove the inline `UpgradePrompt` card, remove `hasBasicAnalytics` guard from overview tab condition

- [ ] **Step 4: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep stock
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add mobile/app/owner/stock.tsx
git commit -m "feat(billing): replace inline billing logic with usePlanGate in stock"
```

---

### Task 16: Clean up `credit.tsx`

**Files:**
- Modify: `mobile/app/owner/credit.tsx`

- [ ] **Step 1: Update imports**

Remove `useBillingWorkspace` from the featureHooks import. Add:

```ts
import { usePlanGate } from '@/api/hooks/planGate';
```

- [ ] **Step 2: Replace inline billing logic**

```ts
// REMOVE:
const billing = useBillingWorkspace();
const creditAllowed = billing.isError ? true : billing.data?.planUsage?.limits?.credit_scoring === true;
const creditReady = !billing.isLoading && creditAllowed;

// ADD:
const { allowed: creditAllowed, loading: creditLoading } = usePlanGate('credit_scoring');
const creditReady = !creditLoading && creditAllowed;
```

- [ ] **Step 3: Wrap credit body with `PlanGatedScreen`**

Replace the existing `if (!creditReady) { return <UpgradePrompt .../> }` pattern (or the inline conditional render) with `PlanGatedScreen`:

Add import:
```ts
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
```

In the JSX, wrap the body (everything after the header) the same way as Tasks 6–12:

```tsx
return (
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <View style={{ /* header */ }}>
      ...existing header...
    </View>
    <PlanGatedScreen feature="credit_scoring">
      {/* existing body — ScrollView etc. */}
    </PlanGatedScreen>
  </SafeAreaView>
);
```

Remove any remaining `if (billing.isLoading || scoreLoading)` early-return that showed a spinner for the credit gate specifically (keep spinners for the score data itself).

- [ ] **Step 4: TypeScript check**

```bash
cd mobile && npx tsc --noEmit 2>&1 | grep credit
```

Expected: no errors

- [ ] **Step 5: Run all tests**

```bash
cd mobile && npx jest --no-coverage 2>&1 | tail -15
```

Expected: all tests pass

- [ ] **Step 6: Final commit**

```bash
git add mobile/app/owner/credit.tsx
git commit -m "feat(billing): replace inline billing logic with usePlanGate in credit"
```
