import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import {
  fetchAdminBusinessDetail,
  fetchAdminBusinesses,
  fetchAdminKpis,
  fetchAdminLoans,
  getApiErrorMessage,
} from '@/lib/adminApi';

export function useAdminKpis() {
  return useQuery({
    queryKey: ['admin', 'kpis'],
    queryFn: fetchAdminKpis,
    refetchInterval: 60_000,
  });
}

export function useAdminBusinesses(page = 1, search = '') {
  return useQuery({
    queryKey: ['admin', 'businesses', page, search],
    queryFn: async () => {
      return fetchAdminBusinesses(page, search);
    },
  });
}

export function useUpdateBusinessSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ businessId, tier, totp_code }: { businessId: string; tier: string; totp_code?: string }) => {
      const res = await apiClient.patch(
        `/admin/businesses/${businessId}/subscription`,
        { tier },
        { headers: totp_code ? { 'X-Admin-TOTP': totp_code } : undefined }
      );
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'businesses'] }),
  });
}

export function useAdminAgentHealth() {
  return useQuery({
    queryKey: ['admin', 'agent-health'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/agents/health');
      return res.data as {
        total_active: number;
        new_onboardings_today: number;
        regions_covered: number;
        commission_due_ghs: number;
        top_agent: { name: string; code: string; onboarded: number };
        region_breakdown: Array<{ region: string; agents: number }>;
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useAdminBusinessDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'business', id],
    queryFn: async () => {
      return fetchAdminBusinessDetail(id);
    },
    enabled: !!id,
  });
}

export function useDisableBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active, totp_code }: { id: string; active: boolean; totp_code?: string }) => {
      const action = active ? 'unsuspend' : 'suspend';
      const res = await apiClient.post(
        `/admin/businesses/${id}/${action}`,
        {},
        { headers: totp_code ? { 'X-Admin-TOTP': totp_code } : undefined }
      );
      return res.data;
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin', 'businesses'] });
      qc.invalidateQueries({ queryKey: ['admin', 'business', id] });
    },
  });
}

export function useAdminLoanAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      loanId,
      action,
      reason,
      totp_code,
    }: {
      loanId: string;
      action: 'approve' | 'reject' | 'flag';
      reason?: string;
      totp_code?: string;
    }) => {
      const res = await apiClient.post(
        `/admin/loans/${loanId}/action`,
        { action, reason },
        { headers: totp_code ? { 'X-Admin-TOTP': totp_code } : undefined }
      );
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'loans'] }),
  });
}

export function useAdminLoans(status?: string, page = 1) {
  return useQuery({
    queryKey: ['admin', 'loans', status ?? 'all', page],
    queryFn: async () => {
      return fetchAdminLoans(status, page);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export { getApiErrorMessage };
