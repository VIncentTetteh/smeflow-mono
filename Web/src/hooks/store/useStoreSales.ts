'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface Sale {
  id: string;
  status: string;
  payment_method: string;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  total: string;
  amount_paid: string;
  balance_due: string;
  notes: string | null;
  customer_id: string | null;
  customer_phone: string | null;
  payment_status: string | null;
  created_at: string;
  items: Array<{ id: string; description: string; qty: string; unit_price: string; line_total: string }>;
}

export interface DailySummary {
  date: string;
  total_sales: number;
  total_revenue: string;
  cash_revenue: string;
  momo_revenue: string;
  credit_revenue: string;
  top_items: Array<{ name?: string; qty?: number; revenue?: number }>;
}

const SALES = ['store', 'sales'] as const;

export function useSales(params?: { status?: string; from_date?: string; to_date?: string }) {
  return useQuery({
    queryKey: [...SALES, 'list', params?.status ?? '', params?.from_date ?? '', params?.to_date ?? ''],
    queryFn: async () => {
      const res = await apiClient.get<Sale[]>('/sales', {
        params: {
          status: params?.status || undefined,
          from_date: params?.from_date || undefined,
          to_date: params?.to_date || undefined,
          limit: 100,
        },
      });
      return res.data;
    },
  });
}

export function useDailySummary(date?: string) {
  return useQuery({
    queryKey: [...SALES, 'summary', 'daily', date ?? 'today'],
    queryFn: async () => {
      const res = await apiClient.get<DailySummary>('/sales/summary/daily', {
        params: { date: date || undefined },
      });
      return res.data;
    },
  });
}

export function usePeriodSummary(from_date: string, to_date: string) {
  return useQuery({
    queryKey: [...SALES, 'summary', 'period', from_date, to_date],
    enabled: !!from_date && !!to_date,
    queryFn: async () => {
      const res = await apiClient.get('/sales/summary/period', { params: { from_date, to_date } });
      return res.data as {
        from_date: string;
        to_date: string;
        total_sales: number;
        total_revenue: string;
        cash_revenue: string;
        momo_revenue: string;
        credit_revenue: string;
      };
    },
  });
}

export function useVoidSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saleId: string) => apiClient.post(`/sales/${saleId}/void`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...SALES] });
      qc.invalidateQueries({ queryKey: ['store', 'dashboard'] });
    },
  });
}

export interface CustomerListItem {
  id: string;
  name: string | null;
  phone: string | null;
  purchase_count: number;
  lifetime_value: string;
  outstanding_credit: string;
  last_purchase_at: string | null;
  since: string;
}

export function useCustomers(search?: string) {
  return useQuery({
    queryKey: ['store', 'customers', search ?? ''],
    queryFn: async () => {
      const res = await apiClient.get<{ total: number; items: CustomerListItem[] }>('/sales/customers', {
        params: { search: search || undefined },
      });
      return res.data;
    },
  });
}
