import type { CreditScoreFactors, CreditScoreResponseDto } from '@/types/credit';

export type CreditFactorImpact = 'strength' | 'watch' | 'risk';

export interface CreditDisplayFactor {
  key: string;
  label: string;
  displayValue: string;
  score: number;
  impact: CreditFactorImpact;
  explanation: string;
}

export interface CreditImprovementAction {
  title: string;
  body: string;
}

export interface CreditInsights {
  score: number;
  bandLabel: string;
  maxLoanAmount: number;
  displayFactors: CreditDisplayFactor[];
  strengths: CreditDisplayFactor[];
  risks: CreditDisplayFactor[];
  improvementActions: CreditImprovementAction[];
}

type ComponentScores = Record<string, number>;

const FACTOR_ORDER = [
  'revenue_30d',
  'revenue_90d',
  'repayment_rate',
  'consistency_score',
  'transaction_count_90d',
  'momo_velocity',
  'digital_adoption_score',
  'customer_retention_rate',
  'inventory_turnover_ratio',
  'seasonal_trend_score',
  'account_age_days',
  'ml_risk',
];

const FACTOR_META: Record<string, { label: string; explanation: string; kind: 'money' | 'percent' | 'count' | 'days' | 'ratio' | 'score' }> = {
  revenue_30d: {
    label: 'Recent revenue',
    kind: 'money',
    explanation: 'Higher recent sales improve your borrowing capacity.',
  },
  revenue_90d: {
    label: '90-day revenue',
    kind: 'money',
    explanation: 'A longer sales history helps lenders see stable demand.',
  },
  repayment_rate: {
    label: 'Credit repayment',
    kind: 'percent',
    explanation: 'Collecting customer credit on time improves lender confidence.',
  },
  consistency_score: {
    label: 'Sales consistency',
    kind: 'percent',
    explanation: 'Frequent trading days make your cash flow easier to assess.',
  },
  transaction_count_90d: {
    label: 'Sales activity',
    kind: 'count',
    explanation: 'More recorded sales gives the score stronger evidence.',
  },
  momo_velocity: {
    label: 'MoMo collections',
    kind: 'ratio',
    explanation: 'Verified digital payments help prove business cash flow.',
  },
  digital_adoption_score: {
    label: 'Digital payments',
    kind: 'percent',
    explanation: 'More verified digital payments can improve loan readiness.',
  },
  customer_retention_rate: {
    label: 'Repeat customers',
    kind: 'percent',
    explanation: 'Returning customers show business stability.',
  },
  inventory_turnover_ratio: {
    label: 'Stock turnover',
    kind: 'ratio',
    explanation: 'Healthy stock movement shows working capital is active.',
  },
  seasonal_trend_score: {
    label: 'Revenue stability',
    kind: 'percent',
    explanation: 'Stable monthly revenue lowers perceived risk.',
  },
  account_age_days: {
    label: 'Account age',
    kind: 'days',
    explanation: 'Older business records give lenders more confidence.',
  },
  ml_risk: {
    label: 'Risk outlook',
    kind: 'score',
    explanation: 'Lower predicted risk improves your score.',
  },
};

export function clampScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function asNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value: number): string {
  return `GH₵ ${Math.max(0, value).toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number): string {
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${Math.max(0, Math.min(100, percent)).toLocaleString('en-GH', {
    maximumFractionDigits: percent < 10 ? 1 : 0,
  })}%`;
}

function formatFactorValue(key: string, value: number): string {
  const meta = FACTOR_META[key];
  if (!meta) return String(value);
  if (meta.kind === 'money') return formatMoney(value);
  if (meta.kind === 'percent' || meta.kind === 'score') return formatPercent(value);
  if (meta.kind === 'days') return `${Math.max(0, Math.round(value)).toLocaleString('en-GH')} days`;
  if (meta.kind === 'count') return `${Math.max(0, Math.round(value)).toLocaleString('en-GH')} sales`;
  return value.toLocaleString('en-GH', { maximumFractionDigits: 2 });
}

function scoreFromRaw(key: string, value: number, componentScores: ComponentScores): number {
  const componentKey: Record<string, string> = {
    revenue_30d: 'revenue_30d',
    revenue_90d: 'revenue_90d',
    repayment_rate: 'repayment',
    consistency_score: 'consistency',
    transaction_count_90d: 'frequency',
    momo_velocity: 'momo_velocity',
    digital_adoption_score: 'digital',
    customer_retention_rate: 'retention',
    inventory_turnover_ratio: 'inventory',
    seasonal_trend_score: 'seasonal',
    account_age_days: 'age',
  };
  const component = componentScores[componentKey[key]];
  if (component !== undefined) return clampScore(component);
  if (['repayment_rate', 'consistency_score', 'digital_adoption_score', 'customer_retention_rate', 'seasonal_trend_score'].includes(key)) {
    return clampScore(value * 100);
  }
  if (key === 'revenue_30d') return clampScore((value / 10_000) * 100);
  if (key === 'revenue_90d') return clampScore((value / 30_000) * 100);
  if (key === 'transaction_count_90d') return clampScore((value / 90) * 100);
  if (key === 'account_age_days') return clampScore((value / 365) * 100);
  if (key === 'momo_velocity') return clampScore((value / 2) * 100);
  if (key === 'inventory_turnover_ratio') return clampScore((value / 12) * 100);
  return clampScore(value);
}

