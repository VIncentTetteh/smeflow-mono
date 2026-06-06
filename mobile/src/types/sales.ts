import type { DecimalString, ISODateTime, UUID } from './common';

export type SalePaymentMethod = 'cash' | 'momo' | 'paystack' | 'credit' | 'mixed' | 'ghqr';
export type SinglePaymentMethod = 'cash' | 'momo' | 'credit';

export interface PaymentLegDto {
  method: SinglePaymentMethod;
  amount: DecimalString;
  phone?: string;
}

export interface SaleItemInputDto {
  item_id?: UUID | null;
  description?: string | null;
  qty: DecimalString;
  unit_price: DecimalString;
  discount?: DecimalString;
}

export interface SaleCreateDto {
  items: SaleItemInputDto[];
  payment_method: SalePaymentMethod;
  payment_provider?: 'mtn' | 'telecel' | 'vodafone' | 'airteltigo' | null;
  payment_splits?: PaymentLegDto[];
  customer_phone?: string | null;
  customer_name?: string | null;
  credit_due_date?: string | null;
  reminder_consent?: boolean;
  reminder_channel?: 'whatsapp' | 'sms' | null;
  discount_amount?: DecimalString;
  notes?: string | null;
  idempotency_key: string;
  client_created_at?: ISODateTime;
}

export interface SaleItemResponseDto {
  id: UUID;
  item_id: UUID | null;
  description: string;
  qty: DecimalString;
  unit_price: DecimalString;
  line_total: DecimalString;
  vat_amount: DecimalString;
}

export interface SaleResponseDto {
  id: UUID;
  status: string;
  payment_method: SalePaymentMethod | string;
  subtotal: DecimalString;
  tax_amount: DecimalString;
  discount_amount: DecimalString;
  total: DecimalString;
  amount_paid: DecimalString;
  balance_due: DecimalString;
  notes: string | null;
  customer_id: UUID | null;
  customer_phone?: string | null;
  credit_due_date?: ISODateTime | null;
  payment_status?: string | null;
  payment_provider_message?: string | null;
  created_at: ISODateTime;
  items: SaleItemResponseDto[];
}

export interface SaleRecordResponseDto {
  sale_id: UUID;
  invoice_id: UUID | null;
  qr_image_url: string | null;
  payment_request_id: string | null;
  total: DecimalString;
  balance_due: DecimalString;
  message: string;
}

export interface PaymentIntentResponseDto {
  payment_id: UUID;
  external_ref: string | null;
  status: string;
  total: DecimalString;
  expires_at?: ISODateTime | null;
  provider_message?: string | null;
  sale_id?: UUID | null;
  invoice_id?: UUID | null;
  balance_due?: DecimalString | null;
  payment_url?: string | null;
  qr_image_url?: string | null;
  channel?: string | null;
  provider_detail?: string | null;
  message: string;
}

export type MomoSaleIntentResponseDto = PaymentIntentResponseDto;

export interface DailySummaryDto {
  date: string;
  total_sales: number;
  total_revenue: DecimalString;
  cash_revenue: DecimalString;
  momo_revenue: DecimalString;
  credit_revenue: DecimalString;
  top_items: Array<{ description: string; qty: DecimalString; revenue: DecimalString }>;
}

export interface PeriodSummaryDto extends Omit<DailySummaryDto, 'date' | 'top_items'> {
  from_date: string;
  to_date: string;
  outstanding_credit: DecimalString;
}

export interface CustomerListItemDto {
  id: UUID;
  name: string | null;
  phone: string | null;
  purchase_count: number;
  lifetime_value: DecimalString;
  outstanding_credit: DecimalString;
  last_purchase_at: ISODateTime | null;
  since: ISODateTime;
}

export interface CustomerListResponseDto {
  total: number;
  items: CustomerListItemDto[];
}

export interface CustomerStatsDto {
  purchase_count: number;
  lifetime_value: DecimalString;
  total_paid: DecimalString;
  outstanding_credit: DecimalString;
  last_purchase_at: ISODateTime | null;
}

export interface CustomerRecentSaleDto {
  id: UUID;
  total: DecimalString;
  payment_method: string;
  status: string;
  created_at: ISODateTime;
}

export interface CustomerDetailResponseDto {
  id: UUID;
  name: string | null;
  phone: string | null;
  since: ISODateTime;
  stats: CustomerStatsDto;
  top_items: Array<{ description: string; total_qty: DecimalString; total_revenue: DecimalString }>;
  recent_sales: CustomerRecentSaleDto[];
}

export interface RecordPaymentDto {
  amount: DecimalString;
  payment_method: SalePaymentMethod;
  notes?: string | null;
}

export interface BatchSyncPayloadDto {
  sales: SaleCreateDto[];
}
