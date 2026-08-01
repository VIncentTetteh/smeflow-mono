'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

/**
 * `kind` mirrors the backend category constant:
 *   operating      → counted in operating expenses and net profit
 *   cogs           → already counted via item cost price; excluded
 *   non_operating  → drawings / loan principal; excluded
 */
export type ExpenseKind = 'operating' | 'cogs' | 'non_operating';

export type ExpensePaymentMethod = 'cash' | 'momo' | 'bank' | 'credit' | 'other';

export interface ExpenseCategoryOption {
  key: string;
  label: string;
  kind: ExpenseKind;
}

export interface Expense {
  id: string;
  category: string;
  category_label: string;
  kind: ExpenseKind;
  amount: number;
  vat_amount: number | null;
  expense_date: string;
  payment_method: ExpensePaymentMethod;
  vendor_name: string | null;
  reference: string | null;
  notes: string | null;
  source: string;
  is_editable: boolean;
  created_at: string;
}

export interface ExpenseList {
  total: number;
  page: number;
  page_size: number;
  items: Expense[];
}

export interface ExpenseCategoryTotal {
  category: string;
  label: string;
  kind: ExpenseKind;
  total: number;
  count: number;
}

export interface ExpenseSummary {
  from_date: string;
  to_date: string;
  total: number;
  operating_total: number;
  excluded_total: number;
  count: number;
  by_category: ExpenseCategoryTotal[];
  by_payment_method: { payment_method: string; total: number; count: number }[];
}

export interface ExpenseCreate {
  category: string;
  amount: number;
  expense_date: string;
  payment_method: ExpensePaymentMethod;
  vat_amount?: number;
  vendor_name?: string;
  reference?: string;
  notes?: string;
}

const EX = ['store', 'expenses'] as const;

export function useExpenseCategories() {
  return useQuery({
    queryKey: [...EX, 'categories'],
    // Fixed constant on the server — never goes stale.
    staleTime: Infinity,
    queryFn: async () =>
      (await apiClient.get<ExpenseCategoryOption[]>('/expenses/categories')).data,
  });
}

export function useExpenses(from_date: string, to_date: string) {
  return useQuery({
    queryKey: [...EX, 'list', from_date, to_date],
    enabled: !!from_date && !!to_date,
    queryFn: async () =>
      (
        await apiClient.get<ExpenseList>('/expenses', {
          params: { from_date, to_date, page_size: 100 },
        })
      ).data,
  });
}

export function useExpenseSummary(from_date: string, to_date: string) {
  return useQuery({
    queryKey: [...EX, 'summary', from_date, to_date],
    enabled: !!from_date && !!to_date,
    queryFn: async () =>
      (await apiClient.get<ExpenseSummary>('/expenses/summary', { params: { from_date, to_date } }))
        .data,
  });
}

/** Invalidates every view whose numbers move when an expense changes. */
function useInvalidateExpenses() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [...EX] });
    qc.invalidateQueries({ queryKey: ['store', 'analytics'] });
  };
}

export function useRecordExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (body: ExpenseCreate) =>
      apiClient.post<Expense>('/expenses', body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteExpense() {
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/expenses/${id}`),
    onSuccess: invalidate,
  });
}
