'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface StorefrontSettings {
  enabled: boolean;
  slug: string | null;
  tagline: string | null;
  whatsapp: string | null;
  url_path: string | null;
}

const KEY = ['store', 'storefront'] as const;

export function useStorefrontSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await apiClient.get<StorefrontSettings>('/business/storefront')).data,
  });
}

export function useUpdateStorefront() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<StorefrontSettings, 'enabled' | 'slug' | 'tagline' | 'whatsapp'>>) =>
      apiClient.patch<StorefrontSettings>('/business/storefront', body).then((r) => r.data),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}

export async function checkSlug(slug: string): Promise<{ slug: string; available: boolean; reason?: string }> {
  const res = await apiClient.get('/business/storefront/slug-check', { params: { slug } });
  return res.data;
}
