import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureAuthStorage } from '@/lib/secureStorage';
import type { UserRole } from '@/types/common';

interface User {
  id: string;
  phone: string;
  name: string;
  email?: string | null;
  googleLinked?: boolean;
  kycStatus?: string;
}

export interface BusinessProfile {
  id: string;
  name: string;
  type: string;
  tin?: string | null;
  address?: string | null;
  subscription?: string | null;
  is_active?: boolean;
  ghana_card_ref?: string | null;
  ghqr_merchant_id?: string | null;
  dva_id?: string | null;
  dva_account_number?: string | null;
  dva_account_name?: string | null;
  dva_bank_name?: string | null;
}

export interface BusinessKyc {
  id: string;
  business_id: string;
  user_id: string;
  ghana_card_id?: string | null;
  tin?: string | null;
  business_registration_ref?: string | null;
  status: string;
  failure_reason?: string | null;
}

export interface UserKycStatus {
  user_id: string;
  kyc_status: string;
  kyc_submitted_at?: string | null;
  kyc_verified_at?: string | null;
}

export interface MoMoAccount {
  id: string;
  provider: string;
  phone: string;
  account_name?: string | null;
  is_primary: boolean;
  is_verified: boolean;
  status: string;
}

export interface BusinessMember {
  id: string;
  user_id: string;
  role: string;
  is_active: boolean;
  user_name?: string | null;
  user_phone?: string | null;
}

export interface BusinessMembership {
  business_id: string;
  business_name: string;
  role: 'owner' | 'manager' | 'staff';
  is_active: boolean;
  subscription: string;
  is_current: boolean;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  businessId: string | null;
  role: Exclude<UserRole, 'platform_admin'> | null;
  pendingOtpPhone: string | null;
  pendingEmailLogin: string | null;
  bootstrapStatus: 'idle' | 'loading' | 'ready' | 'invalid';
  bootstrapError: string | null;
  business: BusinessProfile | null;
  businessKyc: BusinessKyc | null;
  userKycStatus: UserKycStatus | null;
  momoAccounts: MoMoAccount[];
  members: BusinessMember[];
  businesses: BusinessMembership[];
  biometricEnabled: boolean;
  setBiometricEnabled: (val: boolean) => void;
  isAuthenticated: () => boolean;
  hasBusinessContext: () => boolean;
  setPendingOtpPhone: (phone: string | null) => void;
  setPendingEmailLogin: (email: string | null) => void;
  setAuth: (payload: {
    accessToken: string;
    refreshToken: string;
    user: User;
    businessId: string | null;
    role: string;
  }) => void;
  setAccessToken: (token: string) => void;
  setBusinessId: (id: string) => void;
  setBusinessContext: (payload: { accessToken: string; businessId: string; role: string }) => void;
  setRefreshedSession: (payload: {
    accessToken: string;
    refreshToken: string;
    businessId: string | null;
    role: string;
  }) => void;
  setBootstrapStatus: (status: AuthState['bootstrapStatus'], error?: string | null) => void;
  setSessionContext: (payload: Partial<Pick<
    AuthState,
    'user' | 'business' | 'businessKyc' | 'userKycStatus' | 'momoAccounts' | 'members' | 'businesses'
  >>) => void;
  clearAuth: () => void;
}

const authStorage = createJSONStorage(() => secureAuthStorage);

const EMPTY_BUSINESS_CONTEXT = {
  business: null,
  businessKyc: null,
  momoAccounts: [],
  members: [],
  businesses: [],
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      businessId: null,
      role: null,
      pendingOtpPhone: null,
      pendingEmailLogin: null,
      bootstrapStatus: 'idle',
      bootstrapError: null,
      business: null,
      businessKyc: null,
      userKycStatus: null,
      momoAccounts: [],
      members: [],
      businesses: [],
      biometricEnabled: false,
      setBiometricEnabled: (val) => set({ biometricEnabled: val }),
      isAuthenticated: () => !!get().accessToken,
      hasBusinessContext: () => !!get().accessToken && !!get().businessId && get().role !== 'none',
      setPendingOtpPhone: (pendingOtpPhone) => set({ pendingOtpPhone }),
      setPendingEmailLogin: (pendingEmailLogin) => set({ pendingEmailLogin }),
      setAuth: (payload) => set({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        user: payload.user,
        businessId: payload.businessId,
        role: payload.role as AuthState['role'],
        pendingOtpPhone: null,
        pendingEmailLogin: null,
        bootstrapStatus: 'idle',
        bootstrapError: null,
        ...EMPTY_BUSINESS_CONTEXT,
      }),
      setAccessToken: (token) => set({ accessToken: token }),
      setBusinessId: (id) => set({ businessId: id }),
      setBusinessContext: (payload) => set({
        accessToken: payload.accessToken,
        businessId: payload.businessId,
        role: payload.role as AuthState['role'],
        bootstrapStatus: 'idle',
        bootstrapError: null,
        ...EMPTY_BUSINESS_CONTEXT,
      }),
      setRefreshedSession: (payload) => set({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        businessId: payload.businessId,
        role: payload.role as AuthState['role'],
        bootstrapStatus: 'idle',
        bootstrapError: null,
        ...EMPTY_BUSINESS_CONTEXT,
      }),
      setBootstrapStatus: (bootstrapStatus, bootstrapError = null) => set({ bootstrapStatus, bootstrapError }),
      setSessionContext: (payload) => set((state) => ({
        user: payload.user ?? state.user,
        business: payload.business === undefined ? state.business : payload.business,
        businessKyc: payload.businessKyc === undefined ? state.businessKyc : payload.businessKyc,
        userKycStatus: payload.userKycStatus === undefined ? state.userKycStatus : payload.userKycStatus,
        momoAccounts: payload.momoAccounts === undefined ? state.momoAccounts : payload.momoAccounts,
        members: payload.members === undefined ? state.members : payload.members,
        businesses: payload.businesses === undefined ? state.businesses : payload.businesses,
        bootstrapStatus: 'ready',
        bootstrapError: null,
      })),
      clearAuth: () => set({
        accessToken: null,
        refreshToken: null,
        user: null,
        businessId: null,
        role: null,
        pendingOtpPhone: null,
        pendingEmailLogin: null,
        bootstrapStatus: 'idle',
        bootstrapError: null,
        business: null,
        businessKyc: null,
        userKycStatus: null,
        momoAccounts: [],
        members: [],
        businesses: [],
      }),
    }),
    {
      name: 'auth',
      storage: authStorage,
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        businessId: state.businessId,
        role: state.role,
        pendingOtpPhone: state.pendingOtpPhone,
        pendingEmailLogin: state.pendingEmailLogin,
        biometricEnabled: state.biometricEnabled,
      }),
    }
  )
);
