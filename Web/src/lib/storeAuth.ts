import { NextResponse } from 'next/server';

const ACCESS_MAX_AGE = 60 * 60 * 8; // 8h session envelope
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30d

function csrfToken() {
  return crypto.randomUUID();
}

/** Set the store-portal session cookies (httpOnly tokens + JS-readable CSRF). */
export function setStoreSessionCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string
) {
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set('store_token', accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: ACCESS_MAX_AGE,
    path: '/',
  });
  response.cookies.set('store_refresh', refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: REFRESH_MAX_AGE,
    path: '/',
  });
  response.cookies.set('smeflow_csrf', csrfToken(), {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    maxAge: ACCESS_MAX_AGE,
    path: '/',
  });
}
