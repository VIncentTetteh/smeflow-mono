import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRequiredApiUrl } from '@/lib/serverConfig';
import { setStoreSessionCookies } from '@/lib/storeAuth';

/**
 * Switch the active business/store. Re-issues an access+refresh pair scoped to
 * the target business, so all subsequent proxied calls are isolated to it.
 * Body: { business_id }
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('store_token')?.value;
  if (!token) {
    return NextResponse.json({ detail: 'Missing store session' }, { status: 401 });
  }

  const { business_id } = await request.json();
  if (!business_id) {
    return NextResponse.json({ detail: 'business_id is required.' }, { status: 400 });
  }

  const apiUrl = getRequiredApiUrl();
  const apiResp = await fetch(`${apiUrl}/api/v1/auth/switch-business`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ business_id }),
  });

  const data = await apiResp.json();
  if (!apiResp.ok) {
    return NextResponse.json(data, { status: apiResp.status });
  }

  const response = NextResponse.json({
    ok: true,
    role: data.role ?? 'none',
    business_id: data.business_id ?? business_id,
  });
  setStoreSessionCookies(response, data.access_token, data.refresh_token);
  return response;
}
