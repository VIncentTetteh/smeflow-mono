import { apiClient } from './client';
import type { RevenuePointDto } from '@/types/analytics';
import type { CashFlowDto, ExportJobDto, PnLDto, TopCustomerDto } from '@/types/analytics';

export async function getRevenue(params: {
  period?: string;
  group_by?: string;
}): Promise<RevenuePointDto[]> {
  const response = await apiClient.get<RevenuePointDto[]>('/api/v1/analytics/revenue', {
    params,
  });
  return response.data;
}

export async function getPnL(params: {
  from_date: string;
  to_date: string;
}): Promise<PnLDto> {
  const response = await apiClient.get<PnLDto>('/api/v1/analytics/pnl', { params });
  return response.data;
}

export async function getCashFlow(params: {
  from_date: string;
  to_date: string;
}): Promise<CashFlowDto> {
  const response = await apiClient.get<CashFlowDto>('/api/v1/analytics/cash-flow', { params });
  return response.data;
}

export async function getTopCustomers(params: {
  from_date: string;
  to_date: string;
  limit?: number;
}): Promise<TopCustomerDto[]> {
  const response = await apiClient.get<TopCustomerDto[]>('/api/v1/analytics/customers/top', {
    params: { ...params, limit: params.limit ?? 10 },
  });
  return response.data;
}

export async function getCustomerAnalytics(params: {
  period: string;
  limit?: number;
}): Promise<TopCustomerDto[]> {
  const response = await apiClient.get<TopCustomerDto[]>('/api/v1/analytics/customers', {
    params: { ...params, limit: params.limit ?? 10, sort: 'revenue' },
  });
  return response.data;
}

export async function exportAnalytics(body: {
  report: string;
  format: string;
  group_by: string;
  from_date: string;
  to_date: string;
}): Promise<ExportJobDto> {
  const response = await apiClient.post<ExportJobDto>('/api/v1/analytics/export', body);
  return response.data;
}

export async function getExportDownload(params: {
  job_id: string;
}): Promise<ExportJobDto> {
  const response = await apiClient.get<ExportJobDto>('/api/v1/analytics/export/download', {
    params,
  });
  return response.data;
}

export interface PredictiveRestockItemDto {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  days_until_stockout: number;
  avg_daily_sales: number;
}

export async function getPredictiveRestock(params?: {
  days_ahead?: number;
}): Promise<PredictiveRestockItemDto[]> {
  const response = await apiClient.get<PredictiveRestockItemDto[]>(
    '/api/v1/analytics/inventory/alerts/predictive-restock',
    { params: { days_ahead: params?.days_ahead ?? 7 } }
  );
  return response.data;
}

export interface TopItemDto {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  total_revenue: number;
  total_qty: number;
}

export async function getTopItems(params: {
  from_date: string;
  to_date: string;
  limit?: number;
}): Promise<TopItemDto[]> {
  const response = await apiClient.get<
    Array<{
      item_id?: string | null;
      description?: string;
      total_qty?: number;
      total_revenue?: number;
    }>
  >('/api/v1/analytics/items/top', { params: { ...params, limit: params.limit ?? 10 } });
  // The endpoint returns `description`/`item_id`; the UI expects `name`/`id`.
  return response.data.map((r) => ({
    id: r.item_id ?? '',
    name: r.description ?? '',
    total_qty: Number(r.total_qty ?? 0),
    total_revenue: Number(r.total_revenue ?? 0),
  }));
}
