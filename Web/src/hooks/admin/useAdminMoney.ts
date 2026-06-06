import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/adminApi';

export type AdminSettlement = {
  id: string;
  business_id: string;
  business_name: string;
  amount: string;
  fee_amount: string;
  net_amount: string;
  status: string;
  mode: string;
  destination_phone?: string | null;
  destination_provider?: string | null;
  paystack_transfer_code?: string | null;
  failure_reason?: string | null;
  requested_at: string;
  approved_at?: string | null;
  completed_at?: string | null;
};

export function useAdminSettlementSummary() {
  return useQuery({
    queryKey: ['admin', 'settlements', 'summary'],
    queryFn: async () => (await apiClient.get('/admin/settlements/summary')).data as {
      total_unsettled_liability_ghs: string;
      merchants_settlement_paused_count: number;
      pending_approval_count: number;
      pending_approval_amount_ghs: string;
      in_flight_count: number;
      in_flight_amount_ghs: string;
      today_completed_count: number;
      today_completed_volume_ghs: string;
      today_failed_count: number;
      today_failed_amount_ghs: string;
      today_platform_fees_collected_ghs: string;
      today_settlements_by_mode: Record<string, number>;
      config: Record<string, string>;
      as_of: string;
    },
    refetchInterval: 60_000,
  });
}

export function useAdminSettlements(status?: string) {
  return useQuery({
    queryKey: ['admin', 'settlements', status ?? 'all'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/settlements', {
        params: { status: status || undefined, limit: 100 },
      });
      return res.data as { total: number; items: AdminSettlement[] };
    },
    refetchInterval: 60_000,
  });
}

function invalidateSettlementQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin', 'settlements'] });
  qc.invalidateQueries({ queryKey: ['admin', 'merchant-settlement'] });
}

export function useApproveSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settlementId: string) =>
      (await apiClient.post(`/admin/settlements/${settlementId}/approve`)).data,
    onSuccess: () => {
      toast.success('Settlement approved');
      invalidateSettlementQueries(qc);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to approve settlement')),
  });
}

export function useBulkApproveSettlements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settlementIds: string[]) =>
      (await apiClient.post('/admin/settlements/bulk-approve', { settlement_ids: settlementIds })).data as {
        approved: Array<{ settlement_id: string; status: string; net_amount: string }>;
        failed: Array<{ settlement_id: string; error: string }>;
      },
    onSuccess: (data) => {
      toast.success(`${data.approved.length} settlements approved${data.failed.length ? `, ${data.failed.length} failed` : ''}`);
      invalidateSettlementQueries(qc);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to approve settlements')),
  });
}

export function useCancelAdminSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ settlementId, reason }: { settlementId: string; reason: string }) =>
      (await apiClient.post(`/admin/settlements/${settlementId}/cancel`, { reason })).data,
    onSuccess: () => {
      toast.success('Settlement cancelled');
      invalidateSettlementQueries(qc);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to cancel settlement')),
  });
}

export function useRetryMerchantSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settlementId: string) =>
      (await apiClient.post(`/admin/settlements/${settlementId}/retry`)).data,
    onSuccess: () => {
      toast.success('Settlement retry queued');
      invalidateSettlementQueries(qc);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to retry settlement')),
  });
}

export function useTriggerAutoSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post('/admin/settlements/trigger')).data,
    onSuccess: () => {
      toast.success('Auto-settlement queued');
      invalidateSettlementQueries(qc);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to queue auto-settlement')),
  });
}

export function useAdminMerchantSettlementBalance(businessId?: string | null) {
  return useQuery({
    enabled: !!businessId,
    queryKey: ['admin', 'merchant-settlement', businessId],
    queryFn: async () => (await apiClient.get(`/admin/settlements/merchants/${businessId}/balance`)).data as {
      business_id: string;
      unsettled_balance: string;
      total_settled: string;
      settlement_threshold: string;
      settlement_enabled: boolean;
      pending_settlement_count: number;
      recent_ledger: Array<{
        id: string;
        type: string;
        amount: string;
        balance_after: string;
        description?: string | null;
        created_at: string;
      }>;
    },
  });
}

export function useForceMerchantSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ businessId, amount }: { businessId: string; amount: string }) =>
      (await apiClient.post(`/admin/settlements/merchants/${businessId}/settle`, { amount })).data,
    onSuccess: () => {
      toast.success('Merchant settlement started');
      invalidateSettlementQueries(qc);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to force settlement')),
  });
}

export function useUpdateMerchantSettlementConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      businessId,
      settlement_enabled,
      settlement_threshold,
    }: {
      businessId: string;
      settlement_enabled?: boolean;
      settlement_threshold?: string;
    }) =>
      (await apiClient.patch(`/admin/settlements/merchants/${businessId}/settlement-config`, {
        settlement_enabled,
        settlement_threshold,
      })).data,
    onSuccess: () => {
      toast.success('Settlement config updated');
      invalidateSettlementQueries(qc);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update settlement config')),
  });
}

