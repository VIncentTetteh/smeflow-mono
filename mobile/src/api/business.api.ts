import { AxiosError } from 'axios';
import { apiClient } from './client';
import type {
  BusinessCreateDto,
  BusinessCreateResponseDto,
  BusinessDetailResponseDto,
  BusinessUpdateDto,
  DedicatedAccountProvisionResponseDto,
  MemberInviteDto,
  MemberResponseDto,
  MemberUpdateDto,
  MoMoAccountAddDto,
  MoMoAccountResponseDto,
  MoMoAccountUpdateDto,
  MoMoAccountVerifyDto,
  SuspensionAppealCreateDto,
  SuspensionAppealResponseDto,
} from '@/types/business';
import type { BusinessKYCResponseDto, BusinessKYCSubmitDto } from '@/types/kyc';

export interface DashboardSummaryDto {
  daily_summary: Record<string, unknown> | null;
  alerts: { items: unknown[]; unread_count: number };
  credit_score: Record<string, unknown> | null;
  tax_summary: Record<string, unknown> | null;
  low_stock_preview: unknown[];
  generated_at: string;
}

export async function getDashboardSummary(): Promise<DashboardSummaryDto> {
  const response = await apiClient.get<DashboardSummaryDto>('/api/v1/business/dashboard-summary');
  return response.data;
}

export async function createBusiness(
  body: BusinessCreateDto
): Promise<BusinessCreateResponseDto> {
  const response = await apiClient.post<BusinessCreateResponseDto>('/api/v1/business', body);
  return response.data;
}

export async function getBusiness(): Promise<BusinessDetailResponseDto> {
  const response = await apiClient.get<BusinessDetailResponseDto>('/api/v1/business/me');
  return response.data;
}

export async function updateBusiness(
  body: BusinessUpdateDto
): Promise<BusinessDetailResponseDto> {
  const response = await apiClient.patch<BusinessDetailResponseDto>('/api/v1/business/me', body);
  return response.data;
}

export async function provisionDedicatedAccount(): Promise<DedicatedAccountProvisionResponseDto> {
  const response = await apiClient.post<DedicatedAccountProvisionResponseDto>('/api/v1/business/dva/provision');
  return response.data;
}

export async function submitSuspensionAppeal(
  body: SuspensionAppealCreateDto
): Promise<SuspensionAppealResponseDto> {
  const response = await apiClient.post<SuspensionAppealResponseDto>(
    '/api/v1/business/support/appeal',
    body
  );
  return response.data;
}

export async function listMembers(): Promise<MemberResponseDto[]> {
  const response = await apiClient.get<MemberResponseDto[]>('/api/v1/business/members');
  return response.data;
}

export async function inviteMember(body: MemberInviteDto): Promise<MemberResponseDto> {
  const response = await apiClient.post<MemberResponseDto>('/api/v1/business/members/invite', body);
  return response.data;
}

export async function updateMember(
  memberId: string,
  body: MemberUpdateDto
): Promise<MemberResponseDto> {
  const response = await apiClient.patch<MemberResponseDto>(
    `/api/v1/business/members/${memberId}`,
    body
  );
  return response.data;
}

export async function deactivateMember(memberId: string): Promise<void> {
  await apiClient.delete(`/api/v1/business/members/${memberId}`);
}

export async function listMomoAccounts(): Promise<MoMoAccountResponseDto[]> {
  const response = await apiClient.get<MoMoAccountResponseDto[]>('/api/v1/business/momo-accounts');
  return response.data;
}

export async function addMomoAccount(
  body: MoMoAccountAddDto
): Promise<MoMoAccountResponseDto> {
  const response = await apiClient.post<MoMoAccountResponseDto>(
    '/api/v1/business/momo-accounts',
    body
  );
  return response.data;
}

export async function updateMomoAccount(
  accountId: string,
  body: MoMoAccountUpdateDto
): Promise<MoMoAccountResponseDto> {
  const response = await apiClient.patch<MoMoAccountResponseDto>(
    `/api/v1/business/momo-accounts/${accountId}`,
    body
  );
  return response.data;
}

export async function deleteMomoAccount(accountId: string): Promise<void> {
  await apiClient.delete(`/api/v1/business/momo-accounts/${accountId}`);
}

export async function setPrimaryMomoAccount(accountId: string): Promise<MoMoAccountResponseDto> {
  const response = await apiClient.post<MoMoAccountResponseDto>(
    `/api/v1/business/momo-accounts/${accountId}/set-primary`,
    {}
  );
  return response.data;
}

export async function verifyMomoAccount(
  accountId: string,
  body: MoMoAccountVerifyDto
): Promise<MoMoAccountResponseDto> {
  const response = await apiClient.post<MoMoAccountResponseDto>(
    `/api/v1/business/momo-accounts/${accountId}/verify`,
    body
  );
  return response.data;
}

export async function getBusinessKyc(): Promise<BusinessKYCResponseDto | null> {
  try {
    const response = await apiClient.get<BusinessKYCResponseDto>('/api/v1/kyc/me');
    return response.data;
  } catch (error) {
    const status = error instanceof AxiosError
      ? error.response?.status
      : (error as { status?: number } | null)?.status;
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

export async function submitBusinessKyc(
  body: BusinessKYCSubmitDto
): Promise<BusinessKYCResponseDto> {
  const response = await apiClient.post<BusinessKYCResponseDto>('/api/v1/kyc/submit', {
    ...body,
    documents: body.documents ?? {},
  });
  return response.data;
}
