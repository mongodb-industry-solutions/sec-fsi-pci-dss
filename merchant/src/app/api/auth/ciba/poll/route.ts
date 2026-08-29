// POST /api/auth/ciba/poll: poll the authority token endpoint with the ciba grant (session-less).
// On approval the merchant mints the same ew_session it would after SSO, then signals the browser to
// redirect. While the user has not approved yet, returns { status: 'pending' | 'slow_down' }; terminal
// failures map to 'denied' | 'expired' | 'error'.
import { NextRequest, NextResponse } from 'next/server';
import { cibaTokenPoll, verifyIdToken, fetchUserinfo } from '@/lib/oauth';
import { setSession } from '@/lib/session';
import { expiresAtFrom } from '@/lib/expiry';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { auth_req_id?: string };
  if (!body.auth_req_id) {
    return NextResponse.json({ status: 'error', error: 'auth_req_id required' }, { status: 400 });
  }

  const result = await cibaTokenPoll(body.auth_req_id);
  if (result.status !== 'done' || !result.tokens) {
    return NextResponse.json({ status: result.status, error: result.error });
  }

  const tokens = result.tokens;
  const grantedScopes = tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [];

  let sub = '';
  let idName: string | undefined;
  let email: string | undefined;
  try {
    if (tokens.id_token) {
      const claims = await verifyIdToken(tokens.id_token); // CIBA has no nonce in this flow
      sub = claims.sub;
      idName = claims.name;
      // Only trust an email claim if the `email` scope was granted (GDPR minimization / scope binding).
      email = grantedScopes.includes('email') ? claims.email : undefined;
    }
  } catch {
    return NextResponse.json({ status: 'error', error: 'id_token verification failed' }, { status: 400 });
  }

  const info = sub ? await fetchUserinfo(tokens.access_token) : null;
  const localPart = (v?: string) => (v && v.includes('@') ? v.split('@')[0] : v);
  const name = info?.name ?? idName ?? localPart(info?.preferred_username) ?? localPart(email) ?? undefined;

  if (!sub) return NextResponse.json({ status: 'error', error: 'missing subject' }, { status: 400 });

  await setSession({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: expiresAtFrom(tokens.expires_in),
    grantedScopes,
    sub,
    name,
    email,
  });
  return NextResponse.json({ status: 'done' });
}
