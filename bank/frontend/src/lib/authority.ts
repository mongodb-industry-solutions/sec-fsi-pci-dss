import 'server-only';
import { cookies } from 'next/headers';

/**
 * Signing a person in at the identity authority, on this app's behalf.
 *
 * The bank's administrative API requires an interactive principal with the right role, so this app
 * cannot mint its own credential for it: what it needs is the token of the person using it. The
 * exchange runs server side and the token lands in an httpOnly cookie, which keeps the property this
 * app was built around, that the browser never holds a token.
 */

const SESSION_COOKIE = 'bankcore.session';
const REALM = 'bankcore';
const CONSOLE_CLIENT_ID = 'bankcore-console';
const TIMEOUT_MS = 10000;

function issuerBase(): string {
  const raw = process.env.PSP_BANKCORE_GIAM_ISSUER_URL
    ?? process.env.BANKCORE_GIAM_ISSUER_URL
    ?? 'http://127.0.0.1:8085/realms/bankcore';
  return raw.replace(/\/$/, '');
}

// The console's registered redirect, which the authority checks even though no browser follows it here.
function redirectUri(): string {
  const base = process.env.PSP_BANKCORE_FRONTEND_URL ?? 'http://localhost:8084';
  return `${base.replace(/\/$/, '')}/api/auth/callback`;
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const { randomBytes, createHash } = await import('crypto');
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export interface SignInResult {
  ok: boolean;
  userName?: string;
  error?: string;
}

/** Password sign-in, then the ordinary authorization code exchange with PKCE. */
export async function signIn(login: string, password: string): Promise<SignInResult> {
  let sessionId: string;
  let userName: string | undefined;

  try {
    const response = await fetch(`${issuerBase()}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // One message for every failure: distinguishing an unknown person from a wrong password would be
    // an enumeration oracle, and nobody signing in can act on the difference.
    if (!response.ok) return { ok: false, error: 'That did not work. Check the details and try again.' };
    const body = await response.json() as { sessionId: string; userName?: string };
    sessionId = body.sessionId;
    userName = body.userName;
  } catch {
    return { ok: false, error: 'The identity service could not be reached.' };
  }

  try {
    const { verifier, challenge } = await pkce();

    const authorize = await fetch(`${issuerBase()}/protocol/openid-connect/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: CONSOLE_CLIENT_ID,
        redirect_uri: redirectUri(),
        response_type: 'code',
        session_id: sessionId,
        scope: 'openid profile email',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!authorize.ok) return { ok: false, error: 'Signed in, but this console could not obtain a token.' };
    const { code } = await authorize.json() as { code: string };

    const token = await fetch(`${issuerBase()}/protocol/openid-connect/token`, {
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
    if (!token.ok) return { ok: false, error: 'Signed in, but the token exchange was refused.' };

    const { access_token: accessToken, expires_in: expiresIn } = await token.json() as {
      access_token?: string; expires_in?: number;
    };
    if (!accessToken) return { ok: false, error: 'The authority returned no access token.' };

    const store = await cookies();
    store.set(SESSION_COOKIE, accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: expiresIn ?? 900,
    });

    return { ok: true, ...(userName ? { userName } : {}) };
  } catch {
    return { ok: false, error: 'The identity service could not be reached.' };
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
    return {
      subjectId: claims.sub,
      ...(claims.preferred_username ?? claims.name ? { userName: (claims.preferred_username ?? claims.name) as string } : {}),
      roles: Array.isArray(claims.roles) ? claims.roles.map(String) : [],
    };
  } catch {
    return null;
  }
}
