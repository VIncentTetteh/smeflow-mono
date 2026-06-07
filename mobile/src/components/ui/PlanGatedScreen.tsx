import type { ReactNode } from 'react';
import { usePlanGate } from '@/api/hooks/planGate';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import type { FeatureKey } from '@/api/hooks/planGate';

const FEATURE_NAMES: Record<FeatureKey, string> = {
  analytics_basic: 'Analytics',
  analytics_full: 'Finance Analytics',
  credit_scoring: 'Credit Scoring',
  tax_summary: 'Tax & Compliance',
  gra_submission: 'GRA Submission',
  payroll: 'Payroll',
  invoices: 'Invoices',
  invoice_pdf: 'Invoice PDF',
  team: 'Team & Roles',
  customers: 'Customers',
  assistant: 'AI Assistant',
  add_business: 'Multi-Business',
  bulk_momo_payout: 'Reconciliation',
  cost_margin: 'Cost & Margin',
  export: 'Export',
  recurring_invoices: 'Recurring Invoices',
};

const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
  analytics_basic: 'Starter unlocks revenue trends, payment mix, and seller performance for this business.',
  analytics_full: 'Pro unlocks profit and loss, cash flow, and deeper financial analysis.',
  credit_scoring: 'Pro unlocks credit scoring and loan access for your business.',
  tax_summary: 'Starter unlocks your monthly tax summary, VAT tracking, and GRA return generation.',
  gra_submission: 'Pro unlocks GRA e-filing and tax return submission.',
  payroll: 'Starter unlocks payroll runs, employee management, and P9 tax certificates.',
  invoices: 'Starter unlocks invoice generation, PDF receipts, and payment tracking.',
  invoice_pdf: 'Starter unlocks invoice PDF generation and sharing.',
  team: 'Starter lets you add team members and control access by role.',
  customers: 'Starter unlocks your full customer list and purchase history.',
  assistant: 'Starter gives you AI assistant messages to manage your business by voice or text.',
  add_business: 'Upgrade your plan to add another business to your account.',
  bulk_momo_payout: 'Pro unlocks payment reconciliation and bulk MoMo payout review.',
  cost_margin: 'Pro unlocks cost and margin tracking across your inventory.',
  export: 'Pro unlocks data export for analytics reports.',
  recurring_invoices: 'Pro unlocks recurring invoice scheduling.',
};

interface PlanGatedScreenProps {
  feature: FeatureKey;
  children: ReactNode;
}

export function PlanGatedScreen({ feature, children }: PlanGatedScreenProps) {
  const { allowed, requiredPlan, loading } = usePlanGate(feature);

  if (loading || allowed) {
    return <>{children}</>;
  }

  return (
    <UpgradePrompt
      feature={FEATURE_NAMES[feature]}
      requiredPlan={requiredPlan}
      description={FEATURE_DESCRIPTIONS[feature]}
      fullScreen
    />
  );
}
