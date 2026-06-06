import type { DecimalString, ISODateTime, UUID } from './common';

export interface PaymentResponseDto {
  id: UUID;
  business_id?: UUID;
  type?: string;
  provider?: string;
  processor?: string | null;
  channel?: string | null;
  provider_detail?: string | null;
  amount: DecimalString;
  currency?: string;
  status: string;
  external_ref?: string | null;
  provider_ref?: string | null;
  invoice_id?: UUID | null;
  sale_id?: UUID | null;
  phone?: string | null;
  confirmed_at?: ISODateTime | null;
  created_at?: ISODateTime;
}

export interface PaymentChannelAnalyticsDto {
  grand_total: DecimalString;
  items: Array<{
    processor: string;
    channel: string;
    provider_detail?: string | null;
    count: number;
    total: DecimalString;
  }>;
}

export interface PaymentListResponseDto {
  items?: PaymentResponseDto[];
  total?: number;
}

export type PaymentMatchState =
  | 'unmatched'
  | 'suggested_match'
  | 'matched'
  | 'ignored'
  | 'refunded';

export interface PaymentReconciliationItemDto extends PaymentResponseDto {
  match_state: PaymentMatchState;
  suggested_match_type?: 'sale' | 'invoice' | 'customer_credit' | 'cashbook' | null;
}

export interface PaymentReconciliationInboxDto {
  items: PaymentReconciliationItemDto[];
  total: number;
  limit: number;
  offset: number;
  summary: Record<PaymentMatchState, number>;
}

export interface PaymentRequestDto {
  amount: DecimalString;
  phone: string;
  provider: string;
  reference?: string;
  description?: string;
}

export interface PaymentDisburseDto {
  amount: DecimalString;
  phone: string;
  provider: string;
  reference?: string;
  description?: string;
}

export interface GHQRGenerateDto {
  amount?: DecimalString | null;
  invoice_id?: UUID | null;
  reference?: string;
  description?: string;
}

export interface GHQRGenerateResponseDto {
  qr_payload?: string;
  qr_image_url?: string;
  amount?: DecimalString | null;
  currency?: string;
  reference?: string;
}
