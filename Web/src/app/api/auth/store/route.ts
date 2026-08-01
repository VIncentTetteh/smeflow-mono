import { NextRequest, NextResponse } from 'next/server';
import { getRequiredApiUrl } from '@/lib/serverConfig';
import { setStoreSessionCookies } from '@/lib/storeAuth';

/**
 * Store-portal login. Exchanges an OTP / email OTP / Google id_token for a
 * session and stashes the tokens in httpOnly cookies so they never touch JS.
 *
 * Body: { mode: 'phone' | 'email' | 'google', ...credentials }
 *   phone  → { phone, otp }
 *   email  → { email, otp }
 *   google → { id_token }
 */

const UPSTREAM_BY_MODE: Record<string, string> = {
  phone: '/api/v1/auth/otp/verify',
  email: '/api/v1/auth/email/login/verify',
  google: '/api/v1/auth/google/login',
};

export async function POST(request: NextRequest) {
  const { mode, ...credentials } = await request.json();
  const upstreamPath = UPSTREAM_BY_MODE[mode];
  if (!upstreamPath) {
    return NextResponse.json({ detail: 'Unsupported login mode.' }, { status: 400 });
  }

  const apiUrl = getRequiredApiUrl();
  const apiResp = await fetch(`${apiUrl}${upstreamPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  const data = await apiResp.json();
  if (!apiResp.ok) {
    return NextResponse.json(data, { status: apiResp.status });
  }

  const response = NextResponse.json({
    ok: true,
    role: data.role ?? 'none',
    user_id: data.user_id ?? '',
    business_id: data.business_id ?? null,
    is_new_user: data.is_new_user ?? false,
  });
  setStoreSessionCookies(response, data.access_token, data.refresh_token);
  return response;
}
