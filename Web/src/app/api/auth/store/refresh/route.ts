import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRequiredApiUrl } from '@/lib/serverConfig';
import { setStoreSessionCookies } from '@/lib/storeAuth';

/**
 * Silently mint a fresh access token from the httpOnly refresh cookie.
 * NOTE: the backend /auth/refresh takes the refresh token in the request BODY
 * (unlike the admin refresh, which is bearer-authenticated).
 */
export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('store_refresh')?.value;
  if (!refreshToken) {
    return NextResponse.json({ detail: 'Missing store session' }, { status: 401 });
  }

  const apiUrl = getRequiredApiUrl();
  const apiResp = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await apiResp.json();
  if (!apiResp.ok) {
    return NextResponse.json(data, { status: apiResp.status });
  }

  const response = NextResponse.json({
    ok: true,
    role: data.role ?? 'none',
    business_id: data.business_id ?? null,
  });
  setStoreSessionCookies(response, data.access_token, data.refresh_token);
  return response;
}
