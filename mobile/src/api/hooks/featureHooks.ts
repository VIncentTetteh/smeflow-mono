import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAgentDashboard,
  getAgentReferralCode,
  getAgentTraderDetail,
  getAgentWallet,
  listAgentCommissions,
  listAgentPayoutHistory,
  listAgentTraders,
  listAgentWalletCommissions,
  onboardTraderFull,
  withdrawAgentWallet,
} from '@/api/agents.api';
import {
  exportAnalytics,
  getCashFlow,
  getCustomerAnalytics,
  getExportDownload,
  getPnL,
  getPredictiveRestock,
  getRevenue,
  getTopCustomers,
  getTopItems,
} from '@/api/analytics.api';
import {
  cancelSubscription,
  getBillingPlanUsage,
  getSubscription,
  listBillingInvoices,
  listBillingPlans,
  listBillingTransactions,
} from '@/api/billing.api';
import { apiClient } from '@/api/client';
import { clearChatHistory, getChatHistory, processChatMessage } from '@/api/chat.api';
import { getActiveLenders, getCreditScore, getCreditScoreHistory, listLoanRequests, requestLoan } from '@/api/credit.api';
import {
  createDebitNote,
  generateInvoice,
  getInvoice,
  getInvoiceBySale,
  listInvoices,
  sendInvoice,
  voidInvoice,
} from '@/api/invoices.api';
import {
  listNotificationEvents,
  getNotificationPreferences,
  retryNotificationEvent,
  updateNotificationPreferences,
  dismissMerchantAlert,
  listCustomerDeliveries,
  listMerchantAlerts,
  markMerchantAlertRead,
  retryCustomerDelivery,
} from '@/api/notifications.api';
import {
  disbursePayment,
  generateGhqr,
  getPayment,
  getPaymentReconciliationInbox,
  getPaymentChannelAnalytics,
  ignoreReconciliationItem,
  unignoreReconciliationItem,
  listPayments,
  requestPayment,
} from '@/api/payments.api';
import {
  cancelMerchantSettlement,
  getSettlementBalance,
  getSettlementLedger,
  listMerchantSettlements,
  previewMerchantSettlement,
  requestMerchantSettlement,
} from '@/api/settlements.api';
import { registerDevice, updateMe } from '@/api/auth.api';
import { approvePayrollRun, createEmployee, downloadP9A, downloadP9B, getRunPayslips, listEmployees, listPayrollRuns, payPayslip, runPayroll, updateEmployee } from '@/api/payroll.api';
import * as Linking from 'expo-linking';
import { retrySalePayment } from '@/api/sales.api';
import {
  getCustomer,
  getDailySummary,
  getPeriodSummary,
  getSale,
  listCustomers,
  listSales,
  createCreditRepaymentIntent, recordPayment,
  voidSale,
} from '@/api/sales.api';
import { getDashboardSummary } from '@/api/business.api';
import {
  adjustStock,
  createCategory,
  createItem,
  createPurchaseOrder,
  createSupplier,
  deleteItem,
  deleteSupplier,
  getItem,
  getThresholdSuggestion,
  listCategories,
  listItems,
  listPurchaseOrders,
  listSuppliers,
  receivePurchaseOrder,
  updateItem,
  updateSupplier,
} from '@/api/inventory.api';
import type { ItemListParams, ThresholdSuggestionDto } from '@/api/inventory.api';
import { confirmLoan, getLoan, getLoanSchedule, resendLoanConfirmation } from '@/api/credit.api';
import { exportTaxReturn, fileTaxReturn, generateTaxReturn, getTaxCalendar, getTaxRates, getTaxSummary, listInputVAT, listTaxReturns, recordInputVAT } from '@/api/tax.api';
import { MOBILE_ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import { useAuthStore } from '@/store/auth';
import type { ChatMessageDto, ChatProcessRequestDto } from '@/types/chat';
import type { StandaloneInvoiceCreateDto } from '@/types/invoices';
import type { CreatePurchaseOrderDto, CreateSupplierDto, ItemCreateDto, ItemUpdateDto, PurchaseOrderDto, StockAdjustmentDto, SupplierDto } from '@/types/inventory';
import type { LoanConfirmDto } from '@/types/credit';
import type { PaymentRequestDto, PaymentDisburseDto, GHQRGenerateDto } from '@/types/payments';
import type { MerchantSettlementRequestDto } from '@/types/settlements';
import type { UserUpdateDto } from '@/types/auth';
import type { AgentWithdrawRequestDto, OnboardTraderPayload } from '@/types/agents';
import type { CashFlowDto, ExportJobDto, PnLDto, TopCustomerDto } from '@/types/analytics';

export function useAnalyticsSummary(params: { period?: string; group_by?: string; enabled?: boolean } = {}) {
  const period = params.period ?? '7d';
  const groupBy = params.group_by ?? 'day';
  return useQuery({
    enabled: params.enabled ?? true,
    queryKey: ['analytics-summary', period, groupBy],
    queryFn: () => getRevenue({ period, group_by: groupBy }),
    staleTime: 10_000,
    refetchOnMount: 'always',
    retry: 1,
  });
}

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

export function useTopItems(params: { from_date: string; to_date: string } | null) {
  return useQuery({
    enabled: !!params,
    queryKey: ['analytics-top-items', params],
    queryFn: () => getTopItems({ ...params!, limit: 10 }),
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
      group_by?: string;
      from_date: string;
      to_date: string;
    }) => {
      const job = await exportAnalytics({
        report: params.report,
        format: params.format,
        group_by: params.group_by ?? 'day',
        from_date: params.from_date,
        to_date: params.to_date,
      });

      for (let i = 0; i < 10; i += 1) {
        const status = await getExportDownload({ job_id: job.job_id });
        if (status.status === 'ready' && status.download_url) {
          return status.download_url;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      }

      throw new Error('Export timed out. Try again later.');
    },
  });
}

