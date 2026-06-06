import { apiClient } from './client';
import type {
  BatchSyncPayloadDto,
  CustomerDetailResponseDto,
  CustomerListResponseDto,
  DailySummaryDto,
  PeriodSummaryDto,
  RecordPaymentDto,
  SaleCreateDto,
  PaymentIntentResponseDto,
  SaleRecordResponseDto,
  SaleResponseDto,
} from '@/types/sales';

export interface SaleListParams {
  from_date?: string;
  to_date?: string;
  status?: string;
  changed_since?: string;
}

export async function recordSale(body: SaleCreateDto): Promise<SaleRecordResponseDto> {
  const response = await apiClient.post<SaleRecordResponseDto>('/api/v1/sales/record', body);
  return response.data;
}

export async function createPaystackSaleIntent(body: SaleCreateDto): Promise<PaymentIntentResponseDto> {
  const response = await apiClient.post<PaymentIntentResponseDto>('/api/v1/sales/payment-intents', body);
  return response.data;
}

export async function getPaystackSaleIntent(paymentId: string): Promise<PaymentIntentResponseDto> {
  const response = await apiClient.get<PaymentIntentResponseDto>(`/api/v1/sales/payment-intents/${paymentId}`);
  return response.data;
}

export async function verifyPaystackSaleIntent(paymentId: string): Promise<PaymentIntentResponseDto> {
  const response = await apiClient.post<PaymentIntentResponseDto>(`/api/v1/sales/payment-intents/${paymentId}/verify`, {});
  return response.data;
}

export async function batchSyncSales(body: BatchSyncPayloadDto): Promise<{ processed: number }> {
  const response = await apiClient.post<{ processed: number }>('/api/v1/sales/batch', body);
  return response.data;
}

export async function listSales(params?: SaleListParams): Promise<SaleResponseDto[]> {
  const response = await apiClient.get<SaleResponseDto[]>('/api/v1/sales', { params });
  return response.data;
}

export async function getDailySummary(): Promise<DailySummaryDto> {
  const response = await apiClient.get<DailySummaryDto>('/api/v1/sales/summary/daily');
  return response.data;
}

export async function getPeriodSummary(params: {
  from_date: string;
  to_date: string;
}): Promise<PeriodSummaryDto> {
  const response = await apiClient.get<PeriodSummaryDto>('/api/v1/sales/summary/period', {
    params,
  });
  return response.data;
}

export async function listCustomers(search?: string): Promise<CustomerListResponseDto> {
  const response = await apiClient.get<CustomerListResponseDto>('/api/v1/sales/customers', {
    params: search ? { search } : undefined,
  });
  return response.data;
}

export async function getCustomer(customerId: string): Promise<CustomerDetailResponseDto> {
  const response = await apiClient.get<CustomerDetailResponseDto>(
    `/api/v1/sales/customers/${customerId}`
  );
  return response.data;
}

export async function getSale(saleId: string): Promise<SaleResponseDto> {
  const response = await apiClient.get<SaleResponseDto>(`/api/v1/sales/${saleId}`);
  return response.data;
}

export async function voidSale(saleId: string): Promise<SaleResponseDto> {
  const response = await apiClient.post<SaleResponseDto>(`/api/v1/sales/${saleId}/void`, {});
  return response.data;
}

export async function recordPayment(
  saleId: string,
  body: RecordPaymentDto
): Promise<SaleResponseDto> {
  const response = await apiClient.post<SaleResponseDto>(`/api/v1/sales/${saleId}/pay`, body);
  return response.data;
}

export async function createCreditRepaymentIntent(
  saleId: string,
  amount: number,
  idempotencyKey: string
): Promise<PaymentIntentResponseDto> {
  const response = await apiClient.post<PaymentIntentResponseDto>(
    `/api/v1/sales/${saleId}/repayment-intents`,
    { amount: amount.toFixed(2), idempotency_key: idempotencyKey }
  );
  return response.data;
}

export async function retrySalePayment(saleId: string): Promise<{ status: string; message: string; payment_id: string }> {
  const response = await apiClient.post<{ status: string; message: string; payment_id: string }>(
    `/api/v1/sales/${saleId}/retry-payment`,
    {}
  );
  return response.data;
}
