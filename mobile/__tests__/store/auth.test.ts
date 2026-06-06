// MMKV must be mocked in Jest (native module)
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { useAuthStore } from '@/store/auth';

describe('authStore', () => {
  beforeEach(() => useAuthStore.getState().clearAuth());

  it('starts unauthenticated', () => {
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
  });

  it('setAuth stores token and user', () => {
    useAuthStore.getState().setPendingOtpPhone('+233241234567');
    useAuthStore.getState().setAuth({
      accessToken: 'tok_abc',
      refreshToken: 'ref_xyz',
      user: { id: 'u1', phone: '+233241234567', name: 'Akosua' },
      businessId: 'biz_1',
      role: 'owner',
    });
    expect(useAuthStore.getState().accessToken).toBe('tok_abc');
    expect(useAuthStore.getState().isAuthenticated()).toBe(true);
    expect(useAuthStore.getState().pendingOtpPhone).toBeNull();
  });

  it('stores bootstrapped business context without treating KYC as a dashboard gate', () => {
    useAuthStore.getState().setAuth({
      accessToken: 'tok_abc',
      refreshToken: 'ref_xyz',
      user: { id: 'u1', phone: '+233241234567', name: 'Akosua' },
      businessId: 'biz_1',
      role: 'owner',
    });

    useAuthStore.getState().setSessionContext({
      business: { id: 'biz_1', name: 'Akosua Shop', type: 'shop' },
      businessKyc: null,
      momoAccounts: [],
      members: [],
      userKycStatus: { user_id: 'u1', kyc_status: 'unverified' },
    });

    expect(useAuthStore.getState().hasBusinessContext()).toBe(true);
    expect(useAuthStore.getState().business?.name).toBe('Akosua Shop');
    expect(useAuthStore.getState().businessKyc).toBeNull();
    expect(useAuthStore.getState().bootstrapStatus).toBe('ready');
  });

  it('clears stale business context when bootstrap returns no business', () => {
    useAuthStore.getState().setSessionContext({
      business: { id: 'biz_old', name: 'Old Shop', type: 'shop' },
      momoAccounts: [
        {
          id: 'wallet_old',
          provider: 'mtn',
          phone: '+233542880528',
          is_primary: true,
          is_verified: false,
          status: 'pending',
        },
      ],
      members: [{ id: 'm1', user_id: 'u1', role: 'owner', is_active: true }],
      businesses: [
        {
          business_id: 'biz_old',
          business_name: 'Old Shop',
          role: 'owner',
          is_active: true,
          subscription: 'free',
          is_current: true,
        },
      ],
    });

    useAuthStore.getState().setSessionContext({
      business: null,
      businessKyc: null,
      momoAccounts: [],
      members: [],
      businesses: [],
    });

    expect(useAuthStore.getState().business).toBeNull();
    expect(useAuthStore.getState().businessKyc).toBeNull();
    expect(useAuthStore.getState().momoAccounts).toEqual([]);
    expect(useAuthStore.getState().members).toEqual([]);
    expect(useAuthStore.getState().businesses).toEqual([]);
  });

  it('clears business-scoped data whenever auth or business context changes', () => {
    useAuthStore.getState().setSessionContext({
      business: { id: 'biz_old', name: 'Old Shop', type: 'shop' },
      momoAccounts: [
        {
          id: 'wallet_old',
          provider: 'mtn',
          phone: '+233542880528',
          is_primary: true,
          is_verified: false,
          status: 'pending',
        },
      ],
      members: [{ id: 'm1', user_id: 'u1', role: 'owner', is_active: true }],
    });

    useAuthStore.getState().setAuth({
      accessToken: 'tok_new',
      refreshToken: 'ref_new',
      user: { id: 'u2', phone: '+233241111111', name: 'New Owner' },
      businessId: null,
      role: 'none',
    });

    expect(useAuthStore.getState().business).toBeNull();
    expect(useAuthStore.getState().momoAccounts).toEqual([]);
    expect(useAuthStore.getState().members).toEqual([]);

    useAuthStore.getState().setSessionContext({
      business: { id: 'biz_old', name: 'Old Shop', type: 'shop' },
      momoAccounts: [
        {
          id: 'wallet_old',
          provider: 'mtn',
          phone: '+233542880528',
          is_primary: true,
          is_verified: false,
          status: 'pending',
        },
      ],
    });

    useAuthStore.getState().setBusinessContext({
      accessToken: 'tok_biz_new',
      businessId: 'biz_new',
      role: 'owner',
    });

    expect(useAuthStore.getState().business).toBeNull();
    expect(useAuthStore.getState().momoAccounts).toEqual([]);
  });

  it('stores the pending OTP phone before verification', () => {
    useAuthStore.getState().setPendingOtpPhone('+233241234567');
    expect(useAuthStore.getState().pendingOtpPhone).toBe('+233241234567');
  });

  it('stores business context after business onboarding', () => {
    useAuthStore.getState().setAuth({
      accessToken: 'user_token',
      refreshToken: 'ref_xyz',
      user: { id: 'u1', phone: '+233241234567', name: 'Akosua' },
      businessId: null,
      role: 'none',
    });
    expect(useAuthStore.getState().hasBusinessContext()).toBe(false);

    useAuthStore.getState().setBusinessContext({
      accessToken: 'business_token',
      businessId: 'biz_1',
      role: 'owner',
    });

    expect(useAuthStore.getState().accessToken).toBe('business_token');
    expect(useAuthStore.getState().businessId).toBe('biz_1');
    expect(useAuthStore.getState().role).toBe('owner');
    expect(useAuthStore.getState().hasBusinessContext()).toBe(true);
  });

  it('clearAuth removes all session data', () => {
    useAuthStore.getState().setAuth({
      accessToken: 'tok_abc', refreshToken: 'ref_xyz',
      user: { id: 'u1', phone: '+233241234567', name: 'Akosua' },
      businessId: 'biz_1', role: 'owner',
    });
    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();  // add this line
    expect(useAuthStore.getState().pendingOtpPhone).toBeNull();
  });
});
