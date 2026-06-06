jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

import MockAdapter from 'axios-mock-adapter';
import { verifyOtp, initiatePhoneChange, confirmPhoneChange } from '@/api/auth.api';
import { createBusiness, addMomoAccount } from '@/api/business.api';
import { processChatMessage } from '@/api/chat.api';
import { getReferralCode, getReferralStatus, sendReferralInvite } from '@/api/referrals.api';
import { apiClient } from '@/api/client';
import { LANGUAGE_OPTIONS } from '@/store/ui';

const mock = new MockAdapter(apiClient);

describe('domain API modules', () => {
  beforeEach(() => mock.reset());

  it('verifies OTP against the backend auth contract', async () => {
    mock.onPost('/api/v1/auth/otp/verify', {
      phone: '+233241234567',
      otp: '123456',
    }).reply(200, {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      user_id: 'u1',
      business_id: null,
      role: 'none',
      is_new_user: true,
    });

    const result = await verifyOtp({ phone: '+233241234567', otp: '123456' });

    expect(result.access_token).toBe('access');
    expect(result.role).toBe('none');
  });

  it('creates a business with backend-supported type values', async () => {
    mock.onPost('/api/v1/business').reply(201, {
      access_token: 'scoped',
      message: 'Business created.',
      business: {
        id: 'biz1',
        name: 'Akosua Shop',
        type: 'shop',
        tin: null,
        address: null,
        subscription: 'free',
        sub_expires_at: null,
        is_active: true,
        created_at: '2026-05-10T00:00:00Z',
      },
    });

    const result = await createBusiness({ name: 'Akosua Shop', type: 'shop' });

    expect(result.business.type).toBe('shop');
    expect(result.access_token).toBe('scoped');
  });

  it('links MoMo accounts using only supported provider values', async () => {
    mock.onPost('/api/v1/business/momo-accounts', {
      provider: 'airteltigo',
      phone: '+233271234567',
      is_primary: true,
    }).reply(201, {
      id: 'wallet1',
      provider: 'airteltigo',
      phone: '+233271234567',
      account_name: null,
      is_primary: true,
      is_verified: false,
      status: 'pending',
    });

    const result = await addMomoAccount({
      provider: 'airteltigo',
      phone: '+233271234567',
      is_primary: true,
    });

    expect(result.provider).toBe('airteltigo');
  });

  it('uses authenticated phone recovery endpoints instead of password reset', async () => {
    mock.onPost('/api/v1/auth/account-recovery/initiate').reply(200, {
      message: 'OTP sent',
    });
    mock.onPost('/api/v1/auth/account-recovery/confirm').reply(200, {
      message: 'Phone number updated successfully.',
    });

    await expect(initiatePhoneChange({ new_phone: '+233241234567' })).resolves.toEqual({
      message: 'OTP sent',
    });
    await expect(confirmPhoneChange({
      new_phone: '+233241234567',
      otp: '123456',
    })).resolves.toEqual({
      message: 'Phone number updated successfully.',
    });
  });

  it('uses versioned referral endpoints', async () => {
    mock.onGet('/api/v1/referrals/my-code').reply(200, {
      referral_code: 'SME123',
      link: null,
    });
    mock.onGet('/api/v1/referrals/status').reply(200, {
      code: 'SME123',
      invited_count: 1,
      converted_count: 0,
      earned_ghs: 0,
    });
    mock.onPost('/api/v1/referrals/invite', { referee_phone: '+233241234567' }).reply(200, {
      message: 'Invite sent',
    });

    await expect(getReferralCode()).resolves.toMatchObject({ referral_code: 'SME123' });
    await expect(getReferralStatus()).resolves.toMatchObject({ code: 'SME123' });
    await expect(sendReferralInvite({ referee_phone: '+233241234567' })).resolves.toEqual({
      message: 'Invite sent',
    });
  });

  it('sends chat language and exposes Google-supported Ghanaian language options', async () => {
    expect(LANGUAGE_OPTIONS.map((l) => l.code)).toEqual(['en', 'ak', 'ee', 'gaa', 'ha']);

    mock.onPost('/api/v1/chat/process', {
      message: 'Show me stock',
      language: 'gaa',
    }).reply(200, {
      reply: 'Stock response',
      intent: 'check_stock',
    });

    await expect(processChatMessage({ message: 'Show me stock', language: 'gaa' })).resolves.toMatchObject({
      reply: 'Stock response',
      intent: 'check_stock',
    });
  });
});
