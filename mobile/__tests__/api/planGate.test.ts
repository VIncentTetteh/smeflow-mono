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
  mock.onGet('/api/v1/billing/plan').reply(200, PLAN_USAGE_RESPONSE);
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
    mock.onGet('/api/v1/billing/plan').reply(() => new Promise(() => {}));
    const { result } = renderHook(() => usePlanGate('payroll'), { wrapper: createWrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.allowed).toBe(true);
  });

  it('returns allowed:true on billing fetch error (fail open)', async () => {
    mock.onGet('/api/v1/billing/plan').reply(500);
    const { result } = renderHook(() => usePlanGate('payroll'), { wrapper: createWrapper() });
    // The billing hook retries once (retry: 1) before settling into error state.
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 });
    expect(result.current.allowed).toBe(true);
  });
});

describe('usePlanGate — starter plan', () => {
  beforeEach(() => {
    mock.onGet('/api/v1/billing/plan').reply(200, {
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
    mock.onGet('/api/v1/billing/plan').reply(200, {
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

describe('usePlanGate — pro plan (backend UNLIMITED sentinel is -1, not null)', () => {
  beforeEach(() => {
    // Regression fixture: the backend's real PLANS config uses -1 (billing/
    // models.py's UNLIMITED constant), not null, for the pro tier's numeric
    // limits — customers, team_members, invoices, employees, ai_messages.
    mock.onGet('/api/v1/billing/plan').reply(200, {
      ...PLAN_USAGE_RESPONSE,
      plan: 'pro',
      limits: {
        ...PLAN_USAGE_RESPONSE.limits,
        analytics: 'full',
        credit_scoring: true,
        tax_summary: true,
        gra_submission: true,
        employees: -1,
        invoices: -1,
        invoice_pdf: true,
        team_members: -1,
        customers: -1,
        ai_messages: -1,
        businesses: 3,
        bulk_momo_payout: true,
        cost_margin_tracking: true,
        export: true,
        recurring_invoices: true,
      },
    });
  });

  it.each(['customers', 'team', 'payroll', 'invoices', 'assistant'] as const)(
    'returns allowed:true for %s on pro (unlimited via -1 sentinel)',
    async (feature) => {
      const { result } = renderHook(() => usePlanGate(feature), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.allowed).toBe(true);
    }
  );

  it('returns allowed:true for analytics_full, credit_scoring, and bulk_momo_payout on pro', async () => {
    for (const feature of ['analytics_full', 'credit_scoring', 'bulk_momo_payout'] as const) {
      const { result } = renderHook(() => usePlanGate(feature), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.allowed).toBe(true);
    }
  });
});