export function usePredictiveRestock(daysAhead = 7) {
  return useQuery({
    queryKey: ['predictive-restock', daysAhead],
    queryFn: () => getPredictiveRestock({ days_ahead: daysAhead }),
    staleTime: 5 * 60 * 1000, // 5 min — restock forecasts don't change per-second
    retry: 1,
  });
}

export function useDailySalesSummary() {
  return useQuery({
    queryKey: ['sales-daily-summary'],
    queryFn: getDailySummary,
    staleTime: 10_000,
    refetchOnMount: 'always',
    retry: 1,
  });
}

/** Combined home-dashboard query — replaces 7 individual queries with one network round-trip. */
export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: getDashboardSummary,
    staleTime: 15_000,
    refetchOnMount: 'always',
    retry: 1,
  });
}

export function useSalesHistory(params?: {
  from_date?: string;
  to_date?: string;
  payment_method?: string;
}) {
  return useQuery({
    queryKey: ['sales-history', params?.from_date, params?.to_date, params?.payment_method],
    queryFn: () => listSales(params),
    staleTime: 10_000,
    refetchOnMount: 'always',
    retry: 1,
  });
}

export function useSale(saleId?: string | null) {
  return useQuery({
    enabled: !!saleId,
    queryKey: ['sale', saleId],
    queryFn: () => getSale(saleId!),
    retry: 1,
  });
}

export function useSalesCustomers(search = '') {
  return useQuery({
    queryKey: ['sales-customers', search],
    queryFn: () => listCustomers(search || undefined),
    retry: 1,
  });
}

export function useSalesCustomer(customerId?: string | null) {
  return useQuery({
    enabled: !!customerId,
    queryKey: ['sales-customer', customerId],
    queryFn: () => getCustomer(customerId!),
    retry: 1,
  });
}

