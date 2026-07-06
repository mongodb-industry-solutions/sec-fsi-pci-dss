// GET /api/auth/login — start authorization_code + PKCE flow, redirect to PSP consent page.
import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizeUrl, generatePkce, randomToken } from '@/lib/oauth';
import { attachLoginState } from '@/lib/session';
import { ENV, REQUESTED_SCOPES } from '@/lib/env';

export async function GET(req: NextRequest) {
  // Host consistency: the seeded redirect_uri points at a fixed host (localhost:8082).
  // If the user started on a different host (e.g. 127.0.0.1), the ew_login cookie would be
  // set on that host and never sent back to the callback host → spurious invalid_state.
  // Bounce them to the canonical host first so login + callback share the same origin.
  const canonical = new URL(ENV.redirectUri()); // <base>/api/auth/callback
  if (req.nextUrl.host !== canonical.host) {
    return NextResponse.redirect(new URL('/api/auth/login', canonical.origin));
  }

  const { verifier, challenge } = generatePkce();
  const state = randomToken();
  const nonce = randomToken();

  const url = buildAuthorizeUrl({ state, nonce, codeChallenge: challenge, scopes: REQUESTED_SCOPES });

  // Set the short-lived encrypted state/PKCE cookie DIRECTLY on the redirect response
  // (CSRF defence). Cookie mutations via next/headers are not reliably merged into a
  // returned NextResponse.redirect across Next versions.
  const res = NextResponse.redirect(url);
  attachLoginState(res, { state, nonce, codeVerifier: verifier });
  return res;
}
