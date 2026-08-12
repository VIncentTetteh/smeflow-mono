import type { DecimalString, ISODateTime, UUID } from './common';

export interface InvoiceLineItemResponseDto {
  id: UUID;
  description: string;
  qty: DecimalString;
  unit: string | null;
  unit_price: DecimalString;
  line_total: DecimalString;
  vat_rate: DecimalString;
  vat_amount: DecimalString;
}

export interface InvoiceResponseDto {
  id: UUID;
  sale_id: UUID | null;
  original_invoice_id: UUID | null;
  invoice_number: string;
  type: string;
  status: string;
  supplier_name: string;
  supplier_tin: string | null;
  supplier_address: string | null;
  customer_name: string | null;
  customer_tin: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  subtotal: DecimalString;
  vat_amount: DecimalString;
  nhil_amount: DecimalString;
  getfund_amount: DecimalString;
  covid_levy: DecimalString;
  total: DecimalString;
  qr_payload: string | null;
  qr_image_url: string | null;
  ghqr_payload: string | null;
  ghqr_image_url: string | null;
  digital_signature: string | null;
  pdf_url: string | null;
  verification_id: string | null;
  issued_at: ISODateTime;
  paid_at: ISODateTime | null;
  due_date: ISODateTime | null;
  amount_paid: DecimalString;
  balance_due: DecimalString;
  effective_status: string;
  paystack_payment_url?: string | null;
  line_items: InvoiceLineItemResponseDto[];
}

export interface PaginatedInvoicesDto {
  invoices: InvoiceResponseDto[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface InvoiceLineItemInputDto {
  description: string;
  qty: DecimalString;
  unit_price: DecimalString;
  unit?: string | null;
}

export interface StandaloneInvoiceCreateDto {
  supplier_name?: string | null;
  supplier_tin?: string | null;
  supplier_address?: string | null;
  customer_name?: string | null;
  customer_tin?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  invoice_type?: 'invoice' | 'proforma' | 'debit_note';
  line_items: InvoiceLineItemInputDto[];
}

export interface DebitNoteCreateDto {
  line_items: InvoiceLineItemInputDto[];
}

export type InvoiceSendChannel = 'whatsapp' | 'sms' | 'email';

export interface InvoiceSendResponseDto {
  message: string;
  channels: InvoiceSendChannel[];
  results: Record<InvoiceSendChannel, { message_id: UUID; status: string }>;
}
