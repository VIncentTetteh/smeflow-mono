'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface MerchantAlert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  status: string;
  action_path: string | null;
  action_label: string | null;
  occurrence_count: number;
  read_at: string | null;
  created_at: string;
}

export interface AlertList {
  items: MerchantAlert[];
  unread_count: number;
}

export interface NotificationPreferences {
  id: string;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  event_prefs: Record<string, boolean>;
}

const N = ['store', 'notifications'] as const;

export function useAlerts(view: 'attention' | 'history' = 'attention') {
  return useQuery({
    queryKey: [...N, 'alerts', view],
    queryFn: async () => {
      const res = await apiClient.get<AlertList>('/notifications/alerts', { params: { view } });
      return res.data;
    },
    refetchInterval: 60_000,
  });
}

export function useMarkAlertRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/notifications/alerts/${id}/read`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...N, 'alerts'] }),
  });
}

export function useDismissAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/notifications/alerts/${id}/dismiss`, { reason }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...N, 'alerts'] }),
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: [...N, 'preferences'],
    queryFn: async () =>
      (await apiClient.get<NotificationPreferences>('/notifications/preferences')).data,
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { whatsapp_enabled?: boolean; sms_enabled?: boolean; push_enabled?: boolean }) =>
      apiClient.put('/notifications/preferences', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...N, 'preferences'] }),
  });
}
