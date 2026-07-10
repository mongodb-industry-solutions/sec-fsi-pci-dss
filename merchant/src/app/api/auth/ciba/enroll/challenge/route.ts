// POST /api/auth/ciba/enroll/challenge — session-gated relay to the PSP enrollment challenge.
// The browser needs the HMAC-bound challenge to sign with its freshly generated key. We attach the
// server-held Bearer so the PSP binds the challenge to the logged-in user's sub.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { ENV } from '@/lib/env';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const res = await fetch(`${ENV.pspBaseUrl()}/api/v1/auth/enroll/challenge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'psp_unreachable' }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
