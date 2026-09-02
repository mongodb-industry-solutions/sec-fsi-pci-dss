import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearSession } from '../../../../lib/authority';

/**
 * POST removes every session cookie, including the refresh token.
 *
 * Needed because that one is httpOnly: script clears the two it can see and cannot touch the
 * credential that mints replacements. Without this a signed-out browser still held a live refresh
 * token, and the next renewal would sign the person back in without asking.
 */
export async function POST() {
  clearSession(await cookies());
  return NextResponse.json({ signedOut: true });
}
