import {
  buildAttentionItems,
  buildHomeMetrics,
  buildHourlySalesBars,
  countUnreadMerchantAlerts,
  getTodayRange,
} from '@/features/homeDashboard';
import type { SaleResponseDto } from '@/types/sales';

const sales = [
  {
    id: 'sale-cash',
    created_at: '2026-05-31T08:30:00.000Z',
    payment_method: 'cash',
    status: 'completed',
    total: '120.00',
    balance_due: '0.00',
    items: [{ id: 'i1', item_id: null, description: 'Rice', qty: '1', unit_price: '120.00', line_total: '120.00', vat_amount: '0.00' }],
  },
  {
    id: 'sale-momo',
    created_at: '2026-05-31T14:00:00.000Z',
    payment_method: 'momo',
    status: 'completed',
    total: '80.00',
    balance_due: '0.00',
    items: [],
  },
  {
    id: 'sale-credit',
    created_at: '2026-05-31T19:10:00.000Z',
    payment_method: 'credit',
    status: 'completed',
    total: '50.00',
    balance_due: '50.00',
    items: [],
  },
] as SaleResponseDto[];

describe('home dashboard derivation', () => {
  it('builds a local today range for sales queries', () => {
    expect(getTodayRange(new Date('2026-05-31T16:45:00.000Z'))).toEqual({
      from_date: '2026-05-31',
      to_date: '2026-05-31',
    });
  });

  it('uses daily summary revenue but counts payment methods from all today sales', () => {
    const metrics = buildHomeMetrics({
      daily: {
        date: '2026-05-31',
        total_sales: 3,
        total_revenue: '250.00',
        cash_revenue: '120.00',
        momo_revenue: '80.00',
        credit_revenue: '50.00',
        top_items: [],
      },
      todaySales: sales,
    });

    expect(metrics.revenue).toBe(250);
    expect(metrics.salesCount).toBe(3);
    expect(metrics.cash.count).toBe(1);
    expect(metrics.cash.revenue).toBe(120);
    expect(metrics.momo.count).toBe(1);
    expect(metrics.credit.count).toBe(1);
    expect(metrics.recentSales.map((sale) => sale.id)).toEqual(['sale-credit', 'sale-momo', 'sale-cash']);
  });

  it('groups Paystack online checkout sales into the home electronic sales card', () => {
    const metrics = buildHomeMetrics({
      daily: {
        date: '2026-05-31',
        total_sales: 2,
        total_revenue: '75.00',
        cash_revenue: '30.00',
        momo_revenue: '0.00',
        credit_revenue: '0.00',
        top_items: [],
      },
      todaySales: [
        {
          id: 'sale-cash',
          created_at: '2026-05-31T08:30:00.000Z',
          payment_method: 'cash',
          status: 'completed',
          subtotal: '30.00',
          tax_amount: '0.00',
          discount_amount: '0.00',
          total: '30.00',
          amount_paid: '30.00',
          balance_due: '0.00',
          notes: null,
          customer_id: null,
          items: [],
        },
        {
          id: 'sale-paystack',
          created_at: '2026-05-31T14:00:00.000Z',
          payment_method: 'paystack',
          status: 'completed',
          subtotal: '45.00',
          tax_amount: '0.00',
          discount_amount: '0.00',
          total: '45.00',
          amount_paid: '45.00',
          balance_due: '0.00',
          notes: null,
          customer_id: null,
          items: [],
        },
      ] as SaleResponseDto[],
    });

    expect(metrics.momo.count).toBe(1);
    expect(metrics.momo.revenue).toBe(45);
  });

  it('creates real hourly buckets from today sales instead of fake daily bars', () => {
    expect(buildHourlySalesBars(sales).map((bucket) => bucket.value)).toEqual([120, 0, 80, 50]);
  });

  it('counts unread merchant alerts for the home bell badge', () => {
    expect(countUnreadMerchantAlerts([
      { read_at: null },
      { read_at: '2026-05-31T08:00:00.000Z' },
      { read_at: null },
    ])).toBe(2);
  });

  it('builds attention items from real low stock, VAT, and credit state', () => {
    const items = buildAttentionItems({
      lowStockItems: [{ name: 'Tomatoes' }],
      taxSummary: {
        month: 5,
        year: 2026,
        total_tax: '88.00',
        due_date: '2026-06-07',
        filing_readiness: { has_generated_return: false, can_file: false },
      },
      creditScore: { score: 72, max_loan_amount: '2500.00' },
      loanRequests: [],
      now: new Date('2026-05-31T12:00:00.000Z'),
    });

    expect(items.map((item) => item.kind)).toEqual(['low-stock', 'tax', 'credit-offer']);
  });

  it('does not show far-future VAT drafts as urgent home attention', () => {
    const items = buildAttentionItems({
      lowStockItems: [],
      taxSummary: {
        month: 7,
        year: 2026,
        total_tax: '88.00',
        due_date: '2026-07-30',
        filing_readiness: { has_generated_return: false, can_file: false },
      },
      creditScore: undefined,
      loanRequests: [],
      now: new Date('2026-06-05T12:00:00.000Z'),
    });

    expect(items.map((item) => item.kind)).not.toContain('tax');
  });
});
