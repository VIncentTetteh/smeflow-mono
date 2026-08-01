'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface PlanUsage {
  subscription: { plan: string; status: string; billing_interval?: string };
  plan: string;
  billing_interval: string;
  status: string;
  usage: Record<string, number>;
  limits: Record<string, number | string | boolean | string[] | null>;
}

export function usePlan() {
  return useQuery({
    queryKey: ['store', 'plan'],
    queryFn: async () => {
      const res = await apiClient.get<PlanUsage>('/billing/plan');
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

export type PlanFeature =
  | 'storefront'
  | 'analytics'
  | 'credit_scoring'
  | 'tax_summary'
  | 'gra_submission'
  | 'invoice_pdf'
  | 'export'
  | 'bulk_csv_import'
  | 'bulk_momo_payout'
  | 'recurring_invoices'
  | 'cost_margin_tracking'
  | 'business_insights';

/**
 * UX-only feature gate. FAIL-OPEN: while loading or on error we allow the
 * feature — the backend is the authoritative gate (RequireFeature), so a
 * client false-negative would only hurt UX. Pages show a soft upsell when
 * `enabled` is false but never hard-block.
 */
export function usePlanGate(feature: PlanFeature): {
  enabled: boolean;
  loading: boolean;
  plan?: string;
} {
  const { data, isLoading, isError } = usePlan();
  if (isLoading || isError || !data) {
    return { enabled: true, loading: isLoading };
  }
  const value = data.limits[feature];
  // Strings like "basic"/"full" are truthy features; false/null/0 are off.
  const enabled = value !== false && value !== null && value !== 0 && value !== undefined;
  return { enabled, loading: false, plan: data.plan };
}
