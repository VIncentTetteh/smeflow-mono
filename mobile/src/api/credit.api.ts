import { apiClient } from './client';
import type {
  CreditScoreResponseDto,
  LoanConfirmDto,
  LoanRequestCreateDto,
  LoanRequestResponseDto,
  RepaymentInstalmentResponseDto,
} from '@/types/credit';

export async function getCreditScore(): Promise<CreditScoreResponseDto> {
  const response = await apiClient.get<CreditScoreResponseDto>('/api/v1/credit/score');
  return response.data;
}

export async function getCreditScoreHistory(): Promise<CreditScoreResponseDto[]> {
  const response = await apiClient.get<CreditScoreResponseDto[]>('/api/v1/credit/score/history');
  return response.data;
}

export async function requestLoan(body: LoanRequestCreateDto): Promise<LoanRequestResponseDto> {
  const response = await apiClient.post<LoanRequestResponseDto>('/api/v1/credit/request', body);
  return response.data;
}

export async function listLoanRequests(): Promise<LoanRequestResponseDto[]> {
  const response = await apiClient.get<LoanRequestResponseDto[]>('/api/v1/credit/requests');
  return response.data;
}

export async function getLoan(loanId: string): Promise<LoanRequestResponseDto> {
  const response = await apiClient.get<LoanRequestResponseDto>(`/api/v1/credit/loans/${loanId}`);
  return response.data;
}

export async function getLoanSchedule(
  loanId: string
): Promise<RepaymentInstalmentResponseDto[]> {
  const response = await apiClient.get<RepaymentInstalmentResponseDto[]>(
    `/api/v1/credit/loans/${loanId}/schedule`
  );
  return response.data;
}

export async function resendLoanConfirmation(loanId: string): Promise<{ message: string }> {
  const response = await apiClient.post<{ message: string }>(
    `/api/v1/credit/loans/${loanId}/confirm/resend`,
    {}
  );
  return response.data;
}

export async function confirmLoan(
  loanId: string,
  body: LoanConfirmDto
): Promise<LoanRequestResponseDto> {
  const response = await apiClient.post<LoanRequestResponseDto>(
    `/api/v1/credit/loans/${loanId}/confirm`,
    body
  );
  return response.data;
}

export interface LoanProduct {
  id: string;
  lender_id: string;
  name: string;
  description: string;
  min_amount_ghs: number;
  max_amount_ghs: number;
  interest_rate_annual: number;
  min_term_days: number;
  max_term_days: number;
  min_credit_band: string;
  is_active: boolean;
}

export interface LenderWithProducts {
  lender_id: string;
  name: string;
  contact_email: string | null;
  products: LoanProduct[];
}

export async function getActiveLenders(): Promise<LenderWithProducts[]> {
  const response = await apiClient.get('/api/v1/credit/lenders');
  return response.data;
}
