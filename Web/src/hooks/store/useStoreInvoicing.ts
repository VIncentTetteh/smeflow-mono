'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface Invoice {
  id: string;
  invoice_number: string;
  type: string;
  status: string;
  effective_status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  subtotal: string;
  vat_amount: string;
  total: string;
  amount_paid: string;
  balance_due: string;
  issued_at: string;
  due_date: string | null;
  pdf_url: string | null;
}

export type InvoiceSendChannel = 'whatsapp' | 'sms' | 'email';

export interface InvoiceSendResult {
  message: string;
  channels: InvoiceSendChannel[];
  results: Record<InvoiceSendChannel, { message_id: string; status: string }>;
}

export interface PaginatedInvoices {
  invoices: Invoice[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface InvoiceLineInput {
  description: string;
  qty: number;
  unit_price: number;
  unit?: string;
}

const INV = ['store', 'invoicing'] as const;

export function useInvoices(params?: { status?: string }) {
  return useQuery({
    queryKey: [...INV, 'list', params?.status ?? ''],
    queryFn: async () => {
      const res = await apiClient.get<PaginatedInvoices>('/invoices', {
        params: { status: params?.status || undefined },
      });
      return res.data;
    },
  });
}

export function useGenerateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      customer_name?: string;
      customer_phone?: string;
      customer_email?: string;
      customer_tin?: string;
      line_items: InvoiceLineInput[];
      due_date?: string;
    }) => apiClient.post('/invoices/generate', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV] }),
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/invoices/${id}/void`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...INV] }),
  });
}

export function useSendInvoice() {
  return useMutation({
    mutationFn: ({ id, channels }: { id: string; channels?: InvoiceSendChannel[] }) =>
      apiClient
        .post(`/invoices/${id}/send`, channels ? { channels } : {})
        .then((r) => r.data as InvoiceSendResult),
  });
}