export function useAdminPayoutBalance() {
  return useQuery({
    queryKey: ['admin', 'payouts', 'balance'],
    queryFn: async () => (await apiClient.get('/admin/payouts/balance')).data as {
      paystack_balances: Array<{ currency: string; balance: number }>;
      pending_payout_liability_ghs: string;
    },
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useAdminAgentPayoutSummary() {
  return useQuery({
    queryKey: ['admin', 'payouts', 'agents-summary'],
    queryFn: async () => (await apiClient.get('/admin/payouts/agents/summary')).data as {
      total_active_agents: number;
      total_pending_balance_ghs: string;
      total_available_balance_ghs: string;
      total_paid_out_ghs: string;
      agents_eligible_for_payout: number;
    },
    refetchInterval: 60_000,
  });
}

export function useAdminPayoutBatches() {
  return useQuery({
    queryKey: ['admin', 'payouts', 'batches'],
    queryFn: async () => (await apiClient.get('/admin/payouts/batches', { params: { limit: 50 } })).data as {
      total: number;
      items: Array<{
        id: string;
        status: string;
        total_amount_ghs: string;
        agent_count: number;
        transfer_count: number;
        paystack_batch_ref?: string | null;
        created_at: string;
        completed_at?: string | null;
        initiated_by?: string | null;
        results?: Record<string, unknown>;
      }>;
    },
    refetchInterval: 60_000,
  });
}

export function usePendingLoanDisbursements() {
  return useQuery({
    queryKey: ['admin', 'payouts', 'loans-pending'],
    queryFn: async () => (await apiClient.get('/admin/payouts/loans/pending', { params: { limit: 50 } })).data as {
      total: number;
      items: Array<{
        loan_id: string;
        business_id: string;
        lender_id?: string | null;
        amount_approved_ghs: string;
        disbursement_phone?: string | null;
        disbursement_transfer_code?: string | null;
        status: string;
        confirmed_at?: string | null;
      }>;
    },
    refetchInterval: 60_000,
  });
}

export function useTriggerAgentPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post('/admin/payouts/agents/trigger')).data,
    onSuccess: () => {
      toast.success('Agent payout queued');
      qc.invalidateQueries({ queryKey: ['admin', 'payouts'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to queue agent payout')),
  });
}

export function useDisburseLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loanId: string) =>
      (await apiClient.post(`/admin/payouts/loans/${loanId}/disburse`)).data,
    onSuccess: () => {
      toast.success('Loan disbursement started');
      qc.invalidateQueries({ queryKey: ['admin', 'payouts'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to disburse loan')),
  });
}

export function useRetryLoanDisbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loanId: string) =>
      (await apiClient.post(`/admin/payouts/loans/${loanId}/disburse/retry`)).data,
    onSuccess: () => {
      toast.success('Loan retry queued');
      qc.invalidateQueries({ queryKey: ['admin', 'payouts'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to retry loan')),
  });
}

export type AdminLenderRevenue = {
  id: string;
  loan_request_id: string;
  business_id: string;
  lender_id: string;
  principal_amount: number;
  fee_rate_percent: number;
  fee_amount: number;
  status: string;
  provider_ref: string | null;
  earned_at: string;
  paid_at: string | null;
};

export function useAdminLenderRevenue(status?: string, lenderId?: string) {
  return useQuery({
    queryKey: ['admin', 'lender-revenue', status ?? 'all', lenderId ?? 'all'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/lender-revenue', {
        params: { status: status || undefined, lender_id: lenderId || undefined, limit: 100 },
      });
      return res.data as { total: number; items: AdminLenderRevenue[] };
    },
    refetchInterval: 60_000,
  });
}

export function useAdminLenderRevenueSummary(lenderId?: string) {
  return useQuery({
    queryKey: ['admin', 'lender-revenue', 'summary', lenderId ?? 'all'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/lender-revenue/summary', {
        params: { lender_id: lenderId || undefined },
      });
      return res.data as {
        totals: {
          earned_amount: number;
          paid_amount: number;
          reversed_amount: number;
        };
        by_lender: Record<string, {
          earned_amount: number;
          paid_amount: number;
          reversed_amount: number;
          count: number;
        }>;
      };
    },
    refetchInterval: 60_000,
  });
}

export function useMarkLenderRevenuePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (revenueId: string) =>
      (await apiClient.post(`/admin/lender-revenue/${revenueId}/mark-paid`)).data,
    onSuccess: () => {
      toast.success('Revenue marked reconciled');
      qc.invalidateQueries({ queryKey: ['admin', 'lender-revenue'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to mark revenue paid')),
  });
}

export function useSetupLenderSubaccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lenderId,
      settlement_bank_code,
      settlement_account_number,
      platform_fee_percent,
    }: {
      lenderId: string;
      settlement_bank_code: string;
      settlement_account_number: string;
      platform_fee_percent: string;
    }) =>
      (await apiClient.post(`/admin/payouts/lenders/${lenderId}/setup-subaccount`, {
        settlement_bank_code,
        settlement_account_number,
        platform_fee_percent,
      })).data,
    onSuccess: () => {
      toast.success('Lender split setup complete');
      qc.invalidateQueries({ queryKey: ['admin', 'lenders'] });
      qc.invalidateQueries({ queryKey: ['admin', 'lender-revenue'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to setup lender split')),
  });
}
