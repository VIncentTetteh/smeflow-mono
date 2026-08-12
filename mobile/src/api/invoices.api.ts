import { apiClient } from './client';
import type {
  DebitNoteCreateDto,
  InvoiceResponseDto,
  InvoiceSendChannel,
  InvoiceSendResponseDto,
  PaginatedInvoicesDto,
  StandaloneInvoiceCreateDto,
} from '@/types/invoices';

export interface InvoiceListParams {
  status?: string;
  invoice_type?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  page_size?: number;
}

export async function listInvoices(params?: InvoiceListParams): Promise<PaginatedInvoicesDto> {
  const response = await apiClient.get<PaginatedInvoicesDto>('/api/v1/invoices', { params });
  return response.data;
}

export async function generateInvoice(
  body: StandaloneInvoiceCreateDto
): Promise<InvoiceResponseDto> {
  const response = await apiClient.post<InvoiceResponseDto>('/api/v1/invoices/generate', body);
  return response.data;
}

export async function getInvoiceBySale(saleId: string): Promise<InvoiceResponseDto> {
  const response = await apiClient.get<InvoiceResponseDto>(`/api/v1/invoices/by-sale/${saleId}`);
  return response.data;
}

export async function getInvoice(invoiceId: string): Promise<InvoiceResponseDto> {
  const response = await apiClient.get<InvoiceResponseDto>(`/api/v1/invoices/${invoiceId}`);
  return response.data;
}

export async function voidInvoice(invoiceId: string): Promise<InvoiceResponseDto> {
  const response = await apiClient.post<InvoiceResponseDto>(
    `/api/v1/invoices/${invoiceId}/void`,
    {}
  );
  return response.data;
}

export async function createDebitNote(
  invoiceId: string,
  body: DebitNoteCreateDto
): Promise<InvoiceResponseDto> {
  const response = await apiClient.post<InvoiceResponseDto>(
    `/api/v1/invoices/${invoiceId}/debit-note`,
    body
  );
  return response.data;
}

export async function sendInvoice(
  invoiceId: string,
  channels?: InvoiceSendChannel[]
): Promise<InvoiceSendResponseDto> {
  const response = await apiClient.post<InvoiceSendResponseDto>(
    `/api/v1/invoices/${invoiceId}/send`,
    channels ? { channels } : {}
  );
  return response.data;
}
