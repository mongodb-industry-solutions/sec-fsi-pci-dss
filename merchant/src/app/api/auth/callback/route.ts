// GET /api/auth/callback — validate state, exchange code→tokens, verify id_token, persist session.
import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, verifyIdToken, fetchUserinfo } from '@/lib/oauth';
import { attachSession, clearLoginStateOn, readLoginState } from '@/lib/session';
import { expiresAtFrom } from '@/lib/expiry';
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
    let idName: string | undefined;
    let email: string | undefined;
    if (tokens.id_token) {
      const claims = await verifyIdToken(tokens.id_token, login.nonce);
      sub = claims.sub;
      idName = claims.name;
      // Only trust an email claim if the `email` scope was actually granted — never store
      // an address the user did not consent to share (GDPR data minimization / scope binding).
      email = grantedScopes.includes('email') ? claims.email : undefined;
    }

    // Enrich the display identity from the UserInfo endpoint. The id_token may omit `name`
    // (e.g. the user unchecked the opt-in `profile` scope, or a lean id_token); UserInfo is the
    // authoritative claims source and returns only what the granted scopes allow. Fallback order:
    // userinfo.name → id_token name → preferred_username → email local-part. `preferred_username`
    // is the address, so we display only its local part (avoids surfacing a full email as a name).
    const info = sub ? await fetchUserinfo(tokens.access_token) : null;
    const localPart = (v?: string) => (v && v.includes('@') ? v.split('@')[0] : v);
    const name =
      info?.name ??
      idName ??
      localPart(info?.preferred_username) ??
      localPart(email) ??
      undefined;

    // Refuse to create a session without a subject: if the token response omitted the id_token (or it
    // lacked a `sub` claim), `sub` is empty and a session with an empty identity would break downstream
    // identity/attribution. (A malformed/invalid id_token throws in verifyIdToken and is handled by the
    // catch below.) Treat the empty-subject case as an auth failure instead.
    if (!sub) {
      home.searchParams.set('auth_error', 'token_exchange_failed');
      const res = NextResponse.redirect(home);
      clearLoginStateOn(res);
      return res;
    }

    // Set session + expire the transient login cookie on the SAME redirect response.
    const res = NextResponse.redirect(new URL('/', ENV.baseUrl()));
    attachSession(res, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresAt: expiresAtFrom(tokens.expires_in),
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
