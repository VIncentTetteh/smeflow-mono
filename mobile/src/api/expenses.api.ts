import { apiClient } from './client';
import type {
  ExpenseCategoryOptionDto,
  ExpenseCreatePayload,
  ExpenseDto,
  ExpenseListDto,
  ExpenseSummaryDto,
} from '@/types/expenses';

export async function getExpenseCategories(): Promise<ExpenseCategoryOptionDto[]> {
  const response = await apiClient.get<ExpenseCategoryOptionDto[]>(
    '/api/v1/expenses/categories',
  );
  return response.data;
}

export async function getExpenses(params: {
  from_date?: string;
  to_date?: string;
  category?: string;
  payment_method?: string;
  page?: number;
  page_size?: number;
}): Promise<ExpenseListDto> {
  const response = await apiClient.get<ExpenseListDto>('/api/v1/expenses', { params });
  return response.data;
}

export async function getExpenseSummary(params: {
  from_date: string;
  to_date: string;
}): Promise<ExpenseSummaryDto> {
  const response = await apiClient.get<ExpenseSummaryDto>('/api/v1/expenses/summary', {
    params,
  });
  return response.data;
}

export async function recordExpense(payload: ExpenseCreatePayload): Promise<ExpenseDto> {
  const response = await apiClient.post<ExpenseDto>('/api/v1/expenses', payload);
  return response.data;
}

export async function updateExpense(
  expenseId: string,
  payload: Partial<ExpenseCreatePayload>,
): Promise<ExpenseDto> {
  const response = await apiClient.patch<ExpenseDto>(`/api/v1/expenses/${expenseId}`, payload);
  return response.data;
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await apiClient.delete(`/api/v1/expenses/${expenseId}`);
}
