import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

type Period = 'day' | 'week' | 'month';

export function useAgentCommissionSummary(period: Period = 'month') {
  return useQuery({
    queryKey: ['agent', 'commission-summary', period],
    queryFn: async () => {
      const res = await apiClient.get('/agents/commissions/summary', {
        params: { period },
      });
      return res.data as {
        onboarded: number;
        earned: number;
        pending: number;
        period: string;
      };
    },
  });
}

export function useAgentTradersList() {
  return useQuery({
    queryKey: ['agent', 'traders'],
    queryFn: async () => {
      const res = await apiClient.get('/agents/traders');
      return res.data as Array<{
        id: string;
        business_id: string;
        business_name: string | null;
        kyc_status: string;
        onboarded_at: string | null;
        status: string;
      }>;
    },
  });
}

export function useOnboardingMutations() {
  const qc = useQueryClient();
  const startOnboarding = useMutation({
    mutationFn: (d: { phone: string }) =>
      apiClient.post('/agents/onboarding/start', d).then((r) => r.data as { user_id: string }),
  });
  const createBusiness = useMutation({
    mutationFn: (d: { user_id: string; business_name: string; category: string; region: string }) =>
      apiClient.post('/agents/onboarding/business', d).then((r) => r.data as { id: string }),
  });
  const submitKyc = useMutation({
    mutationFn: ({ businessId, ...body }: { businessId: string; ghana_card_id: string; tin?: string }) =>
      apiClient.post(`/agents/onboarding/business/${businessId}/kyc`, body).then((r) => r.data),
  });
  const addWallet = useMutation({
    mutationFn: ({ businessId, ...body }: { businessId: string; provider: string; phone: string }) =>
      apiClient.post(`/agents/onboarding/business/${businessId}/wallet`, body).then((r) => r.data),
  });
  const completeOnboarding = useMutation({
    mutationFn: (businessId: string) =>
      apiClient.post(`/agents/onboarding/business/${businessId}/complete`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', 'traders'] }),
  });
  return { startOnboarding, createBusiness, submitKyc, addWallet, completeOnboarding };
}

export function useAgentCommissions() {
  return useQuery({
    queryKey: ['agent', 'commissions'],
    queryFn: async () => {
      const res = await apiClient.get('/agents/wallet/commissions', {
        params: { limit: 50 },
      });
      const data = res.data as {
        total: number;
        items: Array<{
          id: string;
          business_id: string;
          trigger: string;
          amount?: number | string;
          amount_ghs?: number | string;
          status: string;
          paid_at: string | null;
          paid_via?: string | null;
          available_at?: string | null;
          created_at: string;
        }>;
      };
      return (data.items ?? []).map((c) => ({
        id: c.id,
        event_type: c.trigger,
        amount: Number(c.amount_ghs ?? c.amount ?? 0),
        business_name: null as string | null,
        business_id: c.business_id,
        created_at: c.created_at,
        available_at: c.available_at,
        paid_at: c.paid_at,
        paid_via: c.paid_via,
        status: c.status,
        paid: c.status === 'paid',
      }));
    },
  });
}

export function useAgentWallet() {
  return useQuery({
    queryKey: ['agent', 'wallet'],
    queryFn: async () => {
      const res = await apiClient.get('/agents/wallet');
      return res.data as {
        agent_id: string;
        pending_balance: number | string;
        available_balance: number | string;
        total_paid_out: number | string;
        total_commission_earned: number | string;
        last_payout_at?: string | null;
        next_payout_date?: string | null;
        payout_threshold: number | string;
        eligible_for_payout: boolean;
      };
    },
  });
}

export function useAgentPayoutHistory() {
  return useQuery({
    queryKey: ['agent', 'payout-history'],
    queryFn: async () => {
      const res = await apiClient.get('/agents/wallet/history', { params: { limit: 25 } });
      const data = res.data as {
        items: Array<{
          batch_id: string;
          amount_ghs: number | string;
          transfer_code?: string | null;
          status: string;
          payout_date: string;
          completed_at?: string | null;
        }>;
      };
      return data.items ?? [];
    },
  });
}

export function useBulkCommissionPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commission_ids: string[]) =>
      apiClient
        .post('/agents/commissions/bulk-payout', { commission_ids, payout_method: 'momo' })
        .then((r) => r.data as { updated: number; total_amount: number }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', 'commissions'] });
      qc.invalidateQueries({ queryKey: ['agent', 'wallet'] });
      qc.invalidateQueries({ queryKey: ['agent', 'payout-history'] });
      qc.invalidateQueries({ queryKey: ['agent', 'commission-summary'] });
    },
  });
}
