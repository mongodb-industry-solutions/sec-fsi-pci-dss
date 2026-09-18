import { NextRequest, NextResponse } from 'next/server';
import { startSignIn, LOGIN_COOKIE_OPTIONS } from '../../../../lib/authority';
import { safeReturnTo } from '../../../../lib/silentSignIn';

/**
 * GET recognises a payer who is already signed in at the authority, without prompting them.
 *
 * Same authorization code flow with PKCE as `/api/auth/login`, and deliberately the same code path:
 * the only differences are `prompt=none`, so the authority answers from the session it holds or
 * refuses outright, and a return path, so the browser lands back on the payment page it left.
 *
 * It is a redirect and not a fetch because the authority publishes no cross-origin access for the
 * token endpoint, and because a credential must not be presented from a browser anyway.
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('return_to'));
  // Nothing to return to is a malformed call, not a sign-in problem: sending them to the authority
  // would strand them wherever the callback decided to go.
  if (!returnTo) return NextResponse.json({ error: 'A valid return_to is required.' }, { status: 400 });

  const { url, cookies } = startSignIn({ prompt: 'none', returnTo });
  const response = NextResponse.redirect(url);
  for (const { name, value } of cookies) response.cookies.set(name, value, LOGIN_COOKIE_OPTIONS);
  return response;
}
