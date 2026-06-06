import { apiClient } from './client';
import type { InputVATCreateDto, InputVATRecordDto, TaxCalendarEntryDto, TaxFileResponseDto, TaxRateConfigDto, TaxReturnDto, TaxSummaryDto } from '@/types/tax';

export async function getTaxSummary(params: {
  year: number;
  month: number;
}): Promise<TaxSummaryDto> {
  const response = await apiClient.get<TaxSummaryDto>('/api/v1/tax/summary', { params });
  return response.data;
}

export async function listTaxReturns(): Promise<TaxReturnDto[]> {
  const response = await apiClient.get<TaxReturnDto[]>('/api/v1/tax/returns');
  return response.data;
}

export async function getTaxCalendar(params: {
  year: number;
  month: number;
}): Promise<TaxCalendarEntryDto[]> {
  const response = await apiClient.get<TaxCalendarEntryDto[]>('/api/v1/tax/calendar', { params });
  return response.data;
}

export async function generateTaxReturn(params: { year: number; month: number }): Promise<TaxReturnDto> {
  const response = await apiClient.post<TaxReturnDto>('/api/v1/tax/returns/generate', params);
  return response.data;
}

export async function fileTaxReturn(returnId: string): Promise<TaxFileResponseDto> {
  const response = await apiClient.post<TaxFileResponseDto>(`/api/v1/tax/returns/${returnId}/file`, {});
  return response.data;
}

export async function recordInputVAT(body: InputVATCreateDto): Promise<InputVATRecordDto> {
  const response = await apiClient.post<InputVATRecordDto>('/api/v1/tax/input-vat', body);
  return response.data;
}

export async function exportTaxReturn(returnId: string): Promise<{ export_url?: string; id?: string; status?: string; payload?: object }> {
  const response = await apiClient.get<{ export_url?: string; id?: string; status?: string; payload?: object }>(`/api/v1/tax/returns/${returnId}/export`);
  return response.data;
}

export async function getTaxRates(): Promise<TaxRateConfigDto> {
  const response = await apiClient.get<TaxRateConfigDto>('/api/v1/tax/tax-rates');
  return response.data;
}

export async function listInputVAT(): Promise<InputVATRecordDto[]> {
  const response = await apiClient.get<InputVATRecordDto[]>('/api/v1/tax/input-vat');
  return response.data;
}
