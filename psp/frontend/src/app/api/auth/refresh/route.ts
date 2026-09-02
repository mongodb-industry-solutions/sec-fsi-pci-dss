import { NextResponse } from 'next/server';
import { refreshSession } from '../../../../lib/authority';

/**
 * POST renews the access token from the refresh token held in an httpOnly cookie.
 *
 * Here rather than in the browser because the refresh token is a credential script must not read,
 * and because the authority rotates it: the replacement has to be written server side or the next
 * renewal fails.
 *
 * A refusal is reported as 401 and not as an error: an expired session is an ordinary outcome, and
 * the caller's job is to stop asking rather than to retry.
 */
export async function POST() {
  const result = await refreshSession();
  if (!result.ok) {
    return NextResponse.json({ signedIn: false, reason: result.error }, { status: 401 });
  }
  return NextResponse.json({ signedIn: true });
}
