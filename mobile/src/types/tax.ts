import type { DecimalString, ISODateTime, UUID } from './common';

export interface TaxSummaryDto {
  month?: number;
  year?: number;
  period?: string;
  vat_output?: DecimalString;
  vat_input?: DecimalString;
  vat_payable?: DecimalString;
  nhil?: DecimalString;
  getfund?: DecimalString;
  covid_levy?: DecimalString;
  total_tax?: DecimalString;
  status?: string;
  paye_withheld?: DecimalString;
  estimated_income_tax?: DecimalString;
  estimated_vat_payable?: DecimalString;
  due_date?: string | null;
  filing_readiness?: {
    has_generated_return?: boolean;
    has_gra_ref?: boolean;
    can_file?: boolean;
  };
}

export interface TaxReturnDto {
  id: UUID;
  period_type?: string;
  period_start?: string;
  period_end?: string;
  status?: string;
  total_tax?: DecimalString;
  vat_output?: DecimalString;
  vat_input?: DecimalString;
  vat_payable?: DecimalString;
  nhil_amount?: DecimalString;
  getfund_amount?: DecimalString;
  covid_levy?: DecimalString;
  gra_ref?: string | null;
  export_url?: string | null;
  submitted_at?: ISODateTime | null;
  created_at?: ISODateTime;
  payload_json?: Record<string, unknown> | null;
}

export interface TaxFileResponseDto {
  id: UUID;
  status: string;
  gra_ref?: string | null;
  export_url: string;
  /** True when ENABLE_GRA_DIRECT_FILING=false on the server. The return was NOT submitted to GRA. */
  is_dry_run: boolean;
}

export interface TaxCalendarEntryDto {
  id?: UUID;
  tax_type?: string;
  period?: string;
  due_date?: string;
  description?: string;
}

export interface InputVATRecordDto {
  id: UUID;
  supplier_name: string;
  supplier_tin?: string | null;
  invoice_ref?: string | null;
  purchase_date: string;
  subtotal: DecimalString;
  vat_amount: DecimalString;
  total: DecimalString;
  created_at?: ISODateTime;
}

export interface InputVATCreateDto {
  supplier_name: string;
  supplier_tin?: string;
  invoice_ref?: string;
  purchase_date: string;
  subtotal: number;
  vat_amount: number;
  notes?: string;
}

export interface TaxWorkspaceDto {
  summary: TaxSummaryDto;
  returns: TaxReturnDto[];
  calendar: TaxCalendarEntryDto[];
}

export interface TaxRateConfigDto {
  /** e.g. 0.15 for 15% */
  vat: number;
  /** e.g. 0.025 for 2.5% */
  nhil: number;
  /** e.g. 0.01 for 1% */
  getfund: number;
  /** e.g. 0.01 for 1% */
  covid_levy: number;
}
