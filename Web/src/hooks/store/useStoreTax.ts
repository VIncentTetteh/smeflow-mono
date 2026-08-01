'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface TaxSummary {
  period: string;
  vat_output: string;
  vat_input: string;
  vat_payable: string;
  nhil: string;
  getfund: string;
  covid_levy: string;
  total_tax: string;
  status: string;
  paye_withheld: string;
  estimated_income_tax: string;
  due_date: string | null;
  filing_readiness: Record<string, unknown>;
}

export interface TaxReturn {
  id: string;
  period_type: string;
  period_start: string;
  period_end: string;
  vat_payable: string;
  total_tax: string;
  status: string;
  gra_ref: string | null;
  export_url: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface TaxCalendarEntry {
  tax_type: string;
  period: string;
  due_date: string;
  description: string;
}

const TAX = ['store', 'tax'] as const;

export function useTaxSummary(year: number, month: number) {
  return useQuery({
    queryKey: [...TAX, 'summary', year, month],
    queryFn: async () => {
      const res = await apiClient.get<TaxSummary>('/tax/summary', {
        params: { period: 'monthly', year, month },
      });
      return res.data;
    },
  });
}

export function useTaxReturns() {
  return useQuery({
    queryKey: [...TAX, 'returns'],
    queryFn: async () => (await apiClient.get<TaxReturn[]>('/tax/returns')).data,
  });
}

export function useTaxCalendar(year: number, month: number) {
  return useQuery({
    queryKey: [...TAX, 'calendar', year, month],
    queryFn: async () => {
      const res = await apiClient.get<TaxCalendarEntry[]>('/tax/calendar', {
        params: { year, month },
      });
      return res.data;
    },
  });
}

export function useGenerateReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { period_type: string; period_start: string; period_end: string }) =>
      apiClient.post('/tax/returns/generate', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...TAX, 'returns'] }),
  });
}
