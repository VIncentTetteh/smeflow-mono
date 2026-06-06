import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import { fetchAdminAuditLogs, fetchFraudSignals, getApiErrorMessage } from '@/lib/adminApi';

type KycQueueItem = {
  id: string;
  scope?: 'business' | 'user';
  business_name: string;
  subject_name?: string;
  submitted_at: string;
  document_count: number | null;
  documents?: Record<string, string>;
  status: string;
  ghana_card_id: string | null;
  tin: string | null;
  business_id: string | null;
  user_id?: string;
};

export function useKycQueue() {
  return useQuery({
    queryKey: ['admin', 'kyc-queue'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/kyc/queue');
      if (Array.isArray(res.data)) return res.data as KycQueueItem[];
      return (res.data?.items ?? []) as KycQueueItem[];
    },
    refetchInterval: 30_000,
  });
}

export function useReviewKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      businessId,
      approved,
      reason,
      scope = 'business',
      userId,
      totp_code,
    }: {
      businessId: string | null;
      approved: boolean;
      reason?: string;
      scope?: 'business' | 'user';
      userId?: string;
      totp_code?: string;
    }) => {
      const path = scope === 'user'
        ? `/admin/kyc/users/${userId}/review`
        : `/admin/kyc/${businessId}/review`;
      const res = await apiClient.post(
        path,
        {
          approved,
          failure_reason: reason ?? null,
        },
        { headers: totp_code ? { 'X-Admin-TOTP': totp_code } : undefined }
      );
      return res.data;
    },
    onSuccess: (_data, { approved }) => {
      toast.success(approved ? 'KYC approved' : 'KYC rejected');
      qc.invalidateQueries({ queryKey: ['admin', 'kyc-queue'] });
      qc.invalidateQueries({ queryKey: ['admin', 'kpis'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'KYC review failed. Please try again.')),
  });
}

export function useAuditLogs(page = 1, action?: string) {
  return useQuery({
    queryKey: ['admin', 'audit-logs', page, action ?? 'all'],
    queryFn: () => fetchAdminAuditLogs(page, action),
  });
}

export function useSyncQueue() {
  return useQuery({
    queryKey: ['admin', 'sync-queue'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/sync/queue');
      return res.data as Array<{
        id: string;
        business_name: string;
        sales_count: number;
        total_amount: number;
        queued_at: string;
        status: string;
      }>;
    },
    refetchInterval: 15_000,
    retry: 1,
  });
}

export function useAdminFraudQueue() {
  return useQuery({
    queryKey: ['admin', 'fraud-queue'],
    queryFn: fetchFraudSignals,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useMomoSettlements() {
  return useQuery({
    queryKey: ['admin', 'momo-settlements'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/payments/settlements');
      return res.data as Array<{
        ref: string;
        provider: string;
        amount: number;
        businesses: number;
        status: string;
        settled_at: string;
      }>;
    },
    refetchInterval: 60_000,
    retry: 1,
  });
}
