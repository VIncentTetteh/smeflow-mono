import type { DecimalString, ISODateTime, UUID } from './common';

export interface EmployeeDto {
  id: UUID;
  name?: string;
  phone?: string | null;
  momo_phone?: string | null;
  role?: string | null;
  base_pay?: DecimalString;
  pay_type?: string;
  is_active?: boolean;
  ssnit_number?: string | null;
  tin?: string | null;
  tier2_enrolled?: boolean;
  tier2_rate?: DecimalString;
  tier2_provider?: string | null;
}

export interface PayrollRunDto {
  id: UUID;
  status?: string;
  total_gross?: DecimalString;
  total_net?: DecimalString;
  total_deductions?: DecimalString;
  total_ssnit_employee?: DecimalString;
  total_income_tax?: DecimalString;
  period_start?: ISODateTime;
  period_end?: ISODateTime;
}

export interface PayslipDto {
  id: UUID;
  payroll_run_id: UUID;
  employee_id: UUID;
  gross_pay: DecimalString;
  ssnit_employee: DecimalString;
  ssnit_employer: DecimalString;
  tier2_employee: DecimalString;
  income_tax: DecimalString;
  other_deductions: DecimalString;
  net_pay: DecimalString;
  payment_id?: UUID | null;
  pdf_url?: string | null;
  created_at: ISODateTime;
}

export interface PayrollWorkspaceDto {
  employees: EmployeeDto[];
  runs: PayrollRunDto[];
}
