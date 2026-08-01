import { NextRequest, NextResponse } from 'next/server';
import { getRequiredApiUrl } from '@/lib/serverConfig';

/**
 * Public, UNauthenticated proxy for the storefront API (`/api/v1/public/...`).
 * Unlike `/api/proxy`, it attaches NO Authorization token and enforces NO CSRF —
 * anonymous shoppers must be able to browse and check out. Only the backend's
 * public routes are reachable through this (the path is prefixed with /public).
 */
async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const apiUrl = getRequiredApiUrl();
  const upstream = `${apiUrl}/api/v1/public/${path.join('/')}${request.nextUrl.search}`;

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();

  const apiResp = await fetch(upstream, {
    method: request.method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const text = await apiResp.text();
  return new NextResponse(text, {
    status: apiResp.status,
    headers: { 'Content-Type': apiResp.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET = handler;
export const POST = handler;
