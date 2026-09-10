import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import { cache } from 'react';

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
const CONSOLE_CLIENT_ID = 'bankcore-console';
const TIMEOUT_MS = 10000;

function issuerBase(): string {
  const raw = process.env.PSP_BANKCORE_GIAM_ISSUER_URL
    ?? process.env.BANKCORE_GIAM_ISSUER_URL
    ?? 'http://127.0.0.1:8085/realms/leafypay';
  return raw.replace(/\/$/, '');
}

/**
 * The authority's API as the BROWSER reaches it, which is not the address this server uses.
 *
 * The authorization request is followed by a person, so it cannot be sent to an in-network host.
 * This is the issuer, not the console: since the endpoint became conforming the console is an
 * ordinary client of it and no longer reads OAuth parameters out of its own URL.
 *
 * The realm in this path is the SHARED one (ADR-003). The bank is a client here and not a directory
 * of its own: what keeps it separate from the payment service is its own resource server, its own
 * roles and its own token audience, none of which depends on a second realm. The gain is that a
 * person exists once instead of twice.
 */
function authorityIssuerPublic(): string {
  const raw = process.env.NEXT_PUBLIC_BANKCORE_AUTHORITY_ISSUER_URL
    ?? process.env.NEXT_PUBLIC_PSP_URL_AUTHORITY_ISSUER
    ?? 'http://localhost:8085/realms/leafypay';
  return raw.replace(/\/$/, '');
}

function appBase(): string {
  return (process.env.PSP_BANKCORE_FRONTEND_URL ?? 'http://localhost:8084').replace(/\/$/, '');
}

function redirectUri(): string {
  return `${appBase()}/api/auth/callback`;
}

/**
 * The identity console's own address, for the one other thing besides sign-in a browser is sent to
 * it for: ending the session every application here shares, not just this one's.
 *
 * Read at request time inside a route handler, same as `authorityIssuerPublic` above, never inlined:
 * this app builds with no `NEXT_PUBLIC_*` argument, so nothing about the authority's address is ever
 * in the bundle the browser downloads. A redirect's `Location` header carries it instead.
 */
export function authorityUiPublic(): string {
  const raw = process.env.NEXT_PUBLIC_BANKCORE_AUTHORITY_FRONTEND_PUBLIC_URL
    ?? process.env.NEXT_PUBLIC_PSP_URL_AUTHORITY_FRONTEND_PUBLIC
    ?? 'http://localhost:8086';
  return raw.replace(/\/$/, '');
}

/** This app's own public origin, the only address its post-logout redirect is ever registered for. */
export function appPublicBase(): string {
  return appBase();
}

export interface LoginStart {
  url: string;
  /** Attached to the redirect response by the caller, never through next/headers. */
  cookies: Array<{ name: string; value: string }>;
}

/**
 * Where to send the browser, and the short-lived state to attach to that same response.
 *
 * The cookies are returned rather than set here because a mutation through `next/headers` is not
 * reliably merged into a returned redirect across Next versions, and the merchant's flow already
 * carries that scar. A verifier that silently fails to persist produces an invalid_state on the way
 * back, which reads like an attack rather than a framework detail.
 */
export function startSignIn(): LoginStart {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');

  /**
   * The AUTHORIZATION ENDPOINT, not the authority's sign-in page.
   *
   * The sign-in page was the right target while the console owned the flow and read `client_id`,
   * `redirect_uri` and the rest out of its own URL. It is a client of the endpoint now: the endpoint
   * holds the pending request and sends the browser on to sign in carrying only a `request_id`. So a
   * request arriving at the sign-in page with raw OAuth parameters reads as "somebody opened the
   * sign-in page", and the person would be signed in and left there with no way back to the bank.
   *
   * The realm is not a parameter: it is in the path.
   */
  const url = new URL(`${authorityIssuerPublic()}/protocol/openid-connect/auth`);
  url.searchParams.set('client_id', CONSOLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return {
    url: url.toString(),
    cookies: [
      { name: VERIFIER_COOKIE, value: verifier },
      { name: STATE_COOKIE, value: state },
    ],
  };
}

/** The attributes the short-lived login cookies carry, in one place. */
export const LOGIN_COOKIE_OPTIONS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 600,
};

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
 * The person's profile, from the authority's userinfo endpoint.
 *
 * An access token carries authority, not a profile. It names the subject, what it is good for and
 * what the holder may do, and nothing about who they are, which is what keeps it small and is where
 * a name belongs least: it is the credential presented on every call. So the name is asked for
 * separately, by the one endpoint whose purpose is to answer that question.
 *
 * Deduplicated per request, because several server components render the header on one page and
 * each one would otherwise ask again.
 */
const profileOf = cache(async (token: string): Promise<{ name?: string; preferred_username?: string }> => {
  try {
    const response = await fetch(`${issuerBase()}/protocol/openid-connect/userinfo`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    // An unreachable authority costs the display name, not the session: the token is still valid
    // and every guarded call still works, so signing the person out here would be the worse answer.
    return {};
  }
});

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
      sub?: string; roles?: unknown; exp?: number;
    };
    if (!claims.sub) return null;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;

    /**
     * The name came from `preferred_username` and `name` ON THE ACCESS TOKEN, which never carried
     * either, so it was always absent and the console greeted everybody as "Signed in".
     */
    const profile = await profileOf(token);
    const userName = profile.preferred_username ?? profile.name;
    return {
      subjectId: claims.sub,
      ...(userName ? { userName } : {}),
      roles: Array.isArray(claims.roles) ? claims.roles.map(String) : [],
    };
  } catch {
    return null;
  }
}
