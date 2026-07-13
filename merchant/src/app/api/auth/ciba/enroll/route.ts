// POST /api/auth/ciba/enroll — session-gated relay to register the browser's public key at the PSP.
// Body: { challenge, publicKeyPem, alg, signature, credentialId, authenticatorMetadata? }. Only PUBLIC
// key material is forwarded; the private key never leaves the browser. The Bearer is attached server-side.
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { ENV } from '@/lib/env';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const res = await fetch(`${ENV.pspBaseUrl()}/api/v1/auth/enroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: await req.text(),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'psp_unreachable' }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
