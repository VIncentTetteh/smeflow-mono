import {
  buildCreditInsights,
  buildLoanEmptyState,
  isLoanActionOnlineOnly,
} from '@/features/creditInsights';

describe('credit insight derivation', () => {
  it('formats raw credit factors into merchant-facing score factors', () => {
    const insights = buildCreditInsights({
      score: 20.28,
      band: 'E',
      max_loan_amount: '0.00',
      factors: {
        revenue_30d: 24000,
        revenue_90d: 72000,
        repayment_rate: 0.0123,
        consistency_score: 0.00011111111111111112,
        component_scores: {
          revenue_30d: 100,
          repayment: 1.2,
          consistency: 0,
        },
        ml_insights: {
          risk_probability: 0.66,
          confidence_score: 0.44,
        },
      },
    });

    expect(insights.displayFactors.map((factor) => factor.label)).toEqual([
      'Recent revenue',
      '90-day revenue',
      'Credit repayment',
      'Sales consistency',
      'Risk outlook',
    ]);
    expect(insights.displayFactors[0]).toMatchObject({
      displayValue: 'GH₵ 24,000',
      score: 100,
      impact: 'strength',
    });
    expect(insights.displayFactors[2]).toMatchObject({
      displayValue: '1.2%',
      score: 1,
      impact: 'risk',
    });
    expect(insights.displayFactors.some((factor) => factor.label === 'component scores')).toBe(false);
    expect(insights.improvementActions.length).toBeGreaterThan(0);
  });

  it('clamps impossible factor scores before rendering progress bars', () => {
    const insights = buildCreditInsights({
      score: 125,
      factors: {
        revenue_30d: 50000,
        component_scores: { revenue_30d: 240, digital: -20 },
        digital_adoption_score: -0.5,
      },
    });

    expect(insights.score).toBe(100);
    expect(insights.displayFactors.find((factor) => factor.key === 'revenue_30d')?.score).toBe(100);
    expect(insights.displayFactors.find((factor) => factor.key === 'digital_adoption_score')?.score).toBe(0);
  });

  it('explains empty lender states by network and eligibility', () => {
    expect(buildLoanEmptyState({ isOnline: false, score: 80, lendersCount: 0 }).title).toBe(
      'Loan applications need internet'
    );
    expect(buildLoanEmptyState({ isOnline: true, score: 20, lendersCount: 0 }).title).toBe(
      'Improve your score to unlock offers'
    );
    expect(buildLoanEmptyState({ isOnline: true, score: 75, lendersCount: 0 }).title).toBe(
      'No lending partners available'
    );
  });

  it('keeps loan actions online-only', () => {
    expect(isLoanActionOnlineOnly(false)).toBe(true);
    expect(isLoanActionOnlineOnly(true)).toBe(false);
  });
});
