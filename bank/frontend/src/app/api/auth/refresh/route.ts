import { NextResponse } from 'next/server';
import { renewSession } from '../../../../lib/authority';

/**
 * POST renews the access token from the refresh token held in an httpOnly cookie.
 *
 * A route handler rather than a server component because writing a cookie is only legal here, and
 * the rotated refresh token has to be written or the next renewal fails.
 *
 * A refusal is reported as 401 and not as an error: an ended session is an ordinary outcome, and
 * the caller's job is to stop asking rather than to retry.
 */
export async function POST() {
  const result = await renewSession();
  if (!result.ok) {
    return NextResponse.json({ signedIn: false, reason: result.error }, { status: 401 });
  }
  return NextResponse.json({ signedIn: true });
}