export function useRecordCreditPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { amount: number; payment_method: 'cash' | 'momo'; sale_id: string }) =>
      recordPayment(body.sale_id, {
        amount: body.amount,
        payment_method: body.payment_method,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice'] });
      queryClient.invalidateQueries({ queryKey: ['sales-history'] });
      queryClient.invalidateQueries({ queryKey: ['sales-customers'] });
      queryClient.invalidateQueries({ queryKey: ['sales-customer'] });
      queryClient.invalidateQueries({ queryKey: ['sales-daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function useCreateCreditRepaymentIntent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { amount: number; sale_id: string; idempotency_key: string }) =>
      createCreditRepaymentIntent(body.sale_id, body.amount, body.idempotency_key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice'] });
      queryClient.invalidateQueries({ queryKey: ['sales-history'] });
    },
  });
}

export function useChatHistory() {
  return useQuery({
    queryKey: ['chat-history'],
    queryFn: async () => {
      const data = await getChatHistory();
      return data.messages ?? [];
    },
    retry: 1,
  });
}

export function useProcessChatMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: ChatProcessRequestDto) => processChatMessage(message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-history'] });
      queryClient.invalidateQueries({ queryKey: ['sales-history'] });
      queryClient.invalidateQueries({ queryKey: ['sales-daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] });
    },
  });
}

export function useClearChatHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clearChatHistory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-history'] }),
  });
}

export function useCreditScore(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['credit-score'],
    queryFn: getCreditScore,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 1,
  });
}

export function useCreditHistory(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['credit-history'],
    queryFn: getCreditScoreHistory,
    retry: 1,
  });
}

export function useCreditRequests(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['credit-requests'],
    queryFn: listLoanRequests,
    retry: 1,
  });
}

export function useRequestLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestLoan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['credit-requests'] }),
  });
}

export function useInvoices(params?: { from_date?: string; to_date?: string }) {
  return useQuery({
    queryKey: ['invoices', params?.from_date, params?.to_date],
    queryFn: async () =>
      (await listInvoices({ page_size: 100, ...params })).invoices,
    staleTime: 10_000,
    refetchOnMount: 'always',
    retry: 1,
  });
}

