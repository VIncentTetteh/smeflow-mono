import type { DecimalString, ISODateTime, UUID } from './common';

export interface AgentDashboardDto {
  agent_id?: UUID;
  name?: string | null;
  region?: string | null;
  district?: string | null;
  is_active?: boolean;
  onboarded_count?: number;
  /** Alias for onboarded_count — total traders onboarded all-time */
  completed?: number;
  /** Monthly target set by admin */
  target?: number;
  active_traders?: number;
  pending_onboardings?: number;
  commissions_due?: DecimalString;
  period_commission?: DecimalString;
  total_commission_earned?: DecimalString;
  pending_commission?: DecimalString;
  total_referrals?: number;
  application_status?: string;
}

export interface AgentTraderDto {
  id: UUID;
  business_id?: UUID;
  business_name?: string;
  business?: { name?: string };
  owner_phone?: string;
  kyc_status?: string;
  name?: string;
  phone?: string;
  status?: string;
  created_at?: ISODateTime;
}

export interface AgentTraderListDto {
  items: AgentTraderDto[];
  total?: number;
}

export interface AgentCommissionDto {
  id: UUID;
  business_id?: UUID;
  business_name?: string;
  trigger?: string;
  amount?: DecimalString;
  amount_ghs?: DecimalString;
  status?: string;
  created_at?: ISODateTime;
  available_at?: ISODateTime | null;
  paid_at?: ISODateTime | null;
  paid_via?: string | null;
}

export interface AgentCommissionListDto {
  items: AgentCommissionDto[];
  total?: number;
}

export interface AgentWalletDto {
  agent_id: UUID;
  pending_balance: DecimalString;
  available_balance: DecimalString;
  total_paid_out: DecimalString;
  total_commission_earned: DecimalString;
  last_payout_at?: ISODateTime | null;
  next_payout_date?: ISODateTime | null;
  payout_threshold: DecimalString;
  eligible_for_payout: boolean;
}

export interface AgentPayoutHistoryDto {
  batch_id: UUID;
  amount_ghs: DecimalString;
  transfer_code?: string | null;
  status: string;
  payout_date: ISODateTime;
  completed_at?: ISODateTime | null;
}

export interface AgentPayoutHistoryListDto {
  items: AgentPayoutHistoryDto[];
  total?: number;
}

export interface AgentWithdrawRequestDto {
  amount: number;
}

export interface AgentWithdrawResponseDto {
  transfer_code?: string | null;
  status: string;
  amount: number;
  message?: string | null;
}

export interface AgentTraderDetailDto {
  business_id: UUID;
  business_name: string;
  business_type?: string;
  address?: string | null;
  owner_user_id: UUID;
  referral_status: string;
  referral_channel: string;
  activated_at?: ISODateTime | null;
  onboarded_at: ISODateTime;
  kyc_status: string;
  kyc_submitted_at?: ISODateTime | null;
  wallet_phone?: string | null;
  wallet_provider?: string | null;
  wallet_verified: boolean;
  sales_count: number;
  total_revenue_ghs: DecimalString;
  last_sale_at?: ISODateTime | null;
  commissions_earned_ghs: DecimalString;
}

export interface AgentReferralCodeDto {
  referral_code: string;
  agent_id: UUID;
  deep_link: string;
  qr_data: string;
}

export interface OnboardTraderPayload {
  phone: string;
  ownerName: string;
  businessName: string;
  businessType: string;
  address?: string;
  walletPhone?: string;
  ghanaCard?: string;
  tin?: string;
  referralCode?: string;
}

export interface OnboardTraderResultDto {
  businessId: string;
  traderUserId: string;
  businessName: string;
  isNewUser: boolean;
  kycSubmitted: boolean;
}
