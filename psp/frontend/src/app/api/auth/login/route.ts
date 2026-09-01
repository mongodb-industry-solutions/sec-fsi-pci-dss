import { NextResponse } from 'next/server';
import { startSignIn, LOGIN_COOKIE_OPTIONS } from '../../../../lib/authority';

/**
 * GET starts an authorization code flow with PKCE, the same way the bank and the merchant do.
 *
 * There is deliberately no POST: a credential is entered at the authority and never here, so this app
 * has nothing to accept a password on.
 */
export async function GET() {
  const { url, cookies } = startSignIn();
  const response = NextResponse.redirect(url);
  for (const { name, value } of cookies) response.cookies.set(name, value, LOGIN_COOKIE_OPTIONS);
  return response;
}
