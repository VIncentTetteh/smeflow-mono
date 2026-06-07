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
  mock.onGet('/api/v1/billing/plan').reply(200, { limits, usage });
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
  mock.onGet('/api/v1/billing/plan').reply(() => new Promise(() => {}));
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
