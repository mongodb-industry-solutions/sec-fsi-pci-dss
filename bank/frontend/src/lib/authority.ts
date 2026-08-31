import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';

/**
 * Signing a person in, by sending them to the authority and taking a code back.
 *
 * This app never sees a password. It starts an authorization code request with PKCE, the authority
 * hosts the sign-in, and the code that comes back is exchanged here for a token that lands in an
 * httpOnly cookie. Collecting the credential in this app, even to forward it, would make it a second
 * place credentials are handled, which is exactly what moving identity out was for.
 */

const SESSION_COOKIE = 'bankcore.session';
const VERIFIER_COOKIE = 'bankcore.pkce';
const STATE_COOKIE = 'bankcore.state';
const REALM = 'bankcore';
const CONSOLE_CLIENT_ID = 'bankcore-console';
const TIMEOUT_MS = 10000;

function issuerBase(): string {
  const raw = process.env.PSP_BANKCORE_GIAM_ISSUER_URL
    ?? process.env.BANKCORE_GIAM_ISSUER_URL
    ?? 'http://127.0.0.1:8085/realms/bankcore';
  return raw.replace(/\/$/, '');
}

// The browser-facing authority, which is a different address from the one this server calls: the
// sign-in page is opened by a person, so it must be a host their browser can reach.
function authorityUi(): string {
  const raw = process.env.NEXT_PUBLIC_BANKCORE_AUTHORITY_URL
    ?? process.env.PSP_GIAM_UI_URL
    ?? 'http://localhost:8086';
  return raw.replace(/\/$/, '');
}

function appBase(): string {
  return (process.env.PSP_BANKCORE_FRONTEND_URL ?? 'http://localhost:8084').replace(/\/$/, '');
}

function redirectUri(): string {
  return `${appBase()}/api/auth/callback`;
}

/** The URL to send the browser to, with the PKCE verifier and state kept server side. */
export async function startSignIn(): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const store = await cookies();
  const shortLived = { httpOnly: true as const, sameSite: 'lax' as const, path: '/', maxAge: 600 };
  store.set(VERIFIER_COOKIE, verifier, shortLived);
  store.set(STATE_COOKIE, state, shortLived);

  const url = new URL(`${authorityUi()}/auth/login`);
  url.searchParams.set('realm', REALM);
  url.searchParams.set('client_id', CONSOLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface ExchangeResult {
  ok: boolean;
  error?: string;
}

/** Exchanges the returned code for a token, after checking the state this app itself issued. */
export async function completeSignIn(code: string, state: string): Promise<ExchangeResult> {
  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  const verifier = store.get(VERIFIER_COOKIE)?.value;

  store.delete(STATE_COOKIE);
  store.delete(VERIFIER_COOKIE);

  // Without this the callback accepts a code obtained in somebody else's browser, which is the whole
  // reason state exists.
  if (!expectedState || state !== expectedState) return { ok: false, error: 'state_mismatch' };
  if (!verifier) return { ok: false, error: 'missing_verifier' };

  try {
    const response = await fetch(`${issuerBase()}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: CONSOLE_CLIENT_ID,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: 'token_refused' };

    const { access_token: accessToken, expires_in: expiresIn } = await response.json() as {
      access_token?: string; expires_in?: number;
    };
    if (!accessToken) return { ok: false, error: 'no_token' };

    store.set(SESSION_COOKIE, accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: expiresIn ?? 900,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'authority_unreachable' };
  }
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in person's token, or '' when nobody is signed in. */
export async function sessionToken(): Promise<string> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? '';
}

export interface StaffSession {
  subjectId: string;
  userName?: string;
  roles: string[];
}

/**
 * Who is signed in, read from the token's own claims.
 *
 * Unverified on purpose: this decides what the UI renders, never what it is allowed to do. Every
 * authorisation decision is the bank's, against the same token, and it verifies the signature.
 */
export async function currentStaff(): Promise<StaffSession | null> {
  const token = await sessionToken();
  if (!token) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as {
      sub?: string; name?: string; preferred_username?: string; roles?: unknown; exp?: number;
    };
    if (!claims.sub) return null;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    const userName = claims.preferred_username ?? claims.name;
    return {
      subjectId: claims.sub,
      ...(userName ? { userName } : {}),
      roles: Array.isArray(claims.roles) ? claims.roles.map(String) : [],
    };
  } catch {
    return null;
  }
}
