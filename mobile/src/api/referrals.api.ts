import { apiClient } from './client';

export interface ReferralCodeDto {
  referral_code: string;
  link?: string | null;
}

export interface ReferralStatusDto {
  referral_code: string;
  total_invited: number;
  converted: number;
  pending: number;
  reward_granted: boolean;
}

export const getReferralCode = (): Promise<ReferralCodeDto> =>
  apiClient.get('/api/v1/referrals/my-code').then((r) => r.data);

export const getReferralStatus = (): Promise<ReferralStatusDto> =>
  apiClient.get('/api/v1/referrals/status').then((r) => r.data);

export const sendReferralInvite = (data: { referee_phone: string }): Promise<{ message: string }> =>
  apiClient.post('/api/v1/referrals/invite', data).then((r) => r.data);
