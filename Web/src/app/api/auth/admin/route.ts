import { NextRequest, NextResponse } from 'next/server';

function csrfToken() {
  return crypto.randomUUID();
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const apiUrl = process.env.API_URL ?? 'http://localhost:8000';

  const apiResp = await fetch(`${apiUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await apiResp.json();

  if (!apiResp.ok) {
    return NextResponse.json(data, { status: apiResp.status });
  }

  const response = NextResponse.json({ ok: true, role: data.role ?? 'admin', totp_enabled: data.totp_enabled ?? false });
  response.cookies.set('admin_token', data.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8, // 8 hours
    path: '/',
  });
  response.cookies.set('smeflow_csrf', csrfToken(), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
    path: '/',
  });
  return response;
}
