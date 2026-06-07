const LOCAL_API_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function getRequiredApiUrl(): string {
  const apiUrl = process.env.API_URL?.trim();
  if (!apiUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('API_URL must be set in production');
    }
    return 'http://localhost:8000';
  }

  if (process.env.NODE_ENV === 'production') {
    if (!apiUrl.startsWith('https://')) {
      throw new Error('API_URL must use HTTPS in production');
    }
    if (LOCAL_API_PATTERN.test(apiUrl)) {
      throw new Error('API_URL must not point to localhost or a private LAN address in production');
    }
  }

  return apiUrl.replace(/\/$/, '');
}
