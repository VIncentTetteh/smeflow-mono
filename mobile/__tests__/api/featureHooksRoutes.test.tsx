jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

import React, { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import MockAdapter from 'axios-mock-adapter';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/store/auth';
import {
  useAdjustStock,
  useAnalyticsSummary,
  useAnalyticsPnL,
  useAnalyticsCashFlow,
  useAgentWalletWorkspace,
  useBillingWorkspace,
  useClearChatHistory,
  useCreateDebitNote,
  useCreateItem,
  useCreatePurchaseOrder,
  useCreateSupplier,
  useDeleteSupplier,
  useExportAnalytics,
  useGenerateGhQR,
  useCancelMerchantSettlement,
  useProcessChatMessage,
  usePaymentsWorkspace,
  useReferralCode,
  useReferralStatus,
  useRequestMerchantSettlement,
  useRequestLoan,
  useRecordCreditPayment,
  useRetryNotificationEvent,
  useRunPayroll,
  useSendInvoice,
  useSelectPlan,
  useSendReferral,
  useThresholdSuggestion,
  useTopCustomers,
  useUpdateNotificationPreferences,
  useUpdateSupplier,
  useVoidInvoice,
  useWithdrawAgentWallet,
} from '@/api/hooks/featureHooks';

const mock = new MockAdapter(apiClient);
let queryClient: QueryClient | null = null;

function createWrapper() {
  queryClient = new QueryClient({
    defaultOptions: {
      mutations: { gcTime: 0, retry: false },
      queries: { gcTime: 0, retry: false },
    },
  });
  const client = queryClient;

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('feature hook route contracts', () => {
  beforeEach(() => mock.reset());

  afterEach(() => {
    queryClient?.clear();
    queryClient = null;
    useAuthStore.setState({ businessId: null });
  });

  it('runs payroll through the versioned payroll route', async () => {
    mock.onPost('/api/v1/payroll/runs', {
      period_start: '2026-05-01',
      period_end: '2026-05-31',
    }).reply(201, {
      id: 'run-1',
      status: 'draft',
    });

    const { result, unmount } = renderHook(() => useRunPayroll(), { wrapper: createWrapper() });

    await expect(
      act(() =>
        result.current.mutateAsync({
          period_start: '2026-05-01',
          period_end: '2026-05-31',
        })
      )
    ).resolves.toMatchObject({ id: 'run-1' });
    unmount();
  });

  it('loads analytics with selected period and grouping', async () => {
    mock.onGet('/api/v1/analytics/revenue', {
      params: { period: '30d', group_by: 'day' },
    }).reply(200, [
      { day: '2026-05-30', revenue: '42.00' },
    ]);

    const { result, unmount } = renderHook(
      () => useAnalyticsSummary({ period: '30d', group_by: 'day' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        expect.objectContaining({ revenue: '42.00' }),
      ]);
    });
    unmount();
  });

  it('generates GhQR through the versioned payments route', async () => {
    mock.onPost('/api/v1/payments/ghqr/generate', {
      amount: '42.00',
      reference: 'sale-42',
    }).reply(200, {
      qr_payload: 'payload',
      qr_image_url: 'https://example.test/qr.png',
    });

    const { result, unmount } = renderHook(() => useGenerateGhQR(), { wrapper: createWrapper() });

    await expect(
      act(() =>
        result.current.mutateAsync({
          amount: '42.00',
          reference: 'sale-42',
        })
      )
    ).resolves.toMatchObject({ qr_payload: 'payload' });
    unmount();
  });

  it('updates notification preferences through the versioned notifications route', async () => {
    mock.onPut('/api/v1/notifications/preferences', {
      push_enabled: true,
    }).reply(200, {
      id: 'prefs-1',
      whatsapp_enabled: true,
      sms_enabled: false,
      push_enabled: true,
      event_prefs: {},
      created_at: '2026-05-20T00:00:00Z',
      updated_at: '2026-05-20T00:00:00Z',
    });

    const { result, unmount } = renderHook(() => useUpdateNotificationPreferences(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ push_enabled: true }))
    ).resolves.toMatchObject({ push_enabled: true });
    unmount();
  });

  it('retries failed notification events through the versioned notifications route', async () => {
    mock.onPost('/api/v1/notifications/events/event-1/retry', {}).reply(200, {
      id: 'event-1',
      event_type: 'stock.low.digest',
      channel: 'whatsapp',
      phone: '+233244999001',
      message: 'Low stock digest',
      status: 'sent',
      provider_response: { provider_reference: 'retry-ref-1' },
      retryable: false,
      provider_reference: 'retry-ref-1',
      created_at: '2026-05-22T08:00:00Z',
      sent_at: '2026-05-22T08:01:00Z',
    });

    const { result, unmount } = renderHook(() => useRetryNotificationEvent(), {
      wrapper: createWrapper(),
    });

    let retried: unknown;
    await act(async () => {
      retried = await result.current.mutateAsync('event-1');
    });

    expect(retried).toMatchObject({ id: 'event-1', status: 'sent' });
    unmount();
  });

  it('loads the payments workspace with settlement wallet data', async () => {
    mock.onGet('/api/v1/payments').reply(200, { items: [], total: 0 });
    mock.onGet('/api/v1/payments/reconciliation/inbox').reply(200, {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      summary: { unmatched: 0, suggested_match: 0, matched: 0, ignored: 0, refunded: 0 },
    });
    mock.onGet('/api/v1/payments/analytics/channels').reply(200, {
      grand_total: '0.00',
      items: [],
    });
    mock.onGet('/api/v1/settlements/balance').reply(200, {
      business_id: 'biz-1',
      unsettled_balance: '125.00',
      total_settled: '75.00',
      settlement_threshold: '50.00',
      settlement_enabled: true,
      pending_settlement_count: 0,
      eligible_for_auto_settlement: true,
    });
    mock.onGet('/api/v1/settlements/ledger', { params: { limit: 25 } }).reply(200, {
      total: 1,
      items: [{ id: 'ledger-1', type: 'credit', amount: '125.00', balance_after: '125.00', created_at: '2026-06-05T08:00:00Z' }],
    });
    mock.onGet('/api/v1/settlements', { params: { limit: 25 } }).reply(200, {
      total: 1,
      items: [{ id: 'settle-1', amount: '75.00', fee_amount: '0.00', net_amount: '75.00', status: 'completed' }],
    });

    const { result, unmount } = renderHook(() => usePaymentsWorkspace(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.settlementBalance.unsettled_balance).toBe('125.00');
      expect(result.current.data?.settlementLedger.items).toHaveLength(1);
      expect(result.current.data?.settlements.items[0]).toMatchObject({ status: 'completed' });
    });
    unmount();
  });

  it('requests merchant settlements through the settlement request route', async () => {
    mock.onPost('/api/v1/settlements/request', { amount: '50.00' }).reply(201, {
      settlement_id: 'settle-1',
      status: 'processing',
      amount: '50.00',
      fee_amount: '0.00',
      net_amount: '50.00',
      message: 'Your withdrawal is being processed and will arrive shortly.',
    });

    const { result, unmount } = renderHook(() => useRequestMerchantSettlement(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ amount: '50.00' }))
    ).resolves.toMatchObject({ settlement_id: 'settle-1' });
    unmount();
  });

  it('cancels pending merchant settlements through the settlement delete route', async () => {
    mock.onDelete('/api/v1/settlements/settle-1', { data: { reason: 'Changed mind' } }).reply(200, {
      settlement_id: 'settle-1',
      status: 'cancelled',
      message: 'Settlement cancelled. Your balance has been restored.',
    });

    const { result, unmount } = renderHook(() => useCancelMerchantSettlement(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ settlementId: 'settle-1', reason: 'Changed mind' }))
    ).resolves.toMatchObject({ status: 'cancelled' });
    unmount();
  });

  it('loads agent wallet, commission details, and payout history through wallet routes', async () => {
    mock.onGet('/api/v1/agents/wallet').reply(200, {
      agent_id: 'agent-1',
      pending_balance: '20.00',
      available_balance: '40.00',
      total_paid_out: '100.00',
      total_commission_earned: '160.00',
      next_payout_date: '2026-06-05T10:00:00Z',
      payout_threshold: '10.00',
      eligible_for_payout: true,
    });
    mock.onGet('/api/v1/agents/wallet/commissions', { params: { limit: 50 } }).reply(200, {
      total: 1,
      items: [{
        id: 'commission-1',
        trigger: 'first_sale',
        amount_ghs: '20.00',
        status: 'available',
        available_at: '2026-06-04T10:00:00Z',
        created_at: '2026-06-02T10:00:00Z',
      }],
    });
    mock.onGet('/api/v1/agents/wallet/history', { params: { limit: 25 } }).reply(200, {
      total: 1,
      items: [{
        batch_id: 'batch-1',
        amount_ghs: '100.00',
        transfer_code: 'TRF_1',
        status: 'success',
        payout_date: '2026-06-05T10:00:00Z',
      }],
    });

    const { result, unmount } = renderHook(() => useAgentWalletWorkspace(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.wallet.available_balance).toBe('40.00');
      expect(result.current.data?.commissions[0]).toMatchObject({ status: 'available' });
      expect(result.current.data?.history[0]).toMatchObject({ transfer_code: 'TRF_1' });
    });
    unmount();
  });

  it('loads billing workspace through versioned subscription endpoints', async () => {
    useAuthStore.setState({ businessId: 'biz-1' });
    mock.onGet('/api/v1/billing/plans').reply(200, [
      { name: 'Pro', tier: 'pro', price: 149 },
    ]);
    mock.onGet('/api/v1/billing/subscription').reply(200, {
      plan: 'free',
      status: 'active',
    });
    mock.onGet('/api/v1/billing/transactions').reply(200, [
      { id: 'txn-1', amount: 149, provider: 'paystack' },
    ]);
    mock.onGet('/api/v1/billing/invoices').reply(200, [
      { id: 'binv-1', status: 'paid' },
    ]);
    mock.onGet('/api/v1/billing/plan').reply(200, {
      plan: 'free',
      status: 'active',
      subscription: { plan: 'free', status: 'active' },
      usage: { monthly_sales: 481, items: 92, employees: 3 },
      limits: {
        monthly_sales: 500,
        items: 100,
        employees: 3,
        analytics: false,
        credit_scoring: false,
        export: false,
      },
    });

    const { result, unmount } = renderHook(() => useBillingWorkspace(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(queryClient?.getQueryData(['billing-workspace', 'biz-1'])).toBeTruthy();
      expect(result.current.data).toMatchObject({
        plans: [expect.objectContaining({ tier: 'pro' })],
        subscription: expect.objectContaining({ plan: 'free' }),
        transactions: [expect.objectContaining({ id: 'txn-1' })],
        invoices: [expect.objectContaining({ id: 'binv-1' })],
        planUsage: expect.objectContaining({
          usage: expect.objectContaining({ monthly_sales: 481 }),
          limits: expect.objectContaining({ export: false }),
        }),
      });
    });
    unmount();
  });

  it('selects paid and free billing plans through the correct subscription routes', async () => {
    mock.onPost('/api/v1/billing/subscribe', { plan: 'pro' }).reply(200, {
      payment_url: 'https://checkout.paystack.test/pay/pro',
      provider_ref: 'psk-1',
      status: 'pending',
    });
    mock.onPost('/api/v1/billing/subscription/change', { plan: 'free' }).reply(200, {
      plan: 'free',
      status: 'active',
    });

    const { result, unmount } = renderHook(() => useSelectPlan(), {
      wrapper: createWrapper(),
    });

    let paidPlan: unknown;
    await act(async () => {
      paidPlan = await result.current.mutateAsync({ tier: 'pro' });
    });
    expect(paidPlan).toMatchObject({ provider_ref: 'psk-1' });

    let freePlan: unknown;
    await act(async () => {
      freePlan = await result.current.mutateAsync({ tier: 'free' });
    });
    expect(freePlan).toMatchObject({ plan: 'free' });
    unmount();
  });

  it('selects annual billing through the subscription route', async () => {
    mock.onPost('/api/v1/billing/subscribe', { plan: 'starter', billing_interval: 'annual' }).reply(200, {
      payment_url: 'https://checkout.paystack.test/pay/starter-annual',
      provider_ref: 'psk-annual-1',
      status: 'pending',
      billing_interval: 'annual',
    });

    const { result, unmount } = renderHook(() => useSelectPlan(), {
      wrapper: createWrapper(),
    });

    let annualPlan: unknown;
    await act(async () => {
      annualPlan = await result.current.mutateAsync({ tier: 'starter', billing_interval: 'annual' });
    });
    expect(annualPlan).toMatchObject({ provider_ref: 'psk-annual-1', billing_interval: 'annual' });
    unmount();
  });

  it('loads referral code/status and sends invites through referral endpoints', async () => {
    mock.onGet('/api/v1/referrals/my-code').reply(200, {
      referral_code: 'SME123',
      link: 'https://smeflow.app/join?ref=SME123',
    });
    mock.onGet('/api/v1/referrals/status').reply(200, {
      referral_code: 'SME123',
      total_invited: 2,
      converted: 1,
      pending: 1,
      reward_granted: true,
    });
    mock.onPost('/api/v1/referrals/invite', { referee_phone: '+233241234567' }).reply(201, {
      message: 'Invite sent',
    });

    const code = renderHook(() => useReferralCode(), { wrapper: createWrapper() });
    await waitFor(() => expect(code.result.current.data?.referral_code).toBe('SME123'));
    code.unmount();

    const status = renderHook(() => useReferralStatus(), { wrapper: createWrapper() });
    await waitFor(() => expect(status.result.current.data?.converted).toBe(1));
    status.unmount();

    const send = renderHook(() => useSendReferral(), { wrapper: createWrapper() });
    let invite: unknown;
    await act(async () => {
      invite = await send.result.current.mutateAsync({ referee_phone: '+233241234567' });
    });
    expect(invite).toMatchObject({ message: 'Invite sent' });
    send.unmount();
  });

  it('sends invoices through the pilot invoice action route', async () => {
    mock.onPost('/api/v1/invoices/inv-1/send').reply(200, { message: 'sent' });

    const { result, unmount } = renderHook(() => useSendInvoice(), { wrapper: createWrapper() });

    await expect(act(() => result.current.mutateAsync('inv-1'))).resolves.toMatchObject({
      message: 'sent',
    });
    unmount();
  });

  it('voids invoices through the pilot invoice action route', async () => {
    mock.onPost('/api/v1/invoices/inv-1/void').reply(200, {
      id: 'inv-1',
      status: 'void',
    });

    const { result, unmount } = renderHook(() => useVoidInvoice(), { wrapper: createWrapper() });

    await expect(act(() => result.current.mutateAsync('inv-1'))).resolves.toMatchObject({
      status: 'void',
    });
    unmount();
  });

  it('creates debit notes through the invoice debit-note route', async () => {
    mock.onPost('/api/v1/invoices/inv-1/debit-note', {
      line_items: [{ description: 'Price correction', qty: '1', unit_price: '5.00' }],
    }).reply(201, {
      id: 'dn-1',
      original_invoice_id: 'inv-1',
      type: 'debit_note',
    });

    const { result, unmount } = renderHook(() => useCreateDebitNote(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          invoiceId: 'inv-1',
          line_items: [{ description: 'Price correction', qty: '1', unit_price: '5.00' }],
        })
      )
    ).resolves.toMatchObject({ type: 'debit_note' });
    unmount();
  });

  it('creates inventory items with pilot low-stock fields intact', async () => {
    mock.onPost('/api/v1/inventory/items', {
      name: 'Tomato paste',
      unit: 'tin',
      sell_price: '12.00',
      initial_stock: '4',
      low_stock_threshold: '5',
      barcode: '6034000000012',
    }).reply(201, {
      id: 'item-1',
      name: 'Tomato paste',
      is_low_stock: true,
    });

    const { result, unmount } = renderHook(() => useCreateItem(), { wrapper: createWrapper() });

    await expect(
      act(() =>
        result.current.mutateAsync({
          name: 'Tomato paste',
          unit: 'tin',
          sell_price: '12.00',
          initial_stock: '4',
          low_stock_threshold: '5',
          barcode: '6034000000012',
        })
      )
    ).resolves.toMatchObject({ is_low_stock: true });
    unmount();
  });

  it('posts stock adjustments through the inventory adjustment route', async () => {
    mock.onPost('/api/v1/inventory/adjust', {
      item_id: 'item-1',
      qty_change: '10',
      reason: 'purchase',
      notes: 'Restock before pilot',
    }).reply(201, {
      id: 'stock-1',
      item_id: 'item-1',
      qty_after: '14',
    });

    const { result, unmount } = renderHook(() => useAdjustStock(), { wrapper: createWrapper() });

    await expect(
      act(() =>
        result.current.mutateAsync({
          item_id: 'item-1',
          qty_change: '10',
          reason: 'purchase',
          notes: 'Restock before pilot',
        })
      )
    ).resolves.toMatchObject({ qty_after: '14' });
    unmount();
  });

  it('records customer receivable payments through the sale payment route', async () => {
    mock.onPost('/api/v1/sales/sale-1/pay', {
      amount: 20,
      payment_method: 'momo',
    }).reply(200, {
      id: 'sale-1',
      payment_status: 'partial',
    });

    const { result, unmount } = renderHook(() => useRecordCreditPayment(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          sale_id: 'sale-1',
          amount: 20,
          payment_method: 'momo',
        })
      )
    ).resolves.toMatchObject({ payment_status: 'partial' });
    unmount();
  });

  it('submits selected lender with loan applications', async () => {
    mock.onPost('/api/v1/credit/request', {
      amount_requested: 8500,
      term_days: 180,
      target_lender_id: 'ghanafin',
    }).reply(201, {
      id: 'loan-1',
      amount_requested: '8500.00',
      term_days: 180,
      lender_id: 'ghanafin',
      status: 'pending_partner',
    });

    const { result, unmount } = renderHook(() => useRequestLoan(), { wrapper: createWrapper() });

    await expect(
      act(() =>
        result.current.mutateAsync({
          amount_requested: 8500,
          term_days: 180,
          target_lender_id: 'ghanafin',
        })
      )
    ).resolves.toMatchObject({ lender_id: 'ghanafin' });
    unmount();
  });

  it('passes selected assistant language through the chat route', async () => {
    mock.onPost('/api/v1/chat/process', {
      message: "Show me today's sales",
      language: 'ak',
    }).reply(200, {
      reply: 'Translated sales summary',
      intent: 'get_report',
    });

    const { result, unmount } = renderHook(() => useProcessChatMessage(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          message: "Show me today's sales",
          language: 'ak',
        })
      )
    ).resolves.toMatchObject({ reply: 'Translated sales summary' });
    unmount();
  });

  it('creates a supplier through the versioned inventory route', async () => {
    mock.onPost('/api/v1/inventory/suppliers', {
      name: 'Kofi Trading Co',
      phone: '0244000001',
    }).reply(201, {
      id: 'sup-1',
      name: 'Kofi Trading Co',
      phone: '0244000001',
      email: null,
      address: null,
    });

    const { result, unmount } = renderHook(() => useCreateSupplier(), { wrapper: createWrapper() });

    await expect(
      act(() => result.current.mutateAsync({ name: 'Kofi Trading Co', phone: '0244000001' }))
    ).resolves.toMatchObject({ id: 'sup-1', name: 'Kofi Trading Co' });
    unmount();
  });

  it('updates a supplier through the versioned inventory PATCH route', async () => {
    mock.onPatch('/api/v1/inventory/suppliers/sup-1', { phone: '0244000002' }).reply(200, {
      id: 'sup-1',
      name: 'Kofi Trading Co',
      phone: '0244000002',
      email: null,
      address: null,
    });

    const { result, unmount } = renderHook(() => useUpdateSupplier(), { wrapper: createWrapper() });

    await expect(
      act(() => result.current.mutateAsync({ id: 'sup-1', body: { phone: '0244000002' } }))
    ).resolves.toMatchObject({ phone: '0244000002' });
    unmount();
  });

  it('deletes a supplier through the versioned inventory DELETE route', async () => {
    mock.onDelete('/api/v1/inventory/suppliers/sup-1').reply(204);

    const { result, unmount } = renderHook(() => useDeleteSupplier(), { wrapper: createWrapper() });

    await expect(act(() => result.current.mutateAsync('sup-1'))).resolves.toBeUndefined();
    unmount();
  });

  it('creates a purchase order through the versioned inventory route', async () => {
    mock.onPost('/api/v1/inventory/purchase-orders', {
      supplier_id: 'sup-1',
      expected_delivery_date: '2026-07-01',
      line_items: [{ item_id: 'item-1', qty: 10, cost_price: 25 }],
    }).reply(201, {
      id: 'po-1',
      supplier_id: 'sup-1',
      status: 'draft',
      expected_delivery_date: '2026-07-01',
      line_items: [{ item_id: 'item-1', qty: 10, cost_price: 25 }],
    });

    const { result, unmount } = renderHook(() => useCreatePurchaseOrder(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          supplier_id: 'sup-1',
          expected_delivery_date: '2026-07-01',
          line_items: [{ item_id: 'item-1', qty: 10, cost_price: 25 }],
        })
      )
    ).resolves.toMatchObject({ id: 'po-1', status: 'draft' });
    unmount();
  });

  it('clears chat history through the versioned DELETE route', async () => {
    mock.onDelete('/api/v1/chat/history').reply(204);

    const { result, unmount } = renderHook(() => useClearChatHistory(), {
      wrapper: createWrapper(),
    });

    await expect(act(() => result.current.mutateAsync())).resolves.toBeUndefined();
    unmount();
  });

  it('withdraws agent wallet balance through the payouts route', async () => {
    mock.onPost('/api/v1/payouts/withdraw', { amount: 100 }).reply(200, {
      status: 'pending',
      amount: 100,
      transfer_code: 'TRF_abc123',
    });

    const { result, unmount } = renderHook(() => useWithdrawAgentWallet(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ amount: 100 }))
    ).resolves.toMatchObject({ status: 'pending', amount: 100 });
    unmount();
  });

  it('fetches ML threshold suggestion through the versioned inventory route', async () => {
    mock
      .onGet('/api/v1/inventory/items/item-abc/threshold-suggestion')
      .reply(200, { suggested_threshold: 15, reasoning: 'Based on 7-day sales velocity' });

    const { result, unmount } = renderHook(() => useThresholdSuggestion(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync('item-abc'))
    ).resolves.toMatchObject({ suggested_threshold: 15 });
    unmount();
  });

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
});
