'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface Member {
  id: string;
  user_id: string;
  role: 'owner' | 'manager' | 'staff';
  is_active: boolean;
  joined_at: string;
  user_name: string | null;
  user_phone: string | null;
}

const TEAM = ['store', 'team'] as const;

export function useMembers() {
  return useQuery({
    queryKey: [...TEAM],
    queryFn: async () => (await apiClient.get<Member[]>('/business/members')).data,
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone: string; role: 'staff' | 'manager' }) =>
      apiClient.post('/business/members/invite', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...TEAM] }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: string; is_active?: boolean } }) =>
      apiClient.patch(`/business/members/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...TEAM] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/business/members/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...TEAM] }),
  });
}
