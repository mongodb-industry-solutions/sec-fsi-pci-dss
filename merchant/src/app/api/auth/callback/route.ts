// GET /api/auth/callback — validate state, exchange code→tokens, verify id_token, persist session.
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, verifyIdToken } from '@/lib/oauth';
import { attachSession, clearLoginStateOn, readLoginState } from '@/lib/session';
import { ENV } from '@/lib/env';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const home = new URL('/', ENV.baseUrl());

  const error = searchParams.get('error');
  if (error) {
    home.searchParams.set('auth_error', error);
    return NextResponse.redirect(home);
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  // Read (do not mutate) the login-state; we expire it on the response we return.
  const login = readLoginState(req);

  // CSRF: state must match the value we issued at /login.
  if (!code || !login || !state || state !== login.state) {
    // Concise diagnostic (no secrets) to explain spurious invalid_state.
    console.warn(
      '[auth/callback] invalid_state',
      JSON.stringify({
        hasCode: !!code,
        cookiePresent: !!login,
        stateParamPresent: !!state,
        stateMatches: !!login && !!state && state === login.state,
        host: req.nextUrl.host,
      }),
    );
    home.searchParams.set('auth_error', 'invalid_state');
    const res = NextResponse.redirect(home);
    clearLoginStateOn(res);
    return res;
  }

  try {
    const tokens = await exchangeCode(code, login.codeVerifier);
    const grantedScopes = tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [];

    let sub = '';
    let name: string | undefined;
    let email: string | undefined;
    if (tokens.id_token) {
      const claims = await verifyIdToken(tokens.id_token, login.nonce);
      sub = claims.sub;
      name = claims.name;
      email = claims.email;
    }

    // Set session + expire the transient login cookie on the SAME redirect response.
    const res = NextResponse.redirect(new URL('/', ENV.baseUrl()));
    attachSession(res, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      grantedScopes,
      sub,
      name,
      email,
    });
    clearLoginStateOn(res);
    return res;
  } catch {
    home.searchParams.set('auth_error', 'token_exchange_failed');
    const res = NextResponse.redirect(home);
    clearLoginStateOn(res);
    return res;
  }
}