function impactFor(score: number): CreditFactorImpact {
  if (score >= 70) return 'strength';
  if (score >= 40) return 'watch';
  return 'risk';
}

function bandLabel(score: number, band?: string): string {
  if (band && /^[A-E]$/.test(band)) {
    return ({ A: 'Strong', B: 'Good', C: 'Fair', D: 'Poor', E: 'Poor' } as Record<string, string>)[band];
  }
  if (score >= 80) return 'Strong';
  if (score >= 65) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Poor';
}

export function buildCreditInsights(scoreData?: CreditScoreResponseDto | null): CreditInsights {
  const factors: CreditScoreFactors = scoreData?.factors ?? {};
  const componentScores: ComponentScores = factors.component_scores ?? {};
  const mlInsights = factors.ml_insights ?? {};
  const score = clampScore(scoreData?.score ?? scoreData?.value ?? 0);
  const factorKeys = FACTOR_ORDER.filter((key) => {
    if (key === 'ml_risk') return mlInsights.risk_probability !== undefined;
    return factors[key as keyof CreditScoreFactors] !== undefined;
  });

  const displayFactors = factorKeys.map((key) => {
    const rawValue =
      key === 'ml_risk'
        ? 1 - asNumber(mlInsights.risk_probability)
        : asNumber(factors[key as keyof CreditScoreFactors]);
    const scoreValue = key === 'ml_risk' ? clampScore(rawValue * 100) : scoreFromRaw(key, rawValue, componentScores);
    return {
      key,
      label: FACTOR_META[key].label,
      displayValue: formatFactorValue(key, rawValue),
      score: scoreValue,
      impact: impactFor(scoreValue),
      explanation: FACTOR_META[key].explanation,
    };
  });

  const risks = displayFactors.filter((factor) => factor.impact === 'risk').slice(0, 4);
  const strengths = displayFactors.filter((factor) => factor.impact === 'strength').slice(0, 3);

  return {
    score,
    bandLabel: bandLabel(score, scoreData?.band),
    maxLoanAmount: asNumber(scoreData?.max_loan_amount),
    displayFactors,
    strengths,
    risks,
    improvementActions: buildImprovementActions(risks),
  };
}

function buildImprovementActions(risks: CreditDisplayFactor[]): CreditImprovementAction[] {
  const actionByKey: Record<string, CreditImprovementAction> = {
    revenue_30d: {
      title: 'Grow your monthly sales',
      body: 'Higher monthly revenue directly increases your borrowing capacity and score.',
    },
    revenue_90d: {
      title: 'Build a longer sales history',
      body: 'Consistent sales over 3 months gives lenders stronger evidence of steady income.',
    },
    inventory_turnover_ratio: {
      title: 'Move stock faster',
      body: 'Selling inventory quickly improves your cash flow and reduces capital tied up in goods.',
    },
    seasonal_trend_score: {
      title: 'Stabilise revenue across months',
      body: 'Consistent month-to-month revenue makes your business easier to assess for credit.',
    },
    repayment_rate: {
      title: 'Collect customer credit faster',
      body: 'Record repayments as soon as customers pay so lenders see stronger recovery.',
    },
    consistency_score: {
      title: 'Record sales every trading day',
      body: 'Daily sales history helps prove steady cash flow, even when amounts are small.',
    },
    digital_adoption_score: {
      title: 'Use verified MoMo more often',
      body: 'Digital payments give lenders cleaner proof of business income.',
    },
    momo_velocity: {
      title: 'Accept more MoMo payments',
      body: 'Verified collections make revenue easier to confirm.',
    },
    transaction_count_90d: {
      title: 'Capture every sale',
      body: 'More recorded transactions improves the confidence behind your score.',
    },
    customer_retention_rate: {
      title: 'Attach customers to repeat sales',
      body: 'Repeat customers show the business has dependable demand.',
    },
  };
  const actions = risks.map((factor) => actionByKey[factor.key]).filter(Boolean);
  return actions.length
    ? actions.slice(0, 3)
    : [
        {
          title: 'Keep recording sales',
          body: 'Your score improves as SMEFlow collects more verified trading history.',
        },
      ];
}

export function buildLoanEmptyState({
  isOnline,
  score,
  lendersCount,
}: {
  isOnline: boolean;
  score: number;
  lendersCount: number;
}) {
  if (!isOnline) {
    return {
      title: 'Loan applications need internet',
      body: 'Your score can be viewed offline, but applications and lender offers require a live connection.',
    };
  }
  if (score < 50) {
    return {
      title: 'Improve your score to unlock offers',
      body: 'Record more sales, collect customer credit, and use verified digital payments to become eligible.',
    };
  }
  if (lendersCount === 0) {
    return {
      title: 'No lending partners available',
      body: 'There are no active loan products for your business right now. Check again after your score refreshes.',
    };
  }
  return {
    title: 'No eligible products yet',
    body: 'Your score is improving, but current products require a stronger credit band.',
  };
}

export function isLoanActionOnlineOnly(isOnline: boolean): boolean {
  return !isOnline;
}
