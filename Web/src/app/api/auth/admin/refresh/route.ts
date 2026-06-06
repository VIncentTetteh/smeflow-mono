import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) {
    return NextResponse.json({ detail: 'Missing admin session' }, { status: 401 });
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:8000';
  const apiResp = await fetch(`${apiUrl}/api/v1/admin/auth/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await apiResp.json();
  if (!apiResp.ok) {
    return NextResponse.json(data, { status: apiResp.status });
  }

  const response = NextResponse.json({ ok: true, totp_enabled: data.totp_enabled ?? false });
  response.cookies.set('admin_token', data.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
    path: '/',
  });
  return response;
}
