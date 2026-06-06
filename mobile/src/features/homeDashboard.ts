import type { CreditScoreResponseDto, LoanRequestResponseDto } from '@/types/credit';
import type { MerchantAlertDto } from '@/types/notifications';
import type { DailySummaryDto, SaleResponseDto } from '@/types/sales';
import type { TaxSummaryDto } from '@/types/tax';
import type { LocalItem } from './localData';

export type AttentionKind = 'low-stock' | 'restock-soon' | 'tax' | 'credit-offer' | 'loan';

export interface AttentionItem {
  cta: string;
  icon: string;
  kind: AttentionKind;
  route: '/owner/inventory' | '/owner/tax' | '/owner/credit';
  sub: string;
  title: string;
  tone: 'warn' | 'info' | 'success' | 'danger';
}

export function getTodayRange(now = new Date()) {
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return { from_date: today, to_date: today };
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function methodGroup(method?: string | null) {
  const normalized = String(method ?? 'cash').toLowerCase();
  if (['momo', 'mtn', 'vodafone', 'airteltigo', 'paystack', 'ghqr', 'mobile_money', 'bank_transfer'].includes(normalized)) return 'momo';
  if (normalized === 'credit') return 'credit';
  if (normalized === 'mixed') return 'mixed';
  return 'cash';
}

export function buildHomeMetrics({
  daily,
  todaySales,
}: {
  daily?: DailySummaryDto;
  todaySales: SaleResponseDto[];
}) {
  const activeSales = todaySales.filter((sale) => sale.status !== 'voided');
  const methodCounts = activeSales.reduce(
    (acc, sale) => {
      acc[methodGroup(sale.payment_method)] += 1;
      return acc;
    },
    { cash: 0, momo: 0, credit: 0, mixed: 0 }
  );
  const methodRevenue = activeSales.reduce(
    (acc, sale) => {
      acc[methodGroup(sale.payment_method)] += asNumber(sale.total);
      return acc;
    },
    { cash: 0, momo: 0, credit: 0, mixed: 0 }
  );
  const sortedSales = [...activeSales].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return {
    cash: {
      count: methodCounts.cash,
      revenue: asNumber(daily?.cash_revenue),
    },
    credit: {
      count: methodCounts.credit,
      revenue: asNumber(daily?.credit_revenue),
    },
    mixedCount: methodCounts.mixed,
    momo: {
      count: methodCounts.momo,
      revenue: Math.max(asNumber(daily?.momo_revenue), methodRevenue.momo),
    },
    recentSales: sortedSales.slice(0, 4),
    revenue: asNumber(daily?.total_revenue),
    salesCount: asNumber(daily?.total_sales) || activeSales.length,
  };
}

export function buildHourlySalesBars(todaySales: SaleResponseDto[]) {
  const buckets = [
    { label: '6am', start: 6, end: 10, value: 0 },
    { label: '10am', start: 10, end: 14, value: 0 },
    { label: '2pm', start: 14, end: 18, value: 0 },
    { label: '6pm', start: 18, end: 24, value: 0 },
  ];

  todaySales
    .filter((sale) => sale.status !== 'voided')
    .forEach((sale) => {
      const hour = new Date(sale.created_at).getHours();
      const bucket = buckets.find((b) => hour >= b.start && hour < b.end) ?? buckets[0];
      bucket.value += asNumber(sale.total);
    });

  return buckets.map(({ label, value }) => ({ label, value }));
}

export function countUnreadMerchantAlerts(alerts: Array<Pick<MerchantAlertDto, 'read_at'> | { read_at?: string | null }>) {
  return alerts.filter((alert) => !alert.read_at).length;
}

function isDueSoon(dueDate: string | null | undefined, now: Date) {
  if (!dueDate) return false;
  const diffDays = (new Date(dueDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays <= 7;
}

function hasActiveLoan(requests: LoanRequestResponseDto[]) {
  return requests.some((request) =>
    ['approved', 'pending_confirmation', 'confirmed', 'disbursed', 'active'].includes(String(request.status).toLowerCase())
  );
}

export function buildAttentionItems({
  creditScore,
  loanRequests,
  lowStockItems,
  now = new Date(),
  predictiveRestockItems = [],
  taxSummary,
}: {
  creditScore?: CreditScoreResponseDto;
  loanRequests: LoanRequestResponseDto[];
  lowStockItems: Array<Pick<LocalItem, 'name'>>;
  now?: Date;
  predictiveRestockItems?: Array<{ name: string; days_until_stockout: number }>;
  taxSummary?: TaxSummaryDto;
}): AttentionItem[] {
  const attention: AttentionItem[] = [];

  if (lowStockItems.length > 0) {
    attention.push({
      cta: 'Restock',
      icon: 'package-variant',
      kind: 'low-stock',
      route: '/owner/inventory',
      sub: lowStockItems.map((i) => i.name).join(' · '),
      title: `${lowStockItems.length} item${lowStockItems.length > 1 ? 's' : ''} below low-stock`,
      tone: 'warn',
    });
  }

  // Predictive restock — only show if different from already-depleted items
  const restockSoon = predictiveRestockItems.filter(
    (r) => r.days_until_stockout > 0 && r.days_until_stockout <= 7
  );
  if (restockSoon.length > 0 && lowStockItems.length === 0) {
    const soonest = restockSoon.sort((a, b) => a.days_until_stockout - b.days_until_stockout)[0];
    attention.push({
      cta: 'View stock',
      icon: 'package-variant-closed-remove',
      kind: 'restock-soon',
      route: '/owner/inventory',
      sub: `${soonest.name} runs out in ~${soonest.days_until_stockout} day${soonest.days_until_stockout === 1 ? '' : 's'}${restockSoon.length > 1 ? ` · +${restockSoon.length - 1} more` : ''}`,
      title: `${restockSoon.length} item${restockSoon.length > 1 ? 's' : ''} running low soon`,
      tone: 'info',
    });
  }

  const readiness = taxSummary?.filing_readiness;
  const totalTax = asNumber(taxSummary?.total_tax ?? taxSummary?.vat_payable);
  const taxDueSoon = isDueSoon(taxSummary?.due_date, now);
  const taxNeedsReview =
    taxDueSoon &&
    (
      totalTax > 0 ||
      readiness?.has_generated_return === false ||
      readiness?.can_file === false
    );
  if (taxNeedsReview) {
    attention.push({
      cta: 'Review',
      icon: 'file-chart-outline',
      kind: 'tax',
      route: '/owner/tax',
      sub: taxSummary?.due_date
        ? `Due ${new Date(taxSummary.due_date).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}`
        : 'Review the auto-prepared VAT return',
      title: readiness?.has_generated_return === false ? 'VAT return draft needed' : 'VAT return needs review',
      tone: totalTax > 0 ? 'info' : 'warn',
    });
  }

  const actionableLoan = loanRequests.find((request) =>
    ['approved', 'pending_confirmation'].includes(String(request.status).toLowerCase())
  );
  if (actionableLoan) {
    attention.push({
      cta: 'Confirm',
      icon: 'bank-outline',
      kind: 'loan',
      route: '/owner/credit',
      sub: `${actionableLoan.lender_id ?? 'Lender'} · ${asNumber(actionableLoan.amount_approved ?? actionableLoan.amount_requested).toLocaleString('en-GH')} approved`,
      title: 'Loan approval ready',
      tone: 'success',
    });
  } else if (!hasActiveLoan(loanRequests) && asNumber(creditScore?.max_loan_amount) > 0) {
    attention.push({
      cta: 'See offer',
      icon: 'bank-outline',
      kind: 'credit-offer',
      route: '/owner/credit',
      sub: `Eligible up to GH₵ ${asNumber(creditScore?.max_loan_amount).toLocaleString('en-GH')}`,
      title: 'Credit offer available',
      tone: 'success',
    });
  }

  return attention.slice(0, 3);
}
