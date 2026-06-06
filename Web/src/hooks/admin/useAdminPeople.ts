import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/adminApi';

export type AdminAgent = {
  id: string;
  user_id: string;
  name: string | null;
  phone: string | null;
  region: string | null;
  district: string | null;
  is_active: boolean;
  onboarded_count: number;
  total_commission_earned: string;
  created_at: string;
};

export function useAdminAgents(page = 1, search = '') {
  const limit = 20;
  return useQuery({
    queryKey: ['admin', 'agents', page, search],
    queryFn: async () => {
      const res = await apiClient.get('/admin/agents', {
        params: { limit, offset: (page - 1) * limit, search: search || undefined },
      });
      // Backend returns { total, limit, offset, items: [...] }
      const data = res.data as {
        total: number;
        limit: number;
        offset: number;
        items: AdminAgent[];
      };
      return { total: data.total ?? 0, limit: data.limit ?? limit, offset: data.offset ?? 0, items: data.items ?? [] };
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; phone: string; region: string; totp_code?: string }) => {
      const { totp_code, ...body } = data;
      const res = await apiClient.post('/admin/agents', body, {
        headers: totp_code ? { 'X-Admin-TOTP': totp_code } : undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Agent created');
      qc.invalidateQueries({ queryKey: ['admin', 'agents'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to create agent')),
  });
}

export function useAdminLenders() {
  return useQuery({
    queryKey: ['admin', 'lenders'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/lenders');
      return res.data as {
        items: Array<{
          id: string;
          lender_id: string;
          name: string;
          contact_email: string | null;
          is_active: boolean;
          paystack_subaccount_code?: string | null;
          paystack_split_code?: string | null;
          platform_fee_percent?: number | null;
          settlement_ready?: boolean;
          created_at: string;
        }>;
        total: number;
      };
    },
  });
}

export function useCreateLender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      lender_id: string;
      name: string;
      contact_email: string;
      totp_code?: string;
    }) => {
      const { totp_code, ...body } = data;
      const res = await apiClient.post('/admin/lenders', body, {
        headers: totp_code ? { 'X-Admin-TOTP': totp_code } : undefined,
      });
      return res.data as {
        id: string;
        lender_id: string;
        name: string;
        portal_email: string;
        api_key: string;
        temporary_password: string;
      };
    },
    onSuccess: () => {
      toast.success('Lender created');
      qc.invalidateQueries({ queryKey: ['admin', 'lenders'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to create lender')),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      name,
      phone,
      region,
      district,
    }: {
      id: string;
      name?: string;
      phone?: string;
      region?: string;
      district?: string;
    }) => {
      const body: Record<string, string> = {};
      if (name) body.name = name;
      if (phone) body.phone = phone;
      if (region) body.region = region;
      if (district) body.district = district;
      const res = await apiClient.patch(`/admin/agents/${id}`, body);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'agents'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update agent')),
  });
}

export function useSetAgentActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiClient.patch(`/admin/agents/${id}`, { is_active: active });
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'agents'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update agent status')),
  });
}

export const useDeactivateAgent = useSetAgentActive;

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/agents/${id}`);
    },
    onSuccess: () => {
      toast.success('Agent deleted');
      qc.invalidateQueries({ queryKey: ['admin', 'agents'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Cannot delete agent. They may have existing history.')),
  });
}

export function useToggleLenderActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lenderId,
      active,
      totp_code,
    }: {
      lenderId: string;
      active: boolean;
      totp_code?: string;
    }) => {
      const res = await apiClient.patch(
        `/admin/lenders/${lenderId}`,
        { is_active: active },
        { headers: totp_code ? { 'X-Admin-TOTP': totp_code } : undefined }
      );
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'lenders'] }),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update lender')),
  });
}

export function useAgentCommissions(agentId: string) {
  return useQuery({
    queryKey: ['admin', 'agent-commissions', agentId],
    queryFn: async () => {
      const res = await apiClient.get(`/admin/agents/${agentId}/commissions`);
      const data = res.data as {
        total: number;
        items: Array<{
          id: string;
          event_type: string;
          amount: number;
          business_id: string;
          business_name: string | null;
          created_at: string;
          paid: boolean;
        }>;
      };
      return data.items ?? [];
    },
    enabled: !!agentId,
  });
}

export function useMarkCommissionPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      agentId,
      commissionId,
    }: {
      agentId: string;
      commissionId: string;
    }) => {
      const res = await apiClient.put(
        `/admin/agents/${agentId}/commissions/${commissionId}/mark-paid`
      );
      return res.data;
    },
    onSuccess: (_data, { agentId }) => {
      toast.success('Commission marked as paid');
      qc.invalidateQueries({ queryKey: ['admin', 'agent-commissions', agentId] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to mark commission paid')),
  });
}

export function useCommissionRates() {
  return useQuery({
    queryKey: ['admin', 'commission-rates'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/commission-rates');
      return res.data as Array<{
        event_type: string;
        rate: string;
        updated_at: string | null;
        updated_by: string | null;
      }>;
    },
  });
}

export function useUpdateCommissionRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ event_type, rate }: { event_type: string; rate: number }) => {
      const res = await apiClient.put('/admin/commission-rates', { event_type, rate });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Commission rate updated');
      qc.invalidateQueries({ queryKey: ['admin', 'commission-rates'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update commission rate')),
  });
}
