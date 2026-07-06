// GET /api/auth/login — start authorization_code + PKCE flow, redirect to PSP consent page.
import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, generatePkce, randomToken } from '@/lib/oauth';
import { setLoginState } from '@/lib/session';
import { REQUESTED_SCOPES } from '@/lib/env';

export async function GET() {
  const { verifier, challenge } = generatePkce();
  const state = randomToken();
  const nonce = randomToken();

  // Stash PKCE verifier + state + nonce in a short-lived encrypted cookie (CSRF defence).
  await setLoginState({ state, nonce, codeVerifier: verifier });

  const url = buildAuthorizeUrl({ state, nonce, codeChallenge: challenge, scopes: REQUESTED_SCOPES });
  return NextResponse.redirect(url);
}
