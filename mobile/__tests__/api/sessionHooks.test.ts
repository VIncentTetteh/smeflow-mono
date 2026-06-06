jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

import MockAdapter from 'axios-mock-adapter';
import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { apiClient } from '@/api/client';
import {
  fetchSessionBootstrap,
  useAddMomoAccount,
  useDeleteMomoAccount,
  useSetPrimaryMomoAccount,
  useSubmitBusinessKyc,
  useSubmitUserKyc,
  useUpdateBusinessProfile,
  useUpdateMomoAccount,
} from '@/api/hooks/sessionHooks';
import { useAuthStore } from '@/store/auth';

const mock = new MockAdapter(apiClient);

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe('session bootstrap API', () => {
  beforeEach(() => {
    mock.reset();
    useAuthStore.getState().clearAuth();
  });

  it('loads only user-level session state before a business exists', async () => {
    useAuthStore.setState({ accessToken: 'token', businessId: null } as any);
    mock.onGet('/api/v1/auth/me').reply(200, {
      id: 'u1',
      phone: '+233241234567',
      name: 'Akosua',
      kyc_status: 'unverified',
    });
    mock.onGet('/api/v1/auth/kyc/status').reply(200, {
      user_id: 'u1',
      kyc_status: 'unverified',
    });

    const result = await fetchSessionBootstrap();

    expect(result.user.phone).toBe('+233241234567');
    expect(result.business).toBeNull();
    expect(result.momoAccounts).toEqual([]);
    expect(result.businesses).toEqual([]);
    expect(mock.history.get.map((request) => request.url)).not.toContain('/api/v1/business/me');
  });

  it('loads business, KYC, wallet, and member context for business-scoped sessions', async () => {
    useAuthStore.setState({ accessToken: 'token', businessId: 'biz_1' } as any);
    mock.onGet('/api/v1/auth/me').reply(200, {
      id: 'u1',
      phone: '+233241234567',
      name: 'Akosua',
      kyc_status: 'verified',
    });
    mock.onGet('/api/v1/auth/kyc/status').reply(200, {
      user_id: 'u1',
      kyc_status: 'verified',
    });
    mock.onGet('/api/v1/business/me').reply(200, {
      id: 'biz_1',
      name: 'Akosua Shop',
      type: 'shop',
    });
    mock.onGet('/api/v1/kyc/me').reply(404);
    mock.onGet('/api/v1/business/momo-accounts').reply(200, []);
    mock.onGet('/api/v1/business/members').reply(200, [
      { id: 'm1', user_id: 'u1', role: 'owner', is_active: true },
    ]);
    mock.onGet('/api/v1/auth/businesses').reply(200, [
      {
        business_id: 'biz_1',
        business_name: 'Akosua Shop',
        role: 'owner',
        is_active: true,
        subscription: 'free',
        is_current: true,
      },
    ]);

    const result = await fetchSessionBootstrap();

    expect(result.business?.name).toBe('Akosua Shop');
    expect(result.businessKyc).toBeNull();
    expect(result.members).toHaveLength(1);
    expect(result.businesses[0].is_current).toBe(true);
  });

  it('stores a newly linked MoMo wallet immediately after the add mutation succeeds', async () => {
    useAuthStore.setState({ accessToken: 'token', businessId: 'biz_1', momoAccounts: [] } as any);
    mock.onPost('/api/v1/business/momo-accounts', {
      provider: 'mtn',
      phone: '+233542880528',
      is_primary: true,
    }).reply(201, {
      id: 'wallet1',
      provider: 'mtn',
      phone: '+233542880528',
      account_name: 'MTN',
      is_primary: true,
      is_verified: false,
      status: 'pending',
    });
    mock.onPost('/api/v1/business/momo-accounts/wallet1/verify', {
      status: 'verified',
      verification_ref: 'mobile-self-verified',
    }).reply(200, {
      id: 'wallet1',
      provider: 'mtn',
      phone: '+233542880528',
      account_name: 'MTN',
      is_primary: true,
      is_verified: true,
      status: 'verified',
      verification_ref: 'mobile-self-verified',
    });

    const { result, unmount } = renderHook(() => useAddMomoAccount(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        provider: 'mtn',
        phone: '+233542880528',
        is_primary: true,
      });
    });

    await waitFor(() => {
      expect(useAuthStore.getState().momoAccounts).toEqual([
        expect.objectContaining({
          id: 'wallet1',
          provider: 'mtn',
          phone: '+233542880528',
          is_primary: true,
          status: 'verified',
        }),
      ]);
    });
    expect(mock.history.post.map((request) => request.url)).toContain(
      '/api/v1/business/momo-accounts/wallet1/verify'
    );
    unmount();
  });

  it('updates business profile in the auth store after profile mutation succeeds', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      businessId: 'biz_1',
      business: { id: 'biz_1', name: 'Old Shop', type: 'shop' },
    } as any);
    mock.onPatch('/api/v1/business/me', {
      name: 'New Shop',
      type: 'shop',
      tin: 'C0012345678',
    }).reply(200, {
      id: 'biz_1',
      name: 'New Shop',
      type: 'shop',
      tin: 'C0012345678',
    });

    const { result, unmount } = renderHook(() => useUpdateBusinessProfile(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'New Shop',
        type: 'shop',
        tin: 'C0012345678',
      });
    });

    expect(useAuthStore.getState().business).toMatchObject({
      id: 'biz_1',
      name: 'New Shop',
      tin: 'C0012345678',
    });
    unmount();
  });

  it('updates local wallet state after edit, set-primary, and delete mutations', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      businessId: 'biz_1',
      momoAccounts: [
        { id: 'wallet1', provider: 'mtn', phone: '+233241111111', account_name: 'Old', is_primary: true, is_verified: true, status: 'verified' },
        { id: 'wallet2', provider: 'vodafone', phone: '+233242222222', account_name: 'Backup', is_primary: false, is_verified: true, status: 'verified' },
      ],
    } as any);
    mock.onPatch('/api/v1/business/momo-accounts/wallet2').reply(200, {
      id: 'wallet2',
      provider: 'vodafone',
      phone: '+233243333333',
      account_name: 'Updated',
      is_primary: false,
      is_verified: true,
      status: 'verified',
    });
    mock.onPost('/api/v1/business/momo-accounts/wallet2/set-primary', {}).reply(200, {
      id: 'wallet2',
      provider: 'vodafone',
      phone: '+233243333333',
      account_name: 'Updated',
      is_primary: true,
      is_verified: true,
      status: 'verified',
    });
    mock.onDelete('/api/v1/business/momo-accounts/wallet1').reply(204);

    const wrapper = createWrapper();
    const update = renderHook(() => useUpdateMomoAccount(), { wrapper });
    const primary = renderHook(() => useSetPrimaryMomoAccount(), { wrapper });
    const remove = renderHook(() => useDeleteMomoAccount(), { wrapper });

    await act(async () => {
      await update.result.current.mutateAsync({
        accountId: 'wallet2',
        phone: '+233243333333',
        account_name: 'Updated',
      });
      await primary.result.current.mutateAsync('wallet2');
      await remove.result.current.mutateAsync('wallet1');
    });

    expect(useAuthStore.getState().momoAccounts).toEqual([
      expect.objectContaining({
        id: 'wallet2',
        account_name: 'Updated',
        is_primary: true,
      }),
    ]);
    update.unmount();
    primary.unmount();
    remove.unmount();
  });

  it('stores user and business KYC submission status without blocking dashboard access', async () => {
    useAuthStore.setState({ accessToken: 'token', businessId: 'biz_1' } as any);
    mock.onPost('/api/v1/auth/kyc/submit', {
      ghana_card_id: 'GHA-123456789-0',
    }).reply(200, {
      user_id: 'u1',
      kyc_status: 'submitted',
    });
    mock.onPost('/api/v1/kyc/submit', {
      ghana_card_id: 'GHA-123456789-0',
      tin: 'C0012345678',
      documents: {},
    }).reply(200, {
      id: 'kyc-1',
      business_id: 'biz_1',
      user_id: 'u1',
      status: 'submitted',
    });

    const wrapper = createWrapper();
    const userKyc = renderHook(() => useSubmitUserKyc(), { wrapper });
    const businessKyc = renderHook(() => useSubmitBusinessKyc(), { wrapper });

    await act(async () => {
      await userKyc.result.current.mutateAsync({ ghana_card_id: 'GHA-123456789-0' } as never);
      await businessKyc.result.current.mutateAsync({
        ghana_card_id: 'GHA-123456789-0',
        tin: 'C0012345678',
      });
    });

    expect(useAuthStore.getState().userKycStatus).toMatchObject({ kyc_status: 'submitted' });
    expect(useAuthStore.getState().businessKyc).toMatchObject({ status: 'submitted' });
    expect(useAuthStore.getState().hasBusinessContext()).toBe(true);
    userKyc.unmount();
    businessKyc.unmount();
  });
});
