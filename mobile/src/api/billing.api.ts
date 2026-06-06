import { apiClient } from './client';
import type {
  BillingInvoiceDto,
  BillingPlanUsageDto,
  BillingTransactionDto,
  PlanInfoDto,
  SubscriptionResponseDto,
} from '@/types/billing';

export async function listBillingPlans(): Promise<PlanInfoDto[]> {
  const response = await apiClient.get<PlanInfoDto[]>('/api/v1/billing/plans');
  return response.data;
}

export async function getSubscription(): Promise<SubscriptionResponseDto> {
  const response = await apiClient.get<SubscriptionResponseDto>('/api/v1/billing/subscription');
  return response.data;
}

export async function getBillingPlanUsage(): Promise<BillingPlanUsageDto> {
  const response = await apiClient.get<BillingPlanUsageDto>('/api/v1/billing/plan');
  return response.data;
}

export async function listBillingTransactions(): Promise<BillingTransactionDto[]> {
  const response = await apiClient.get<BillingTransactionDto[]>('/api/v1/billing/transactions');
  return response.data;
}

export async function listBillingInvoices(): Promise<BillingInvoiceDto[]> {
  const response = await apiClient.get<BillingInvoiceDto[]>('/api/v1/billing/invoices');
  return response.data;
}

export async function cancelSubscription(): Promise<void> {
  await apiClient.post('/api/v1/billing/subscription/cancel');
}
