// POST /api/auth/ciba/enroll: session-gated relay to register the browser's public key at the authority.
// Body: { challenge, publicKeyPem, alg, signature, credentialId, authenticatorMetadata? }. Only PUBLIC
// key material is forwarded; the private key never leaves the browser. The Bearer is attached server-side.
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { ENV } from '@/lib/env';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // The browser authenticator speaks the shape it always has. The authority names two of those
  // fields differently, so the translation happens HERE, at the boundary that exists for it, rather
  // than by changing device code that is already deployed.
  const presented = (await req.json().catch(() => ({}))) as Record<string, unknown> & {
    alg?: string;
    authenticatorMetadata?: { deviceName?: string };
  };
  const registration = {
    challenge: presented.challenge,
    publicKeyPem: presented.publicKeyPem,
    algorithm: presented.alg ?? presented.algorithm,
    signature: presented.signature,
    ...(presented.credentialId ? { credentialId: presented.credentialId } : {}),
    ...(presented.authenticatorMetadata?.deviceName ? { label: presented.authenticatorMetadata.deviceName } : {}),
  };

  const res = await fetch(`${ENV.issuerUrl()}/credentials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(registration),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'authority_unreachable' }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
