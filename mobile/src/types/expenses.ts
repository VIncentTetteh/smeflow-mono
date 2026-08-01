import type { UUID } from './common';

/**
 * `kind` mirrors the backend category constant:
 *   operating      → counted in operating expenses and net profit
 *   cogs           → already counted via item cost price; excluded
 *   non_operating  → drawings / loan principal; excluded
 */
export type ExpenseKind = 'operating' | 'cogs' | 'non_operating';

export type ExpensePaymentMethod = 'cash' | 'momo' | 'bank' | 'credit' | 'other';

export interface ExpenseCategoryOptionDto {
  key: string;
  label: string;
  kind: ExpenseKind;
}

export interface ExpenseDto {
  id: UUID;
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

export interface ExpenseListDto {
  total: number;
  page: number;
  page_size: number;
  items: ExpenseDto[];
}

export interface ExpenseCategoryTotal {
  category: string;
  label: string;
  kind: ExpenseKind;
  total: number;
  count: number;
}

export interface ExpenseSummaryDto {
  from_date: string;
  to_date: string;
  total: number;
  operating_total: number;
  excluded_total: number;
  count: number;
  by_category: ExpenseCategoryTotal[];
  by_payment_method: { payment_method: string; total: number; count: number }[];
}

export interface ExpenseCreatePayload {
  category: string;
  amount: number;
  expense_date: string;
  payment_method: ExpensePaymentMethod;
  vat_amount?: number;
  vendor_name?: string;
  reference?: string;
  notes?: string;
}
