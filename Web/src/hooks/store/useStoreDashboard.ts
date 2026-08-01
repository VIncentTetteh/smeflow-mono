'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface DashboardSummary {
  daily_summary: {
    date: string;
    total_sales: number;
    total_revenue: number;
    cash_revenue: number;
    momo_revenue: number;
    credit_revenue: number;
    top_items: Array<{ name?: string; qty?: number; revenue?: number }>;
  } | null;
  alerts: {
    items: Array<{
      id: string;
      title?: string;
      body?: string;
      severity?: string;
      action_path?: string | null;
      action_label?: string | null;
      created_at?: string;
    }>;
    unread_count: number;
  };
  credit_score: {
    score?: number;
    band?: string;
    max_loan_amount?: number | null;
  } | null;
  tax_summary: {
    vat_payable?: number;
    filing_readiness?: string;
  } | null;
  low_stock_preview: Array<{
    id: string;
    name: string;
    current_stock: number;
    low_stock_threshold: number;
  }>;
  generated_at: string;
}

/** One-call home aggregate — replaces several parallel calls. */
export function useStoreDashboard() {
  return useQuery({
    queryKey: ['store', 'dashboard'],
    queryFn: async () => {
      const res = await apiClient.get<DashboardSummary>('/business/dashboard-summary');
      return res.data;
    },
    refetchInterval: 60_000,
  });
}
