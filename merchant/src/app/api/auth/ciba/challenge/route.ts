// GET /api/auth/ciba/challenge?auth_req_id=…: session-less relay to the authority challenge endpoint.
// Served server-side (no CORS surface). Safe without a session: approval is gated by the signature, not
// by holding the auth_req_id. Returns { challenge, binding_message, client_name, scopes, status }.
import { NextRequest, NextResponse } from 'next/server';
import { ENV } from '@/lib/env';

export async function GET(req: NextRequest) {
  const authReqId = req.nextUrl.searchParams.get('auth_req_id');
  if (!authReqId) return NextResponse.json({ error: 'auth_req_id required' }, { status: 400 });
  // Guard against path traversal / injection: the id is an opaque UUID.
  if (!/^[A-Za-z0-9._-]+$/.test(authReqId)) {
    return NextResponse.json({ error: 'invalid auth_req_id' }, { status: 400 });
  }

  const res = await fetch(`${ENV.issuerUrl()}/protocol/openid-connect/ext/ciba/auth/${encodeURIComponent(authReqId)}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'authority_unreachable' }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
