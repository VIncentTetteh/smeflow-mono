import { apiClient } from './client';
import type {
  GHQRGenerateDto,
  GHQRGenerateResponseDto,
  PaymentDisburseDto,
  PaymentListResponseDto,
  PaymentRequestDto,
  PaymentReconciliationInboxDto,
  PaymentResponseDto,
  PaymentChannelAnalyticsDto,
} from '@/types/payments';

export async function listPayments(): Promise<PaymentListResponseDto> {
  const response = await apiClient.get<PaymentListResponseDto>('/api/v1/payments');
  return response.data;
}

export async function getPaymentChannelAnalytics(): Promise<PaymentChannelAnalyticsDto> {
  const response = await apiClient.get<PaymentChannelAnalyticsDto>('/api/v1/payments/analytics/channels');
  return response.data;
}

export async function getPaymentReconciliationInbox(params?: {
  include_ignored?: boolean;
  limit?: number;
  offset?: number;
  provider?: string;
}): Promise<PaymentReconciliationInboxDto> {
  const response = await apiClient.get<PaymentReconciliationInboxDto>(
    '/api/v1/payments/reconciliation/inbox',
    { params }
  );
  return response.data;
}

export async function ignoreReconciliationItem(paymentId: string): Promise<{ payment_id: string; match_state: string; message: string }> {
  const response = await apiClient.post(`/api/v1/payments/reconciliation/${paymentId}/ignore`);
  return response.data;
}

export async function unignoreReconciliationItem(paymentId: string): Promise<{ payment_id: string; match_state: string; message: string }> {
  const response = await apiClient.post(`/api/v1/payments/reconciliation/${paymentId}/unignore`);
  return response.data;
}

export async function getPayment(paymentId: string): Promise<PaymentResponseDto> {
  const response = await apiClient.get<PaymentResponseDto>(`/api/v1/payments/${paymentId}`);
  return response.data;
}

export async function requestPayment(body: PaymentRequestDto): Promise<PaymentResponseDto> {
  const response = await apiClient.post<PaymentResponseDto>('/api/v1/payments/request', body);
  return response.data;
}

export async function disbursePayment(body: PaymentDisburseDto): Promise<PaymentResponseDto> {
  const response = await apiClient.post<PaymentResponseDto>('/api/v1/payments/disburse', body);
  return response.data;
}

export async function generateGhqr(body: GHQRGenerateDto): Promise<GHQRGenerateResponseDto> {
  const response = await apiClient.post<GHQRGenerateResponseDto>(
    '/api/v1/payments/ghqr/generate',
    body
  );
  return response.data;
}