export function useGenerateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StandaloneInvoiceCreateDto) => generateInvoice(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function useInvoice(invoiceId?: string | null) {
  return useQuery({
    enabled: !!invoiceId,
    queryKey: ['invoice', invoiceId],
    queryFn: () => getInvoice(invoiceId!),
    retry: 1,
  });
}

export function useInvoiceBySale(saleId?: string | null) {
  return useQuery({
    enabled: !!saleId,
    queryKey: ['invoice-by-sale', saleId],
    queryFn: () => getInvoiceBySale(saleId!),
    refetchInterval: (query) =>
      query.state.data?.invoice_number ? false : 3_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useSendInvoice() {
  return useMutation({
    mutationFn: sendInvoice,
    onSuccess: () => {
      trackEvent(MOBILE_ANALYTICS_EVENTS.INVOICE_SENT);
    },
  });
}

export function useVoidInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: voidInvoice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function useCreateDebitNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, line_items }: { invoiceId: string; line_items: StandaloneInvoiceCreateDto['line_items'] }) =>
      createDebitNote(invoiceId, { line_items }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

export function usePayroll() {
  return useQuery({
    queryKey: ['payroll'],
    queryFn: async () => {
      const [employees, runs] = await Promise.all([
        listEmployees(),
        listPayrollRuns(),
      ]);
      return { employees, runs };
    },
    retry: 1,
  });
}

export function useTaxWorkspace() {
  return useQuery({
    queryKey: ['tax-workspace'],
    queryFn: async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const [summary, returns, calendar] = await Promise.all([
        getTaxSummary({ year, month }),
        listTaxReturns(),
        getTaxCalendar({ year, month }),
      ]);
      return { calendar, returns, summary };
    },
    staleTime: 10_000,   // stays fresh for 10s; sale invalidation forces immediate refetch
    refetchOnMount: 'always',
    retry: 1,
  });
}

export function useNotificationsWorkspace() {
  return useQuery({
    queryKey: ['notifications-workspace'],
    queryFn: async () => {
      const [preferences, events] = await Promise.all([
        getNotificationPreferences(),
        listNotificationEvents(),
      ]);
      return { preferences, events };
    },
    retry: 1,
  });
}

export function useMerchantAlerts(view: 'attention' | 'history') {
  return useQuery({
    queryKey: ['merchant-alerts', view],
    queryFn: () => listMerchantAlerts(view),
    retry: 1,
  });
}

export function useCustomerDeliveries() {
  return useQuery({
    queryKey: ['customer-deliveries'],
    queryFn: listCustomerDeliveries,
    retry: 1,
  });
}

export function useBillingWorkspace() {
  const businessId = useAuthStore((s) => s.businessId);
  return useQuery({
    queryKey: ['billing-workspace', businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const [plans, subscription, transactions, invoices, planUsage] = await Promise.all([
        listBillingPlans(),
        getSubscription(),
        listBillingTransactions(),
        listBillingInvoices(),
        getBillingPlanUsage(),
      ]);
      return { plans, subscription, transactions, invoices, planUsage };
    },
    retry: 1,
  });
}

export function usePaymentsWorkspace() {
  return useQuery({
    queryKey: ['payments-workspace'],
    queryFn: async () => {
      const [payments, reconciliation, channelAnalytics, settlementBalance, settlementLedger, settlements] = await Promise.all([
        listPayments(),
        getPaymentReconciliationInbox(),
        getPaymentChannelAnalytics(),
        getSettlementBalance(),
        getSettlementLedger({ limit: 25 }),
        listMerchantSettlements({ limit: 25 }),
      ]);
      return {
        items: payments.items,
        total: payments.total,
        reconciliation,
        channelAnalytics,
        settlementBalance,
        settlementLedger,
        settlements,
      };
    },
    retry: 1,
  });
}

export function useSettlementBalance() {
  return useQuery({
    queryKey: ['settlements', 'balance'],
    queryFn: getSettlementBalance,
    retry: 1,
  });
}

export function useSettlementLedger(type?: string) {
  return useQuery({
    queryKey: ['settlements', 'ledger', type ?? 'all'],
    queryFn: () => getSettlementLedger({ type: type || undefined, limit: 50 }),
    retry: 1,
  });
}

export function useMerchantSettlements(status?: string) {
  return useQuery({
    queryKey: ['settlements', 'history', status ?? 'all'],
    queryFn: () => listMerchantSettlements({ status: status || undefined, limit: 50 }),
    retry: 1,
  });
}

export function useRequestMerchantSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MerchantSettlementRequestDto) => requestMerchantSettlement(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments-workspace'] });
      qc.invalidateQueries({ queryKey: ['settlements'] });
    },
  });
}

export function useCancelMerchantSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ settlementId, reason }: { settlementId: string; reason?: string }) =>
      cancelMerchantSettlement(settlementId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments-workspace'] });
      qc.invalidateQueries({ queryKey: ['settlements'] });
    },
  });
}

export function useSettlementPreview(amount: number | null) {
  return useQuery({
    queryKey: ['settlements', 'preview', amount],
    queryFn: () => previewMerchantSettlement(amount!),
    enabled: amount !== null && amount > 0,
    staleTime: 10_000, // 10s — fees rarely change mid-session
    retry: 1,
  });
}

export function useReconciliationInbox(params?: { include_ignored?: boolean; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['reconciliation-inbox', params],
    queryFn: () => getPaymentReconciliationInbox(params),
    retry: 1,
  });
}

export function useIgnoreReconciliationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => ignoreReconciliationItem(paymentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconciliation-inbox'] });
      qc.invalidateQueries({ queryKey: ['payments-workspace'] });
    },
  });
}

export function useUnignoreReconciliationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => unignoreReconciliationItem(paymentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconciliation-inbox'] });
      qc.invalidateQueries({ queryKey: ['payments-workspace'] });
    },
  });
}

export function useAgentWorkspace() {
  return useQuery({
    queryKey: ['agent-workspace'],
    queryFn: getAgentDashboard,
    retry: 1,
  });
}

export function useAgentWallet() {
  return useQuery({
    queryKey: ['agent-wallet'],
    queryFn: getAgentWallet,
    retry: 1,
  });
}

