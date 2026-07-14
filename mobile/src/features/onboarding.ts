import type { BusinessKyc, MoMoAccount } from '@/store/auth';

export interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  route: string;
  done: boolean;
}

interface OnboardingData {
  momoAccounts: MoMoAccount[];
  businessKyc: BusinessKyc | null;
  itemCount: number;
  salesCount: number;
}

export function getOnboardingSteps(data: OnboardingData): OnboardingStep[] {
  return [
    {
      id: 'momo',
      label: 'Link your MoMo wallet',
      description: 'Accept mobile money payments from customers',
      route: '/owner/settings',
      done: data.momoAccounts.length > 0,
    },
    {
      id: 'kyc',
      label: 'Verify your identity (KYC)',
      description: 'Unlock credit scoring and higher payment limits',
      route: '/onboarding/kyc',
      done: data.businessKyc?.status === 'verified',
    },
    {
      id: 'inventory',
      label: 'Add your first product',
      description: 'Build your inventory to start selling',
      route: '/owner/inventory',
      done: data.itemCount > 0,
    },
    {
      id: 'sale',
      label: 'Record your first sale',
      description: 'See how easy it is to close a sale',
      route: '/owner/sell',
      done: data.salesCount > 0,
    },
  ];
}

export function getOnboardingProgress(data: OnboardingData): {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  allDone: boolean;
} {
  const steps = getOnboardingSteps(data);
  const completedCount = steps.filter((s) => s.done).length;
  return { steps, completedCount, totalCount: steps.length, allDone: completedCount === steps.length };
}
