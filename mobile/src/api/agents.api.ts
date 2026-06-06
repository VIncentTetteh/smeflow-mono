import { apiClient } from './client';
import { normalizeGhanaPhone } from '@/lib/phone';
import type {
  AgentCommissionListDto,
  AgentDashboardDto,
  AgentPayoutHistoryListDto,
  AgentReferralCodeDto,
  AgentTraderDetailDto,
  AgentTraderListDto,
  AgentWalletDto,
  AgentWithdrawRequestDto,
  AgentWithdrawResponseDto,
  OnboardTraderPayload,
  OnboardTraderResultDto,
} from '@/types/agents';

export async function getAgentDashboard(): Promise<AgentDashboardDto> {
  const response = await apiClient.get<AgentDashboardDto>('/api/v1/agents/dashboard');
  return response.data;
}

export async function listAgentTraders(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<AgentTraderListDto> {
  const response = await apiClient.get<AgentTraderListDto>('/api/v1/agents/traders', { params });
  return response.data;
}

export async function getAgentTraderDetail(businessId: string): Promise<AgentTraderDetailDto> {
  const response = await apiClient.get<AgentTraderDetailDto>(`/api/v1/agents/traders/${businessId}`);
  return response.data;
}

export async function listAgentCommissions(params?: {
  status?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}): Promise<AgentCommissionListDto> {
  const response = await apiClient.get<AgentCommissionListDto>('/api/v1/agents/commissions', { params });
  return response.data;
}

export async function getAgentWallet(): Promise<AgentWalletDto> {
  const response = await apiClient.get<AgentWalletDto>('/api/v1/agents/wallet');
  return response.data;
}

export async function listAgentWalletCommissions(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<AgentCommissionListDto> {
  const response = await apiClient.get<AgentCommissionListDto>('/api/v1/agents/wallet/commissions', {
    params,
  });
  return response.data;
}

export async function listAgentPayoutHistory(params?: {
  limit?: number;
  offset?: number;
}): Promise<AgentPayoutHistoryListDto> {
  const response = await apiClient.get<AgentPayoutHistoryListDto>('/api/v1/agents/wallet/history', {
    params,
  });
  return response.data;
}

export async function withdrawAgentWallet(
  body: AgentWithdrawRequestDto
): Promise<AgentWithdrawResponseDto> {
  // Corrected endpoint — was /api/v1/payouts/withdraw (did not exist)
  const response = await apiClient.post<AgentWithdrawResponseDto>(
    '/api/v1/agents/withdraw',
    body
  );
  return response.data;
}

export async function getAgentReferralCode(): Promise<AgentReferralCodeDto> {
  const response = await apiClient.get<AgentReferralCodeDto>('/api/v1/agents/me/referral-code');
  return response.data;
}

/**
 * Full agent-assisted trader onboarding: creates user → business → wallet → (optional KYC) → complete.
 * Encapsulates all steps so the caller gets a single mutation.
 */
export async function onboardTraderFull(payload: OnboardTraderPayload): Promise<OnboardTraderResultDto> {
  const ownerPhone = normalizeGhanaPhone(payload.phone);
  const walletPhone = payload.walletPhone?.trim()
    ? normalizeGhanaPhone(payload.walletPhone)
    : ownerPhone;

  // Step 1 — create or resume trader user
  const startRes = await apiClient.post('/api/v1/agents/onboarding/start', {
    phone: ownerPhone,
    name: payload.ownerName || undefined,
  });
  const traderUserId: string = startRes.data.user_id;
  const isNewUser: boolean = startRes.data.is_new_user ?? false;

  // Step 2 — create business
  const bizRes = await apiClient.post('/api/v1/agents/onboarding/business', {
    trader_user_id: traderUserId,
    name: payload.businessName,
    type: payload.businessType,
    address: payload.address || undefined,
    referral_code: payload.referralCode || undefined,
  });
  const businessId: string = bizRes.data.business_id;

  // Step 3 — attach wallet
  await apiClient.post(`/api/v1/agents/onboarding/business/${businessId}/wallet`, {
    provider: 'mtn',
    phone: walletPhone,
    is_primary: true,
  });

  // Step 4 — submit KYC if credentials provided
  let kycSubmitted = false;
  if (payload.ghanaCard?.trim() || payload.tin?.trim()) {
    await apiClient.post(`/api/v1/agents/onboarding/business/${businessId}/kyc`, {
      ghana_card_id: payload.ghanaCard?.trim() || undefined,
      tin: payload.tin?.trim() || undefined,
      documents: [],
    });
    kycSubmitted = true;
  }

  // Step 5 — complete onboarding
  await apiClient.post(`/api/v1/agents/onboarding/business/${businessId}/complete`);

  return {
    businessId,
    traderUserId,
    businessName: payload.businessName,
    isNewUser,
    kycSubmitted,
  };
}