export function useAgentPayoutHistory() {
  return useQuery({
    queryKey: ['agent-payout-history'],
    queryFn: async () => {
      const data = await listAgentPayoutHistory({ limit: 25 });
      return data.items ?? [];
    },
    retry: 1,
  });
}

export function useAgentWalletWorkspace() {
  return useQuery({
    queryKey: ['agent-wallet-workspace'],
    queryFn: async () => {
      const [wallet, commissions, history] = await Promise.all([
        getAgentWallet(),
        listAgentWalletCommissions({ limit: 50 }),
        listAgentPayoutHistory({ limit: 25 }),
      ]);
      return {
        wallet,
        commissions: commissions.items ?? [],
        history: history.items ?? [],
      };
    },
    retry: 1,
  });
}

export function useAgentTraders() {
  return useQuery({
    queryKey: ['agent-traders'],
    queryFn: async () => {
      const data = await listAgentTraders();
      return data.items ?? [];
    },
    retry: 1,
  });
}

export function useAgentCommissions() {
  return useQuery({
    queryKey: ['agent-commissions'],
    queryFn: async () => {
      const data = await listAgentWalletCommissions({ limit: 50 });
      return data.items ?? [];
    },
    retry: 1,
  });
}

export function useWithdrawAgentWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentWithdrawRequestDto) => withdrawAgentWallet(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-wallet-workspace'] });
      queryClient.invalidateQueries({ queryKey: ['agent-wallet'] });
    },
    retry: 0,
  });
}

export function useOnboardTrader() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: OnboardTraderPayload) => onboardTraderFull(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-workspace'] });
      queryClient.invalidateQueries({ queryKey: ['agent-traders'] });
    },
    retry: 0,
  });
}

export function useAgentTraderDetail(businessId: string | null) {
  return useQuery({
    enabled: !!businessId,
    queryKey: ['agent-trader-detail', businessId],
    queryFn: () => getAgentTraderDetail(businessId!),
    retry: 1,
    staleTime: 30_000,
  });
}

export function useAgentReferralCode() {
  return useQuery({
    queryKey: ['agent-referral-code'],
    queryFn: getAgentReferralCode,
    retry: 1,
    staleTime: 60_000 * 10, // code won't change often
  });
}

export function useAgentCommissionsFiltered(params?: {
  status?: string;
  from_date?: string;
  to_date?: string;
}) {
  return useQuery({
    queryKey: ['agent-commissions-filtered', params],
    queryFn: async () => {
      const data = await listAgentCommissions({ limit: 100, ...params });
      return data.items ?? [];
    },
    retry: 1,
  });
}

export function useRegisterDevice() {
  return useMutation({
    mutationFn: registerDevice,
    retry: 0,
  });
}

export function useSelectPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tier, billing_interval = 'monthly' }: { tier: string; billing_interval?: 'monthly' | 'annual' }): Promise<{
      payment_url?: string | null;
      provider_ref?: string | null;
      status?: string;
      plan?: string;
      billing_interval?: 'monthly' | 'annual';
      message?: string;
    }> => {
      if (tier === 'free') {
        const res = await apiClient.post('/api/v1/billing/subscription/change', { plan: tier });
        return res.data;
      }
      const payload = billing_interval === 'annual' ? { plan: tier, billing_interval } : { plan: tier };
      const res = await apiClient.post('/api/v1/billing/subscribe', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-workspace'] });
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-workspace'] });
    },
  });
}

// ── Referrals ─────────────────────────────────────────────────────────────────

import { getReferralCode, getReferralStatus, sendReferralInvite } from '@/api/referrals.api';

export function useReferralCode() {
  return useQuery({ queryKey: ['referral-code'], queryFn: getReferralCode, retry: 1 });
}

export function useReferralStatus() {
  return useQuery({ queryKey: ['referral-status'], queryFn: getReferralStatus, retry: 1 });
}

export function useSendReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendReferralInvite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['referral-status'] }),
  });
}

// ── Payroll actions ───────────────────────────────────────────────────────────

export function useRunPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runPayroll,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  });
}

