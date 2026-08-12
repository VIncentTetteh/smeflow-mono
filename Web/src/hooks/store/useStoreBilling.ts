'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface PlanInfo {
  name: string;
  price: string;
  annual_price_ghs: string;
  features: string[];
  billing_intervals: string[];
  support_sla: string | null;
}

export interface Subscription {
  id: string;
  business_id: string;
  plan: string;
  billing_interval: string;
  status: string;
  cancel_at_period_end: boolean;
  momo_phone: string | null;
  current_period_end: string | null;
}

export interface BillingTransaction {
  id: string;
  amount: string;
  currency: string;
  status: string;
  payment_method: string | null;
  description: string | null;
  paid_at: string | null;
  created_at: string;
}

const B = ['store', 'billing'] as const;

export function usePlans() {
  return useQuery({
    queryKey: [...B, 'plans'],
    queryFn: async () => (await apiClient.get<PlanInfo[]>('/billing/plans')).data,
    staleTime: 30 * 60_000,
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: [...B, 'subscription'],
    queryFn: async () => (await apiClient.get<Subscription>('/billing/subscription')).data,
  });
}

export function useBillingTransactions() {
  return useQuery({
    queryKey: [...B, 'transactions'],
    queryFn: async () => {
      const res = await apiClient.get<{ total: number; items: BillingTransaction[] }>(
        '/billing/transactions'
      );
      return res.data;
    },
  });
}

/** Owner-only. Downgrade to free / change plan. Paid upgrades go through /subscribe (payment_url). */
export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { plan: string; billing_interval?: string; momo_phone?: string }) =>
      apiClient.post('/billing/subscription/change', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...B] });
      qc.invalidateQueries({ queryKey: ['store', 'plan'] });
    },
  });
}

export function useSubscribe() {
  return useMutation({
    mutationFn: (body: { plan: string; billing_interval?: string; momo_phone?: string }) =>
      apiClient.post('/billing/subscribe', body).then((r) => r.data as { payment_url?: string }),
  });
}

export interface VerifySubscriptionResult {
  activated: boolean;
  plan?: string;
  billing_interval?: string;
  status?: string;
  paystack_status?: string;
}

/** Called after returning from the Paystack checkout redirect — verifies and
 * activates the pending subscription directly, without depending on the
 * webhook having already fired. Idempotent, safe to call repeatedly. */
export function useVerifySubscription() {
  return useMutation({
    mutationFn: (providerRef: string) =>
      apiClient
        .post('/billing/subscribe/verify', { provider_ref: providerRef })
        .then((r) => r.data as VerifySubscriptionResult),
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/billing/subscription/cancel').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...B, 'subscription'] }),
  });
}
