import type { DecimalString, ISODateTime, UUID } from './common';

export interface CreditScoreFactors {
  revenue_30d?: number;
  revenue_90d?: number;
  transaction_count_90d?: number;
  consistency_score?: number;
  repayment_rate?: number;
  momo_velocity?: number;
  account_age_days?: number;
  inventory_turnover_ratio?: number;
  customer_retention_rate?: number;
  seasonal_trend_score?: number;
  digital_adoption_score?: number;
  component_scores?: Record<string, number>;
  ml_insights?: {
    risk_probability?: number;
    confidence_score?: number;
    model_used?: boolean;
  };
}

export interface CreditScoreResponseDto {
  id?: UUID;
  business_id?: UUID;
  value?: number;
  score?: number;
  band?: string;
  max_loan_amount?: DecimalString | null;
  factors?: CreditScoreFactors;
  created_at?: ISODateTime;
}

export interface LoanRequestCreateDto {
  amount_requested: DecimalString | number;
  term_days: number;
  target_lender_id?: string;
  loan_product_id?: string;
  disbursement_phone?: string;
}

export interface LoanRequestResponseDto {
  id: UUID;
  business_id?: UUID;
  credit_score_id?: UUID | null;
  amount_requested: DecimalString;
  amount_approved?: DecimalString | null;
  term_days?: number | null;
  interest_rate?: DecimalString | null;
  lender_id?: string | null;
  partner_ref?: string | null;
  rejection_reason?: string | null;
  disbursement_phone?: string | null;
  status: string;
  requested_at?: ISODateTime;
  decided_at?: ISODateTime | null;
  confirmed_at?: ISODateTime | null;
  disbursed_at?: ISODateTime | null;
  repaid_at?: ISODateTime | null;
  defaulted_at?: ISODateTime | null;
}

export interface RepaymentInstalmentResponseDto {
  id: UUID;
  loan_request_id: UUID;
  instalment_number: number;
  due_date: ISODateTime;
  amount: DecimalString;
  principal: DecimalString;
  interest: DecimalString;
  status: string;
  paid_at?: ISODateTime | null;
  payment_ref?: string | null;
  collection_attempts: number;
}

export interface LoanConfirmDto {
  otp: string;
}
