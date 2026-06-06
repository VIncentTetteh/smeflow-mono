import type { DecimalString, ISODateTime, UserRole, UUID } from './common';

export type BusinessType =
  | 'market_stall'
  | 'shop'
  | 'artisan'
  | 'restaurant'
  | 'pharmacy'
  | 'salon'
  | 'transport'
  | 'agriculture'
  | 'service'
  | 'other';

export type MomoProvider = 'mtn' | 'vodafone' | 'airteltigo';
export type MemberRole = Extract<UserRole, 'owner' | 'manager' | 'staff'>;
export type PreferredLanguage = 'en' | 'tw' | 'ee' | 'gaa' | 'pcm';
export type TaxVatStatus = 'unknown' | 'not_registered' | 'registered' | 'exempt';

export interface BusinessCreateDto {
  name: string;
  type: BusinessType;
  tin?: string;
  ghana_card_ref?: string;
  address?: string;
  region?: string;
  city?: string;
  market?: string;
  preferred_language?: PreferredLanguage;
  momo_provider?: MomoProvider;
  tax_vat_status?: TaxVatStatus;
  template_slug?: string;
  location_lat?: DecimalString;
  location_lng?: DecimalString;
  onboarding_channel?: string;
  onboarding_agent_id?: UUID;
}

export type BusinessUpdateDto = Partial<BusinessCreateDto>;

export interface BusinessResponseDto {
  id: UUID;
  name: string;
  type: BusinessType | string;
  tin: string | null;
  address: string | null;
  subscription: string;
  sub_expires_at: ISODateTime | null;
  is_active: boolean;
  created_at: ISODateTime;
}

export interface BusinessDetailResponseDto extends BusinessResponseDto {
  owner_id: UUID;
  ghana_card_ref: string | null;
  ghqr_merchant_id: string | null;
  dva_id?: string | null;
  dva_account_number?: string | null;
  dva_account_name?: string | null;
  dva_bank_name?: string | null;
  location_lat: DecimalString | null;
  location_lng: DecimalString | null;
}

export interface BusinessCreateResponseDto {
  business: BusinessResponseDto;
  access_token: string;
  message: string;
}

export interface BusinessMembershipResponseDto {
  business_id: UUID;
  business_name: string;
  role: MemberRole;
  is_active: boolean;
  subscription: string;
  is_current: boolean;
}

export interface MemberInviteDto {
  phone: string;
  role: MemberRole;
}

export interface MemberUpdateDto {
  role?: MemberRole;
  is_active?: boolean;
}

export interface MemberResponseDto {
  id: UUID;
  user_id: UUID;
  role: MemberRole;
  is_active: boolean;
  joined_at: ISODateTime;
  user_name?: string | null;
  user_phone?: string | null;
}

export interface MoMoAccountAddDto {
  provider: MomoProvider;
  phone: string;
  account_name?: string;
  is_primary?: boolean;
}

export interface MoMoAccountUpdateDto {
  phone?: string;
  account_name?: string;
  is_primary?: boolean;
}

export interface MoMoAccountVerifyDto {
  status: 'verified' | 'failed';
  verification_ref?: string;
  failure_reason?: string;
}

export interface MoMoAccountResponseDto {
  id: UUID;
  provider: MomoProvider | string;
  phone: string;
  account_name: string | null;
  is_primary: boolean;
  is_verified: boolean;
  status: string;
  verified_at?: ISODateTime | null;
  verification_ref?: string | null;
  failure_reason?: string | null;
}

export interface SuspensionAppealCreateDto {
  reason: string;
  evidence_url?: string;
}

export interface SuspensionAppealResponseDto {
  appeal_id: UUID;
  status: string;
}

export interface DedicatedAccountProvisionResponseDto {
  status: 'pending' | 'provisioned';
  provisioned: boolean;
  message?: string;
  account?: {
    business_id?: string;
    already_provisioned?: boolean;
    account_number?: string | null;
    account_name?: string | null;
    bank_name?: string | null;
  };
}
