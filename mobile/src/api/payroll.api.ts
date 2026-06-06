import { apiClient } from './client';
import type { EmployeeDto, PayrollRunDto, PayslipDto } from '@/types/payroll';

export async function listEmployees(): Promise<EmployeeDto[]> {
  const response = await apiClient.get<EmployeeDto[]>('/api/v1/payroll/employees');
  return response.data;
}

export async function listPayrollRuns(): Promise<PayrollRunDto[]> {
  const response = await apiClient.get<PayrollRunDto[]>('/api/v1/payroll/runs');
  return response.data;
}

export async function runPayroll(body?: {
  period_start?: string;
  period_end?: string;
}): Promise<PayrollRunDto> {
  const response = await apiClient.post<PayrollRunDto>('/api/v1/payroll/runs', body ?? {});
  return response.data;
}

export async function createEmployee(body: {
  name: string;
  role: string;
  base_pay: number;
  momo_phone?: string;
  ssnit_number?: string;
  tin?: string;
}): Promise<EmployeeDto> {
  const response = await apiClient.post<EmployeeDto>('/api/v1/payroll/employees', body);
  return response.data;
}

export async function updateEmployee(
  id: string,
  body: { name?: string; role?: string; base_pay?: number; momo_phone?: string; is_active?: boolean }
): Promise<EmployeeDto> {
  const response = await apiClient.patch<EmployeeDto>(`/api/v1/payroll/employees/${id}`, body);
  return response.data;
}

export async function getRunPayslips(runId: string): Promise<PayslipDto[]> {
  const response = await apiClient.get<PayslipDto[]>(`/api/v1/payroll/runs/${runId}/payslips`);
  return response.data;
}

export interface PayslipPayResult {
  payslip_id: string;
  status: string;
  payment_id?: string | null;
  provider_reference?: string | null;
  message: string;
}

export async function payPayslip(payslipId: string): Promise<PayslipPayResult> {
  const response = await apiClient.post<PayslipPayResult>(
    `/api/v1/payroll/payslips/${payslipId}/pay`,
    {}
  );
  return response.data;
}

export async function approvePayrollRun(runId: string): Promise<PayrollRunDto> {
  const response = await apiClient.post<PayrollRunDto>(
    `/api/v1/payroll/runs/${runId}/approve`,
    {}
  );
  return response.data;
}

export async function downloadP9A(): Promise<{ url: string }> {
  const response = await apiClient.get<Record<string, unknown>>(
    '/api/v1/payroll/reports/p9a',
    { responseType: 'json' }
  );
  const url =
    (response.data?.url as string | undefined) ??
    (response.data?.download_url as string | undefined) ??
    (response.data?.export_url as string | undefined) ??
    `${apiClient.defaults.baseURL}/api/v1/payroll/reports/p9a`;
  return { url };
}

export async function downloadP9B(): Promise<{ url: string }> {
  const response = await apiClient.get<Record<string, unknown>>(
    '/api/v1/payroll/reports/p9b',
    { responseType: 'json' }
  );
  const url =
    (response.data?.url as string | undefined) ??
    (response.data?.download_url as string | undefined) ??
    (response.data?.export_url as string | undefined) ??
    `${apiClient.defaults.baseURL}/api/v1/payroll/reports/p9b`;
  return { url };
}
