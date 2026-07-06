// GET /api/auth/callback — validate state, exchange code→tokens, verify id_token, persist session.
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, verifyIdToken } from '@/lib/oauth';
import { consumeLoginState, setSession } from '@/lib/session';
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
  const login = await consumeLoginState();

  // CSRF: state must match the value we issued at /login.
  if (!code || !login || !state || state !== login.state) {
    home.searchParams.set('auth_error', 'invalid_state');
    return NextResponse.redirect(home);
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

    await setSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      grantedScopes,
      sub,
      name,
      email,
    });
  } catch (e) {
    home.searchParams.set('auth_error', 'token_exchange_failed');
    return NextResponse.redirect(home);
  }

  return NextResponse.redirect(new URL('/', ENV.baseUrl()));
}
