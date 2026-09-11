// POST /api/auth/ciba/enroll: session-gated relay to register the browser's public key at the authority.
// Body: { challenge, publicKeyPem, alg, signature, credentialId, authenticatorMetadata? }. Only PUBLIC
// key material is forwarded; the private key never leaves the browser. The Bearer is attached server-side.
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { ENV } from '@/lib/env';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // Forwarded as sent. The authority accepts the JOSE spelling this authenticator already uses, so
  // there is nothing to translate here and no second place for the shape to drift.
  const res = await fetch(`${ENV.issuerUrl()}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: await req.text(),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'authority_unreachable' }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
