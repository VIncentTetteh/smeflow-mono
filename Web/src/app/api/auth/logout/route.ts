import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  for (const name of ['admin_token', 'lender_token', 'agent_token', 'smeflow_csrf']) {
    response.cookies.set(name, '', {
      httpOnly: name !== 'smeflow_csrf' ? true : false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });
  }
  return response;
}
