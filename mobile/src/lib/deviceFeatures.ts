import * as LocalAuthentication from 'expo-local-authentication';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerDevice } from '@/api/auth.api';

const BIOMETRIC_AVAILABILITY_TIMEOUT_MS = 2500;
const BIOMETRIC_UNLOCK_TIMEOUT_MS = 8000;

function isWebRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

export async function registerPushDevice() {
  if (isWebRuntime()) {
    return { registered: false, reason: 'web-push-unavailable' };
  }

  if (Constants.appOwnership === 'expo' && Platform.OS === 'android') {
    return { registered: false, reason: 'expo-go-android-push-unavailable' };
  }

  const Notifications = await import('expo-notifications');
  const permissions = await Notifications.getPermissionsAsync();
  const finalPermissions =
    permissions.status === 'granted' ? permissions : await Notifications.requestPermissionsAsync();

  if (finalPermissions.status !== 'granted') {
    return { registered: false, reason: 'permission-denied' };
  }

  const token = await Notifications.getExpoPushTokenAsync();

  try {
    await registerDevice({
      platform: 'expo',
      token: token.data,
    });
    return { registered: true, token: token.data };
  } catch {
    return { registered: false, reason: 'backend-route-unavailable', token: token.data };
  }
}

export async function isBiometricAvailable(): Promise<boolean> {
  return withTimeout(
    Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]).then(([hasHardware, isEnrolled]) => hasHardware && isEnrolled),
    BIOMETRIC_AVAILABILITY_TIMEOUT_MS,
    false
  );
}

export async function biometricUnlock() {
  const available = await isBiometricAvailable();

  if (!available) {
    return false;
  }

  return withTimeout(
    LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock SMEflow',
    }).then((result) => result.success),
    BIOMETRIC_UNLOCK_TIMEOUT_MS,
    false
  );
}
