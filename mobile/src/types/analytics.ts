import type { DecimalString, UUID } from './common';

export interface RevenuePointDto {
  day?: string;
  date?: string;
  period?: string;
  revenue?: DecimalString;
  total_revenue?: DecimalString;
}

export interface PnLDto {
  revenue: number;
  net_revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
}

export interface CashFlowDto {
  from_date: string;
  to_date: string;
  cash_inflow: number;
  momo_inflow: number;
  total_inflow: number;
  outstanding_credit: number;
  total_sales: number;
}

export interface TopCustomerDto {
  customer_id: UUID;
  name: string;
  phone: string | null;
  purchase_count: number;
  total_spent: number;
  outstanding: number;
}

export interface ExportJobDto {
  job_id: string;
  status: string;
  download_url?: string | null;
}
