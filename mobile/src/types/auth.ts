import type { ISODateTime, UserRole, UUID } from './common';

export interface OTPRequestDto {
  phone: string;
}

export interface OTPVerifyDto {
  phone: string;
  otp: string;
}

export interface OTPRequestResponseDto {
  success: boolean;
  message: string;
  expires_in_seconds: number;
}

export interface TokenResponseDto {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  user_id: UUID;
  business_id: UUID | null;
  role: UserRole;
  is_new_user: boolean;
}

export interface RefreshTokenRequestDto {
  refresh_token: string;
}

export interface LogoutRequestDto {
  refresh_token: string;
}

export interface BusinessSwitchRequestDto {
  business_id: UUID;
}

export interface UserResponseDto {
  id: UUID;
  phone: string;
  name: string | null;
  ghana_card_id: string | null;
  tin: string | null;
  kyc_status: 'unverified' | 'pending' | 'verified' | 'rejected' | string;
  is_active: boolean;
}

export interface UserUpdateDto {
  name?: string;
  ghana_card_id?: string;
  tin?: string;
}

export interface UserKYCSubmitDto {
  ghana_card_id: string;
}

export interface UserKYCStatusDto {
  user_id: UUID;
  kyc_status: 'unverified' | 'pending' | 'verified' | 'rejected' | string;
  kyc_submitted_at?: ISODateTime | null;
  kyc_verified_at?: ISODateTime | null;
}

export interface DeviceRegisterRequestDto {
  token: string;
  platform: string;
}

export interface DeviceRegisterResponseDto {
  device_token_id: UUID;
  is_active: boolean;
}

export interface PhoneChangeInitiateDto {
  new_phone: string;
}

export interface PhoneChangeConfirmDto {
  new_phone: string;
  otp: string;
}

export interface MessageResponseDto {
  message: string;
}
