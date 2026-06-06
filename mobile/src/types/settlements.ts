import type { DecimalString, ISODateTime, UUID } from './common';

export type SettlementLedgerEntryType = 'credit' | 'fee' | 'debit' | 'reversal' | 'adjustment';
export type MerchantSettlementStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MerchantSettlementBalanceDto {
  business_id: UUID;
  unsettled_balance: DecimalString;
  total_settled: DecimalString;
  settlement_threshold: DecimalString;
  settlement_enabled: boolean;
  last_settled_at?: ISODateTime | null;
  plan?: string;
  fee_rate_percent?: number;
  pending_settlement_count: number;
  eligible_for_auto_settlement: boolean;
  next_auto_settlement_date?: ISODateTime | null;
  min_settlement_ghs?: DecimalString;
  auto_approve_ceiling_ghs?: DecimalString;
}

export interface MerchantLedgerEntryDto {
  id: UUID;
  type: SettlementLedgerEntryType | string;
  amount: DecimalString;
  balance_after: DecimalString;
  description?: string | null;
  created_at: ISODateTime;
  payment_id?: UUID | null;
  settlement_id?: UUID | null;
  fee_rate_percent?: number | null;
  fee_deducted_ghs?: DecimalString | null;
}

export interface MerchantLedgerResponseDto {
  total: number;
  items: MerchantLedgerEntryDto[];
  fee_rate_percent?: number;
  page_fee_total_ghs?: DecimalString;
}

export interface MerchantSettlementDto {
  id: UUID;
  amount: DecimalString;
  fee_amount: DecimalString;
  net_amount: DecimalString;
  status: MerchantSettlementStatus | string;
  mode?: string;
  destination_phone?: string | null;
  destination_provider?: string | null;
  paystack_transfer_code?: string | null;
  failure_reason?: string | null;
  requested_at?: ISODateTime;
  approved_at?: ISODateTime | null;
  completed_at?: ISODateTime | null;
  created_at?: ISODateTime;
}

export interface MerchantSettlementHistoryResponseDto {
  total: number;
  items: MerchantSettlementDto[];
}

export interface MerchantSettlementRequestDto {
  amount: DecimalString;
}

export interface MerchantSettlementRequestResponseDto {
  settlement_id: UUID;
  status: MerchantSettlementStatus | string;
  amount: DecimalString;
  fee_amount: DecimalString;
  net_amount: DecimalString;
  destination_phone?: string | null;
  destination_provider?: string | null;
  message: string;
}
