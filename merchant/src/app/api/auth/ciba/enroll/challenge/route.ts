// POST /api/auth/ciba/enroll/challenge: session-gated relay to the authority enrolment challenge.
// The browser needs the HMAC-bound challenge to sign with its freshly generated key. We attach the
// server-held Bearer so the authority binds the challenge to the logged-in user's sub.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { ENV } from '@/lib/env';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // Send an explicit empty JSON object: the authority derives the owner from the Bearer, but Fastify rejects a
  // POST with content-type application/json and an EMPTY body (FST_ERR_CTP_EMPTY_JSON_BODY). '{}' is valid.
  const res = await fetch(`${ENV.issuerUrl()}/credentials/challenge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'authority_unreachable' }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
