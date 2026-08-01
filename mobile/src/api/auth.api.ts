import { apiClient } from './client';
import type {
  BusinessSwitchRequestDto,
  DeviceRegisterRequestDto,
  DeviceRegisterResponseDto,
  EmailOTPRequestDto,
  EmailOTPVerifyDto,
  GoogleAuthDto,
  LogoutRequestDto,
  MessageResponseDto,
  OTPRequestDto,
  OTPRequestResponseDto,
  OTPVerifyDto,
  PhoneChangeConfirmDto,
  PhoneChangeInitiateDto,
  RefreshTokenRequestDto,
  TokenResponseDto,
  UserKYCStatusDto,
  UserKYCSubmitDto,
  UserResponseDto,
  UserUpdateDto,
} from '@/types/auth';
import type { BusinessMembershipResponseDto } from '@/types/business';

export async function requestOtp(body: OTPRequestDto): Promise<OTPRequestResponseDto> {
  const response = await apiClient.post<OTPRequestResponseDto>('/api/v1/auth/otp/request', body);
  return response.data;
}

export async function verifyOtp(body: OTPVerifyDto): Promise<TokenResponseDto> {
  const response = await apiClient.post<TokenResponseDto>('/api/v1/auth/otp/verify', body);
  return response.data;
}

export async function refreshSession(body: RefreshTokenRequestDto): Promise<TokenResponseDto> {
  const response = await apiClient.post<TokenResponseDto>('/api/v1/auth/refresh', body);
  return response.data;
}

export async function switchBusiness(body: BusinessSwitchRequestDto): Promise<TokenResponseDto> {
  const response = await apiClient.post<TokenResponseDto>('/api/v1/auth/switch-business', body);
  return response.data;
}

export async function listBusinesses(): Promise<BusinessMembershipResponseDto[]> {
  const response = await apiClient.get<BusinessMembershipResponseDto[]>('/api/v1/auth/businesses');
  return response.data;
}

export async function logout(body: LogoutRequestDto): Promise<void> {
  await apiClient.post('/api/v1/auth/logout', body);
}

export async function getMe(): Promise<UserResponseDto> {
  const response = await apiClient.get<UserResponseDto>('/api/v1/auth/me');
  return response.data;
}

export async function updateMe(body: UserUpdateDto): Promise<UserResponseDto> {
  const response = await apiClient.patch<UserResponseDto>('/api/v1/auth/me', body);
  return response.data;
}

export async function registerDevice(
  body: DeviceRegisterRequestDto
): Promise<DeviceRegisterResponseDto> {
  const response = await apiClient.post<DeviceRegisterResponseDto>('/api/v1/auth/devices', body);
  return response.data;
}

export async function submitUserKyc(body: UserKYCSubmitDto): Promise<UserKYCStatusDto> {
  const response = await apiClient.post<UserKYCStatusDto>('/api/v1/auth/kyc/submit', body);
  return response.data;
}

export async function getUserKycStatus(): Promise<UserKYCStatusDto> {
  const response = await apiClient.get<UserKYCStatusDto>('/api/v1/auth/kyc/status');
  return response.data;
}

export async function initiatePhoneChange(
  body: PhoneChangeInitiateDto
): Promise<MessageResponseDto> {
  const response = await apiClient.post<MessageResponseDto>(
    '/api/v1/auth/account-recovery/initiate',
    body
  );
  return response.data;
}

export async function confirmPhoneChange(body: PhoneChangeConfirmDto): Promise<MessageResponseDto> {
  const response = await apiClient.post<MessageResponseDto>(
    '/api/v1/auth/account-recovery/confirm',
    body
  );
  return response.data;
}

// ── Email OTP ────────────────────────────────────────────────────────────────

export async function requestEmailLink(body: EmailOTPRequestDto): Promise<MessageResponseDto> {
  const response = await apiClient.post<MessageResponseDto>(
    '/api/v1/auth/email/link/initiate',
    body
  );
  return response.data;
}

export async function confirmEmailLink(body: EmailOTPVerifyDto): Promise<UserResponseDto> {
  const response = await apiClient.post<UserResponseDto>('/api/v1/auth/email/link/confirm', body);
  return response.data;
}

export async function requestEmailLogin(body: EmailOTPRequestDto): Promise<MessageResponseDto> {
  const response = await apiClient.post<MessageResponseDto>(
    '/api/v1/auth/email/login/request',
    body
  );
  return response.data;
}

export async function verifyEmailLogin(body: EmailOTPVerifyDto): Promise<TokenResponseDto> {
  const response = await apiClient.post<TokenResponseDto>('/api/v1/auth/email/login/verify', body);
  return response.data;
}

// ── Google Sign-In ─────────────────────────────────────────────────────────────

export async function linkGoogleAccount(body: GoogleAuthDto): Promise<UserResponseDto> {
  const response = await apiClient.post<UserResponseDto>('/api/v1/auth/google/link', body);
  return response.data;
}

export async function googleLogin(body: GoogleAuthDto): Promise<TokenResponseDto> {
  const response = await apiClient.post<TokenResponseDto>('/api/v1/auth/google/login', body);
  return response.data;
}
