// POST /api/auth/ciba/approve — session-less relay to submit the signed assertion to the PSP.
// The assertion (signature over the challenge) IS the authentication (WebAuthn model), so no session is
// needed. Served server-side to avoid a browser→PSP CORS surface. Body: { auth_req_id, credentialId, signature }.
import { NextRequest, NextResponse } from 'next/server';
import { ENV } from '@/lib/env';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { auth_req_id?: string; credentialId?: string; signature?: string };
  const { auth_req_id: authReqId, credentialId, signature } = body;
  if (!authReqId || !credentialId || !signature) {
    return NextResponse.json({ error: 'auth_req_id, credentialId and signature required' }, { status: 400 });
  }
  if (!/^[A-Za-z0-9._-]+$/.test(authReqId)) {
    return NextResponse.json({ error: 'invalid auth_req_id' }, { status: 400 });
  }

  const res = await fetch(`${ENV.pspBaseUrl()}/api/v1/auth/bc-authorize/${encodeURIComponent(authReqId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentialId, signature }),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'psp_unreachable' }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
