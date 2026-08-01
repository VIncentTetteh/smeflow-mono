'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface BusinessDetail {
  id: string;
  name: string;
  type: string;
  tin: string | null;
  address: string | null;
  subscription: string;
  sub_expires_at: string | null;
  is_active: boolean;
  owner_id: string;
  ghana_card_ref: string | null;
  region?: string | null;
  city?: string | null;
  market?: string | null;
  dva_account_number: string | null;
  dva_account_name: string | null;
  dva_bank_name: string | null;
}

export interface UserProfile {
  id: string;
  phone: string;
  email: string | null;
  google_linked: boolean;
  name: string | null;
  ghana_card_id: string | null;
  tin: string | null;
  kyc_status: string;
  is_active: boolean;
}

export function useBusiness() {
  return useQuery({
    queryKey: ['store', 'business'],
    queryFn: async () => (await apiClient.get<BusinessDetail>('/business/me')).data,
  });
}

export function useUpdateBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient.patch('/business/me', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store', 'business'] }),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['store', 'me'],
    queryFn: async () => (await apiClient.get<UserProfile>('/auth/me')).data,
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; ghana_card_id?: string; tin?: string }) =>
      apiClient.patch('/auth/me', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store', 'me'] }),
  });
}
