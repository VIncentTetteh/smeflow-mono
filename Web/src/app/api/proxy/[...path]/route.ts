import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const cookieStore = await cookies();
  if (!SAFE_METHODS.has(request.method)) {
    const csrfCookie = cookieStore.get('smeflow_csrf')?.value;
    const csrfHeader = request.headers.get('x-csrf-token');
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return NextResponse.json({ detail: 'Invalid CSRF token' }, { status: 403 });
    }
  }

  // Pick the token that matches the target API namespace so that an admin
  // session cookie never overrides a lender or agent token and vice-versa.
  const namespace = path[0];
  const token =
    namespace === 'lender' ? cookieStore.get('lender_token')?.value
    : namespace === 'admin'  ? cookieStore.get('admin_token')?.value
    : namespace === 'agent'  ? cookieStore.get('agent_token')?.value
    : (cookieStore.get('admin_token')?.value ??
       cookieStore.get('lender_token')?.value ??
       cookieStore.get('agent_token')?.value);

  const apiUrl = process.env.API_URL ?? 'http://localhost:8000';
  const upstream = `${apiUrl}/api/v1/${path.join('/')}${request.nextUrl.search}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Forward only specific application-level custom headers.
  // Never forward X-Forwarded-For or similar — the backend uses them for
  // session fingerprinting and IP allowlist checks.
  const FORWARD = ['x-admin-totp'];
  for (const name of FORWARD) {
    const val = request.headers.get(name);
    if (val) headers[name] = val;
  }


  const body = ['GET', 'HEAD'].includes(request.method)
    ? undefined
    : await request.text();

  const apiResp = await fetch(upstream, {
    method: request.method,
    headers,
    body,
  });

  const responseText = await apiResp.text();
  return new NextResponse(responseText, {
    status: apiResp.status,
    headers: {
      'Content-Type': apiResp.headers.get('content-type') ?? 'application/json',
    },
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
