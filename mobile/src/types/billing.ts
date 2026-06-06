import type { DecimalString, ISODateTime, UUID } from './common';

export interface PlanInfoDto {
  id?: string;
  name: string;
  price?: DecimalString;
  price_ghs?: DecimalString;
  annual_price_ghs?: DecimalString;
  currency?: string;
  interval?: string;
  billing_intervals?: string[];
  support_sla?: string | null;
  features?: string[];
  sale_limit?: number | null;
  staff_limit?: number | null;
  monthly_sales?: number | null;
  items?: number | null;
  item_categories?: number | null;
  customers?: number | null;
  invoices?: number | null;
  monthly_invoices?: number | null;
  employees?: number | null;
  team_members?: number | null;
  users?: number | null;
  ai_messages?: number | null;
  businesses?: number | null;
  included_businesses?: number | null;
  extra_business_price_ghs?: DecimalString | null;
  field_agents?: number | null;
  languages?: string[];
  analytics?: boolean | 'basic' | 'full';
  credit_scoring?: boolean;
  tax_summary?: boolean;
  gra_submission?: boolean;
  export?: boolean;
  invoice_pdf?: boolean;
  invoice_templates?: string | null;
  recurring_invoices?: boolean;
  bulk_csv_import?: boolean;
  bulk_momo_payout?: boolean;
  cost_margin_tracking?: boolean;
  business_insights?: boolean;
  api_access?: boolean;
}

export interface SubscriptionResponseDto {
  business_id?: UUID;
  plan?: string;
  billing_interval?: 'monthly' | 'annual';
  status?: string;
  current_period_end?: ISODateTime | null;
  cancel_at_period_end?: boolean;
}

export interface BillingTransactionDto {
  id: UUID;
  amount?: DecimalString;
  status?: string;
  provider?: string;
  created_at?: ISODateTime;
}

export interface BillingInvoiceDto {
  id: UUID;
  amount?: DecimalString;
  status?: string;
  issued_at?: ISODateTime;
}

export interface BillingUsageDto {
  monthly_sales?: number;
  items?: number;
  employees?: number;
  team_members?: number;
  customers?: number;
  monthly_invoices?: number;
  ai_messages?: number;
  businesses?: number;
  field_agents?: number;
}

export interface BillingLimitsDto {
  monthly_sales?: number | null;
  items?: number | null;
  employees?: number | null;
  team_members?: number | null;
  customers?: number | null;
  monthly_invoices?: number | null;
  ai_messages?: number | null;
  businesses?: number | null;
  included_businesses?: number | null;
  field_agents?: number | null;
  languages?: string[];
  analytics?: boolean | 'basic' | 'full';
  credit_scoring?: boolean;
  tax_summary?: boolean;
  gra_submission?: boolean;
  invoice_pdf?: boolean;
  invoices?: number | null;
  bulk_csv_import?: boolean;
  bulk_momo_payout?: boolean;
  recurring_invoices?: boolean;
  cost_margin_tracking?: boolean;
  business_insights?: boolean;
  export?: boolean;
}

export interface BillingPlanUsageDto {
  subscription?: SubscriptionResponseDto;
  plan?: string;
  billing_interval?: 'monthly' | 'annual';
  status?: string;
  usage?: BillingUsageDto;
  limits?: BillingLimitsDto;
  current_period_end?: ISODateTime | null;
}
