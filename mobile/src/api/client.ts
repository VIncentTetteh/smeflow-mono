import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import { notifyAuthExpired } from '@/navigation/authEvents';
import { useAuthStore } from '@/store/auth';

function defaultDevApiBaseUrl() {
  if (!__DEV__) {
    return '';
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
}

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || defaultDevApiBaseUrl();

// Guard: catch accidental LAN/localhost URLs shipping in non-dev builds
if (__DEV__ === false && /https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.0\.0\.1)/.test(apiBaseUrl)) {
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
