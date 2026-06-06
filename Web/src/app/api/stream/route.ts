import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('business_id') ?? '';
  const cookieStore = await cookies();

  const token =
    cookieStore.get('admin_token')?.value ??
    cookieStore.get('lender_token')?.value ??
    cookieStore.get('agent_token')?.value;

  const apiUrl = process.env.API_URL ?? 'http://localhost:8000';
  const upstreamUrl = `${apiUrl}/notifications/stream?business_id=${businessId}`;

  const upstream = await fetch(upstreamUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!upstream.ok || !upstream.body) {
    return new Response('Stream unavailable', { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
