import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api/proxy',
  withCredentials: true,
});

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

apiClient.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase() ?? 'GET';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('smeflow_csrf');
    if (csrf) {
      config.headers.set('X-CSRF-Token', decodeURIComponent(csrf));
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const config = error.config as (typeof error.config & { _adminRefreshAttempted?: boolean }) | undefined;
    if (
      typeof window !== 'undefined' &&
      error.response?.status === 401 &&
      window.location.pathname.startsWith('/admin') &&
      config &&
      !config?._adminRefreshAttempted
    ) {
      config._adminRefreshAttempted = true;
      try {
        const refresh = await fetch('/api/auth/admin/refresh', { method: 'POST' });
        if (refresh.ok) return apiClient(config);
      } catch {
        // Fall through to login redirect below.
      }
    }

    if (typeof window !== 'undefined' && error.response?.status === 401) {
      const path = window.location.pathname;
      if (path.startsWith('/admin')) window.location.href = '/admin/login';
      else if (path.startsWith('/lender')) window.location.href = '/lender/login';
      else window.location.href = '/agent/login';
    }
    return Promise.reject(error);
  }
);
