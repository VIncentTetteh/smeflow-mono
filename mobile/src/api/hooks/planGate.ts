import { useBillingWorkspace } from '@/api/hooks/featureHooks';
import type { BillingLimitsDto, BillingUsageDto } from '@/types/billing';

export type FeatureKey =
  | 'analytics_basic'
  | 'analytics_full'
  | 'credit_scoring'
  | 'tax_summary'
  | 'gra_submission'
  | 'payroll'
  | 'invoices'
  | 'invoice_pdf'
  | 'team'
  | 'customers'
  | 'assistant'
  | 'add_business'
  | 'bulk_momo_payout'
  | 'cost_margin'
  | 'export'
  | 'recurring_invoices';

export type PlanTier = 'starter' | 'pro';

interface GateConfig {
  requiredPlan: PlanTier;
  check: (limits: BillingLimitsDto, usage?: BillingUsageDto) => boolean;
}

/**
 * Returns true when the limit value indicates the feature is accessible:
 * - null means unlimited (allowed)
 * - a positive number means capacity exists (allowed)
 * - 0, undefined, or false-y numeric means no capacity (blocked)
 */
function numericAllowed(limit: number | null | undefined): boolean {
  return limit === null || (limit != null && limit > 0);
}

const FEATURE_GATES: Record<FeatureKey, GateConfig> = {
  analytics_basic: {
    requiredPlan: 'starter',
    check: (l) => l.analytics != null && l.analytics !== false,
  },
  analytics_full: {
    requiredPlan: 'pro',
    check: (l) => l.analytics === 'full',
  },
  credit_scoring: {
    requiredPlan: 'pro',
    check: (l) => l.credit_scoring === true,
  },
  tax_summary: {
    requiredPlan: 'starter',
    check: (l) => l.tax_summary === true,
  },
  gra_submission: {
    requiredPlan: 'pro',
    check: (l) => l.gra_submission === true,
  },
  payroll: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.employees),
  },
  invoices: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.invoices),
  },
  invoice_pdf: {
    requiredPlan: 'starter',
    check: (l) => l.invoice_pdf === true,
  },
  team: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.team_members),
  },
  customers: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.customers),
  },
  assistant: {
    requiredPlan: 'starter',
    check: (l) => numericAllowed(l.ai_messages),
  },
  add_business: {
    requiredPlan: 'starter',
    // Allowed when limit is null (unlimited) OR current usage is strictly below the limit.
    check: (l, u) =>
      l.businesses === null ||
      (l.businesses != null && (u?.businesses ?? 0) < l.businesses),
  },
  bulk_momo_payout: {
    requiredPlan: 'pro',
    check: (l) => l.bulk_momo_payout === true,
  },
  cost_margin: {
    requiredPlan: 'pro',
    check: (l) => l.cost_margin_tracking === true,
  },
  export: {
    requiredPlan: 'pro',
    check: (l) => l.export === true,
  },
  recurring_invoices: {
    requiredPlan: 'pro',
    check: (l) => l.recurring_invoices === true,
  },
};

export interface PlanGateResult {
  /** Whether the current subscription allows access to this feature. */
  allowed: boolean;
  /** The minimum plan tier that unlocks this feature. */
  requiredPlan: PlanTier;
  /** True while billing data is still being fetched. */
  loading: boolean;
}

/**
 * Gates UI features behind subscription plan limits.
 *
 * Fail-open by design: returns `allowed: true` while loading or on network
 * errors so users are never incorrectly blocked due to a transient fetch
 * failure.
 */
export function usePlanGate(feature: FeatureKey): PlanGateResult {
  const billing = useBillingWorkspace();
  const config = FEATURE_GATES[feature];

  if (billing.isLoading) {
    return { allowed: true, requiredPlan: config.requiredPlan, loading: true };
  }

  if (billing.isError || !billing.data?.planUsage?.limits) {
    return { allowed: true, requiredPlan: config.requiredPlan, loading: false };
  }

  const limits = billing.data.planUsage.limits;
  const usage = billing.data.planUsage.usage;

  return {
    allowed: config.check(limits, usage),
    requiredPlan: config.requiredPlan,
    loading: false,
  };
}
