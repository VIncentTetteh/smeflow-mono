'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

const AN = ['store', 'analytics'] as const;

export interface RevenuePoint {
  day: string;
  total_sales: number;
  revenue: number | string;
  cash: number | string;
  momo: number | string;
  credit: number | string;
}

export function useRevenueTrend(period = '30d') {
  return useQuery({
    queryKey: [...AN, 'revenue', period],
    queryFn: async () => {
      const res = await apiClient.get<RevenuePoint[]>('/analytics/revenue', {
        params: { period, group_by: 'day' },
      });
      return res.data;
    },
  });
}

export interface TopItem {
  name: string;
  qty: number;
  revenue: number;
}

export function useTopItems(period = '30d') {
  return useQuery({
    queryKey: [...AN, 'top-items', period],
    queryFn: async () => {
      const res = await apiClient.get<TopItem[]>('/analytics/top-items', { params: { period } });
      return res.data;
    },
  });
}

export interface ExpenseCategoryTotal {
  category: string;
  label: string;
  kind: 'operating' | 'cogs' | 'non_operating';
  total: number;
  count: number;
}

export interface Pnl {
  from_date: string;
  to_date: string;
  revenue: number;
  discounts: number;
  net_revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
  operating_expenses: number;
  net_profit: number;
  net_margin_pct: number;
  expenses_by_category: ExpenseCategoryTotal[];
}

export function usePnl(from_date: string, to_date: string) {
  return useQuery({
    queryKey: [...AN, 'pnl', from_date, to_date],
    enabled: !!from_date && !!to_date,
    queryFn: async () => {
      const res = await apiClient.get<Pnl>('/analytics/pnl', { params: { from_date, to_date } });
      return res.data;
    },
  });
}

export interface CashFlow {
  from_date: string;
  to_date: string;
  cash_inflow: number | string;
  momo_inflow: number | string;
  total_inflow: number | string;
  cash_outflow: number | string;
  momo_outflow: number | string;
  total_outflow: number | string;
  net_cash_flow: number | string;
  outstanding_credit: number | string;
  total_sales: number;
}

export function useCashFlow(from_date: string, to_date: string) {
  return useQuery({
    queryKey: [...AN, 'cash-flow', from_date, to_date],
    enabled: !!from_date && !!to_date,
    queryFn: async () => {
      const res = await apiClient.get<CashFlow>('/analytics/cash-flow', {
        params: { from_date, to_date },
      });
      return res.data;
    },
  });
}
