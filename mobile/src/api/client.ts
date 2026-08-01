import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { notifyAuthExpired } from '@/navigation/authEvents';
import { useAuthStore } from '@/store/auth';

const DEFAULT_DEV_API_PORT = '8010';
const LAN_OR_LOCALHOST =
  /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.0\.0\.1|\[?::1\]?)/;

/**
 * The host:port the app used to reach Metro (e.g. "192.168.100.44:8081").
 * In Expo Go / dev builds this is the dev machine's CURRENT LAN IP, so using it
 * means the API URL tracks network changes automatically — no more editing
 * EXPO_PUBLIC_API_BASE_URL every time you switch Wi-Fi.
 */
function metroHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Fallbacks across Expo SDK/runtime variants:
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost ??
    (Constants as unknown as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost ??
    (Constants as unknown as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } })
      .manifest2?.extra?.expoGo?.debuggerHost;
  const host = hostUri?.split(':')[0];
  return host || null;
}

function portFromUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/[^/:]+:(\d+)/);
  return match ? match[1] : null;
}

/** A real private LAN IPv4 — i.e. a same-machine dev server we can safely target. */
function isPrivateIp(host: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

function resolveApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

  // Production: rely on the build-time URL (validated below).
  if (!__DEV__) return explicit;

  // Dev pointing at a real remote (e.g. staging / a tunnelled backend) — honor it.
  if (explicit && !LAN_OR_LOCALHOST.test(explicit)) return explicit;

  // Auto-track the dev machine's IP ONLY when Metro is reached over a real LAN IP
  // (same-machine dev server). This is what makes a stale hardcoded LAN IP survive
  // a network switch. If Metro is on a tunnel/domain (Expo tunnel) or unknown, we
  // must NOT override — the backend is not at the Metro host — so honor `explicit`.
  const metro = metroHost();
  if (metro && isPrivateIp(metro)) {
    const port =
      process.env.EXPO_PUBLIC_DEV_API_PORT || portFromUrl(explicit) || DEFAULT_DEV_API_PORT;
    return `http://${metro}:${port}`;
  }

  // Explicit LAN/localhost URL provided — use it as configured.
  if (explicit) return explicit;

  // No config at all: fall back to the platform's loopback to the host machine.
  const port = process.env.EXPO_PUBLIC_DEV_API_PORT || DEFAULT_DEV_API_PORT;
  const host = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
  return `http://${host}:${port}`;
}

const apiBaseUrl = resolveApiBaseUrl();

if (__DEV__) {
  // Helps confirm which backend the app is actually talking to.
  console.log(`[SMEflow] API base URL: ${apiBaseUrl}`);
}

// Guard: catch accidental LAN/localhost URLs shipping in non-dev builds
if (__DEV__ === false && LAN_OR_LOCALHOST.test(apiBaseUrl)) {
  throw new Error(
    `[SMEflow] EXPO_PUBLIC_API_BASE_URL points to a local/LAN address (${apiBaseUrl}) in a non-dev build. ` +
    'Set the correct production URL in eas.json or your CI environment.'
  );
}

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Inject JWT on every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Refresh token on 401
let isRefreshing = false;
let failedQueue: { resolve: (t: string) => void; reject: (e: unknown) => void }[] = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

function clearExpiredSession() {
  useAuthStore.getState().clearAuth();
  notifyAuthExpired();
}

/** Extract the human-readable message from a FastAPI error response. */
function extractApiError(error: AxiosError): Error {
  const data = error.response?.data as Record<string, unknown> | undefined;
  const detail = data?.detail;
  const status = error.response?.status;
  const buildError = (message: string) => Object.assign(new Error(message), { status });
  if (detail) {
    const message = Array.isArray(detail)
      ? (detail as { msg?: string }[]).map((d) => d.msg ?? String(d)).join('; ')
      : String(detail);
    return buildError(message);
  }
  return buildError(error.message);
}

apiClient.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (!original || error.response?.status !== 401 || original._retry) {
      return Promise.reject(extractApiError(error));
    }
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original._retry = true;
        original.headers.Authorization = `Bearer ${token}`;
        return apiClient(original);
      });
    }
    original._retry = true;
    isRefreshing = true;
    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) {
      clearExpiredSession();
      isRefreshing = false;
      processQueue(new Error('No refresh token'), null);
      return Promise.reject(error);
    }
    try {
      const { data } = await axios.post(
        `${apiBaseUrl}/api/v1/auth/refresh`,
        { refresh_token: refreshToken }
      );
      const newToken: string | undefined = data?.access_token;
      const newRefreshToken: string | undefined = data?.refresh_token;
      if (!newToken) {
        throw new Error('Refresh response missing access_token');
      }
      if (!newRefreshToken) {
        throw new Error('Refresh response missing refresh_token');
      }
      useAuthStore.getState().setRefreshedSession({
        accessToken: newToken,
        refreshToken: newRefreshToken,
        businessId: data.business_id ?? null,
        role: data.role ?? 'none',
      });
      processQueue(null, newToken);
      original.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(original);
    } catch (err) {
      processQueue(err, null);
      clearExpiredSession();
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  }
);