// ── GhQR generation ───────────────────────────────────────────────────────────

export function useGenerateGhQR() {
  return useMutation({
    mutationFn: (data: GHQRGenerateDto) => generateGhqr(data),
  });
}

// ── Notification preferences ──────────────────────────────────────────────────

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateNotificationPreferences,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications-workspace'] }),
  });
}

export function useRetryNotificationEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: retryNotificationEvent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications-workspace'] }),
  });
}

export function useMarkMerchantAlertRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markMerchantAlertRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant-alerts'] }),
  });
}

export function useDismissMerchantAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alertId, reason }: { alertId: string; reason: string }) =>
      dismissMerchantAlert(alertId, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant-alerts'] }),
  });
}

export function useRetryCustomerDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: retryCustomerDelivery,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer-deliveries'] }),
  });
}

// ── Tax mutations ─────────────────────────────────────────────────────────────

export function useGenerateTaxReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { year: number; month: number }) => generateTaxReturn(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tax-workspace'] }),
  });
}

export function useFileTaxReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (returnId: string) => fileTaxReturn(returnId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tax-workspace'] }),
  });
}

export function useRecordInputVAT() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recordInputVAT,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tax-workspace'] });
      qc.invalidateQueries({ queryKey: ['input-vat-list'] });
    },
  });
}

export function useTaxRates() {
  return useQuery({
    queryKey: ['tax-rates'],
    queryFn: getTaxRates,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useInputVATList() {
  return useQuery({
    queryKey: ['input-vat-list'],
    queryFn: listInputVAT,
    staleTime: 30_000,
    retry: 1,
  });
}

// ── Active lenders ────────────────────────────────────────────────────────────

export function useActiveLenders(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['credit', 'lenders'],
    queryFn: getActiveLenders,
    staleTime: 300_000,
  });
}

// ── Payroll employee management ───────────────────────────────────────────────

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createEmployee,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateEmployee>[1] }) =>
      updateEmployee(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  });
}

export function useRunPayslips(runId?: string | null) {
  return useQuery({
    enabled: !!runId,
    queryKey: ['payroll-run-payslips', runId],
    queryFn: () => getRunPayslips(runId!),
    retry: 1,
    staleTime: 60_000,
  });
}

export function usePayPayslip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payslipId: string) => payPayslip(payslipId),
    onSuccess: (_data, payslipId) => {
      // Invalidate all run payslip caches so the paid status refreshes
      qc.invalidateQueries({ queryKey: ['payroll-run-payslips'] });
      qc.invalidateQueries({ queryKey: ['payroll'] });
    },
  });
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export function useInventoryItems(params?: ItemListParams) {
  return useQuery({
    queryKey: ['inventory-items', params],
    queryFn: () => listItems(params),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useInventoryItem(itemId?: string | null) {
  return useQuery({
    enabled: !!itemId,
    queryKey: ['inventory-item', itemId],
    queryFn: () => getItem(itemId!),
    retry: 1,
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemCreateDto) => createItem(body),
    onSuccess: (item) => {
      trackEvent(MOBILE_ANALYTICS_EVENTS.FIRST_ITEM_ADDED, {
        itemId: String(item.id),
      });
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
    },
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: ItemUpdateDto }) => updateItem(itemId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
      qc.invalidateQueries({ queryKey: ['inventory-item'] });
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deleteItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items'] }),
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StockAdjustmentDto) => adjustStock(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items'] }),
  });
}

export function useInventoryCategories() {
  return useQuery({
    queryKey: ['inventory-categories'],
    queryFn: listCategories,
    staleTime: 300_000,
    retry: 1,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCategory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-categories'] }),
  });
}

// ── Suppliers ─────────────────────────────────────────────────────────────────

export function useSuppliers() {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: listSuppliers,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSupplierDto) => createSupplier(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CreateSupplierDto> }) =>
      updateSupplier(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSupplier(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ['purchase-orders'],
    queryFn: listPurchaseOrders,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePurchaseOrderDto) => createPurchaseOrder(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: string) => receivePurchaseOrder(poId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
    },
  });
}

