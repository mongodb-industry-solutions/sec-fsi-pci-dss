// GET /api/auth/login — start authorization_code + PKCE flow, redirect to PSP consent page.
import { NextRequest, NextResponse } from 'next/server';
import { buildAuthorizeUrl, generatePkce, randomToken } from '@/lib/oauth';
import { attachLoginState } from '@/lib/session';
import { ENV, REQUESTED_SCOPES } from '@/lib/env';
import { oauthLog, shortHash } from '@/lib/logger';

export async function GET(req: NextRequest) {
  // Host consistency: only relevant for LOCAL dev, where the user might start on 127.0.0.1 while the
  // seeded redirect_uri uses localhost:8082 (or vice-versa) — the ew_login cookie would then be set on
  // one host and never sent back to the callback host → spurious invalid_state. Bounce to the canonical
  // host ONLY when that canonical host is a localhost variant. Behind a real proxy/ingress (staging/
  // prod) `req.nextUrl.host` reflects the internal hop, not the public host, so comparing it to the
  // configured public host would never match and would loop forever (ERR_TOO_MANY_REDIRECTS). The
  // ingress already guarantees the public host there, so the bounce is unnecessary and must be skipped.
  const canonical = new URL(ENV.redirectUri()); // <base>/api/auth/callback
  const canonicalIsLocal = canonical.hostname === 'localhost' || canonical.hostname === '127.0.0.1';
  if (canonicalIsLocal && req.nextUrl.host !== canonical.host) {
    return NextResponse.redirect(new URL('/api/auth/login', canonical.origin));
  }

  const { verifier, challenge } = generatePkce();
  const state = randomToken();
  const nonce = randomToken();
  // flowId = hash(state): the backend anchors its audit events on the same hash, so this ties the
  // merchant logs to the PSP ledger for one login attempt.
  const flowId = shortHash(state);

  const url = buildAuthorizeUrl({ state, nonce, codeChallenge: challenge, scopes: REQUESTED_SCOPES });

  oauthLog.info('login.initiated', {
    flowId, clientId: ENV.clientId(), redirectUri: ENV.redirectUri(),
    pspBaseUrl: ENV.pspBaseUrl(), scopes: REQUESTED_SCOPES,
  });

  // Set the short-lived encrypted state/PKCE cookie DIRECTLY on the redirect response
  // (CSRF defence). Cookie mutations via next/headers are not reliably merged into a
  // returned NextResponse.redirect across Next versions.
  const res = NextResponse.redirect(url);
  attachLoginState(res, { state, nonce, codeVerifier: verifier, flowId });
  return res;
}
