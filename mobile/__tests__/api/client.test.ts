jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/store/auth';

const mock = new MockAdapter(apiClient);

describe('apiClient', () => {
  beforeEach(() => {
    mock.reset();
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      user: null,
      businessId: null,
      role: null,
    } as any);
  });

  it('injects Authorization header when token is present', async () => {
    useAuthStore.setState({ accessToken: 'test_token' } as any);
    mock.onGet('/test').reply(200, { ok: true });

    const res = await apiClient.get('/test');
    expect(res.config.headers?.Authorization).toBe('Bearer test_token');
  });

  it('does not inject Authorization header when no token', async () => {
    useAuthStore.setState({ accessToken: null } as any);
    mock.onGet('/no-auth').reply(200, { ok: true });

    const res = await apiClient.get('/no-auth');
    expect(res.config.headers?.Authorization).toBeUndefined();
  });

  it('returns data normally on 200', async () => {
    useAuthStore.setState({ accessToken: 'tok' } as any);
    mock.onGet('/ping').reply(200, { pong: true });
    const res = await apiClient.get('/ping');
    expect(res.data).toEqual({ pong: true });
  });

  it('calls clearAuth and rejects when 401 and no refresh token', async () => {
    useAuthStore.setState({ accessToken: 'expired', refreshToken: null } as any);
    mock.onGet('/protected').reply(401);

    await expect(apiClient.get('/protected')).rejects.toBeTruthy();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('does not throw when error.config is undefined (network error)', async () => {
    useAuthStore.setState({ accessToken: 'tok' } as any);
    mock.onGet('/network-error').networkError();

    await expect(apiClient.get('/network-error')).rejects.toBeTruthy();
    // Should not throw a TypeError about undefined.config
  });
});
