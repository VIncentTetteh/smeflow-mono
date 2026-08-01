'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface Employee {
  id: string;
  name: string;
  phone: string | null;
  role: string | null;
  pay_type: string;
  base_pay: string;
  momo_phone: string | null;
  is_active: boolean;
  ssnit_number: string | null;
  tin: string | null;
}

export interface PayrollRun {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  total_gross: string;
  total_ssnit_employee: string;
  total_ssnit_employer: string;
  total_income_tax: string;
  total_deductions: string;
  total_net: string;
  created_at: string;
  completed_at: string | null;
}

export interface Payslip {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  gross_pay: string;
  ssnit_employee: string;
  income_tax: string;
  other_deductions: string;
  net_pay: string;
  payment_id: string | null;
  pdf_url: string | null;
}

const PR = ['store', 'payroll'] as const;

export function useEmployees() {
  return useQuery({
    queryKey: [...PR, 'employees'],
    queryFn: async () => (await apiClient.get<Employee[]>('/payroll/employees')).data,
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      base_pay: number;
      pay_type?: string;
      phone?: string;
      role?: string;
      momo_phone?: string;
      ssnit_number?: string;
      tin?: string;
    }) => apiClient.post('/payroll/employees', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PR, 'employees'] }),
  });
}

export function usePayrollRuns() {
  return useQuery({
    queryKey: [...PR, 'runs'],
    queryFn: async () => (await apiClient.get<PayrollRun[]>('/payroll/runs')).data,
  });
}

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { period_start: string; period_end: string }) =>
      apiClient.post('/payroll/runs', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PR, 'runs'] }),
  });
}

export function usePayslips(runId: string | null) {
  return useQuery({
    queryKey: [...PR, 'payslips', runId],
    enabled: !!runId,
    queryFn: async () => (await apiClient.get<Payslip[]>(`/payroll/runs/${runId}/payslips`)).data,
  });
}

export function useDisburseRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => apiClient.post(`/payroll/runs/${runId}/disburse`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PR] }),
  });
}