export function useThresholdSuggestion() {
  return useMutation({
    mutationFn: (itemId: string) => getThresholdSuggestion(itemId),
  });
}

// ── Sales extras ──────────────────────────────────────────────────────────────

export function useRetrySalePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saleId: string) => retrySalePayment(saleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-history'] });
      qc.invalidateQueries({ queryKey: ['sales-daily-summary'] });
    },
  });
}

export function useVoidSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saleId: string) => voidSale(saleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-history'] });
      qc.invalidateQueries({ queryKey: ['sales-daily-summary'] });
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
      qc.invalidateQueries({ queryKey: ['analytics-summary'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function usePeriodSummary(params: { from_date: string; to_date: string }) {
  return useQuery({
    enabled: !!params.from_date && !!params.to_date,
    queryKey: ['sales-period-summary', params],
    queryFn: () => getPeriodSummary(params),
    staleTime: 60_000,
    retry: 1,
  });
}

// ── Payment extras ────────────────────────────────────────────────────────────

export function useGetPayment(paymentId?: string | null) {
  return useQuery({
    enabled: !!paymentId,
    queryKey: ['payment', paymentId],
    queryFn: () => getPayment(paymentId!),
    retry: 1,
  });
}

export function useRequestPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PaymentRequestDto) => requestPayment(body),
    onSuccess: (payment) => {
      trackEvent(MOBILE_ANALYTICS_EVENTS.PAYMENT_REQUESTED, {
        paymentId: String(payment.id),
        provider: payment.provider,
      });
      qc.invalidateQueries({ queryKey: ['payments-workspace'] });
    },
  });
}

export function useDisbursePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PaymentDisburseDto) => disbursePayment(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payments-workspace'] }),
  });
}

// ── Credit loan detail ────────────────────────────────────────────────────────

export function useLoan(loanId?: string | null) {
  return useQuery({
    enabled: !!loanId,
    queryKey: ['credit-loan', loanId],
    queryFn: () => getLoan(loanId!),
    retry: 1,
  });
}

export function useLoanSchedule(loanId?: string | null) {
  return useQuery({
    enabled: !!loanId,
    queryKey: ['credit-loan-schedule', loanId],
    queryFn: () => getLoanSchedule(loanId!),
    retry: 1,
  });
}

export function useConfirmLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ loanId, body }: { loanId: string; body: LoanConfirmDto }) => confirmLoan(loanId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit-requests'] }),
  });
}

export function useResendLoanConfirmation() {
  return useMutation({
    mutationFn: (loanId: string) => resendLoanConfirmation(loanId),
  });
}

// ── User profile ──────────────────────────────────────────────────────────────

export function useUpdateMe() {
  return useMutation({
    mutationFn: (body: UserUpdateDto) => updateMe(body),
  });
}

// ── Customers ─────────────────────────────────────────────────────────────────

export function useCustomers(search?: string) {
  return useQuery({
    queryKey: ['customers', search ?? ''],
    queryFn: () => listCustomers(search),
    staleTime: 60_000,
  });
}

export function useCustomer(customerId?: string | null) {
  return useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => getCustomer(customerId!),
    enabled: !!customerId,
  });
}

// ── Payroll disbursal ─────────────────────────────────────────────────────────

export function useDisbursePayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      apiClient.post(`/api/v1/payroll/runs/${runId}/disburse`, {}).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  });
}

export function useApprovePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => approvePayrollRun(runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  });
}

export function useDownloadP9A() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await downloadP9A();
      await Linking.openURL(url);
    },
  });
}

export function useDownloadP9B() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await downloadP9B();
      await Linking.openURL(url);
    },
  });
}

// ── Tax return export ─────────────────────────────────────────────────────────

export function useExportTaxReturn() {
  return useMutation({
    mutationFn: exportTaxReturn,
  });
}

// ── Agent payout ──────────────────────────────────────────────────────────────

export function useRequestAgentPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/api/v1/agents/commissions/bulk-payout', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-commissions'] }),
  });
}
