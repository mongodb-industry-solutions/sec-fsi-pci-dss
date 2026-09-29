// GET /api/auth/expired: the session ended by itself, so start a new one.
//
// Deliberately NOT /api/auth/logout. That route exists for somebody who ASKS to leave: it revokes
// at the PSP and walks the browser through single sign-out so no session anywhere outlives the
// decision. None of that applies here. The tokens are already dead, which is why this runs, and the
// sign-out chain ends at the authority's own sign-in page with no way back, because it carries no
// redirect belonging to this application. Somebody whose session merely expired would be dropped on
// a screen that is not this merchant's, listing people who are not its customers.
//
// So it clears the one thing that is genuinely stale, this application's own cookie, and starts the
// ordinary login. That login names this merchant and returns here. If the person's identity session
// is still alive at the authority they come straight back signed in, which is the correct outcome:
// the credential expired, the person did not stop being who they are.
import { NextResponse } from 'next/server';
import { clearSessionOn } from '@/lib/session';
import { ENV } from '@/lib/env';

async function handle() {
  const res = NextResponse.redirect(new URL('/api/auth/login', ENV.baseUrl()).toString());
  clearSessionOn(res);
  return res;
}

export const GET = handle;
export const POST = handle;
