jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('@/api/auth.api', () => ({
  registerDevice: jest.fn(),
}));

import * as LocalAuthentication from 'expo-local-authentication';
import { biometricUnlock, isBiometricAvailable } from '@/lib/deviceFeatures';

const localAuth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

describe('device biometric helpers', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('returns false instead of hanging when availability checks do not resolve', async () => {
    jest.useFakeTimers();
    localAuth.hasHardwareAsync.mockReturnValue(new Promise<boolean>(() => {}) as Promise<boolean>);
    localAuth.isEnrolledAsync.mockResolvedValue(true);

    const resultPromise = isBiometricAvailable();
    jest.advanceTimersByTime(2500);

    await expect(resultPromise).resolves.toBe(false);
  });

  it('returns false instead of hanging when authentication does not resolve', async () => {
    jest.useFakeTimers();
    localAuth.hasHardwareAsync.mockResolvedValue(true);
    localAuth.isEnrolledAsync.mockResolvedValue(true);
    localAuth.authenticateAsync.mockReturnValue(new Promise(() => {}) as ReturnType<typeof localAuth.authenticateAsync>);

    const resultPromise = biometricUnlock();
    await Promise.resolve();
    jest.advanceTimersByTime(8000);

    await expect(resultPromise).resolves.toBe(false);
  });
});
