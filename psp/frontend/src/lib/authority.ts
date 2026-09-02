import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';

/**
 * Signing a person in, by sending them to the authority and taking a code back.
 *
 * This app never sees a password. It starts an authorization code request with PKCE, the authority
 * hosts the sign-in, and the code that comes back is exchanged here. Collecting the credential in this
 * app, even to forward it, would make it a second place credentials are handled, which is what moving
 * identity out was for. Same shape as the bank's and the merchant's, deliberately.
 */

const SESSION_COOKIE = 'demo_token';
const IDENTITY_COOKIE = 'demo_identity';
/**
 * The refresh token, and the only cookie here that is httpOnly.
 *
 * It IS a credential: it mints access tokens, so script must not be able to read it. The access token
 * beside it is readable because `apiFetch` sends it from the browser, and that asymmetry is the point
 * rather than an inconsistency.
 */
const REFRESH_COOKIE = 'demo_refresh';
const VERIFIER_COOKIE = 'leafypay.pkce';
const STATE_COOKIE = 'leafypay.state';
const REALM = 'leafypay';
const CONSOLE_CLIENT_ID = 'leafypay-console';
const TIMEOUT_MS = 10000;

// Server side: where this app calls the token endpoint, which is not where the browser is sent.
function issuerBase(): string {
  const raw = process.env.PSP_GIAM_ISSUER_URL
    ?? process.env.GIAM_ISSUER_URL
    ?? 'http://127.0.0.1:8085/realms/leafypay';
  return raw.replace(/\/$/, '');
}

// The browser-facing console, which is a different address: the sign-in page is opened by a person.
function authorityUi(): string {
  const raw = process.env.NEXT_PUBLIC_PSP_URL_AUTHORITY_FRONTEND_PUBLIC
    ?? process.env.PSP_GIAM_UI_URL
    ?? 'http://localhost:8086';
  return raw.replace(/\/$/, '');
}

function appBase(): string {
  return (process.env.PSP_URL_FRONTEND ?? 'http://localhost:8080').replace(/\/$/, '');
}

function redirectUri(): string {
  return `${appBase()}/api/auth/callback`;
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
 * reliably merged into a returned redirect across Next versions. A verifier that silently fails to
 * persist produces an invalid_state on the way back, which reads like an attack rather than a
 * framework detail.
 */
export function startSignIn(): LoginStart {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');

  const url = new URL(`${authorityUi()}/auth/login`);
  url.searchParams.set('realm', REALM);
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

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * Writes a freshly issued set of tokens, in one place so signing in and refreshing cannot disagree.
 *
 * The access token cookie lives exactly as long as the token does. Making it outlive its own contents
 * is what the old 24-hour session cookie did, and it produced a browser that believed it was signed in
 * while every API call was refused.
 */
function persistSession(
  store: CookieStore,
  tokens: { accessToken: string; idToken?: string; refreshToken?: string; expiresIn?: number },
): void {
  const readable = {
    httpOnly: false,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: tokens.expiresIn ?? 900,
  };
  store.set(SESSION_COOKIE, tokens.accessToken, readable);
  // The access token carries no name and no email, by design. The id_token is the only answer to
  // "who is this", so the screens get it too; it is never sent anywhere as a credential.
  if (tokens.idToken) store.set(IDENTITY_COOKIE, tokens.idToken, readable);
  if (tokens.refreshToken) {
    store.set(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      // The authority's refresh lifetime is thirty days. A shorter cookie would sign a person out
      // while the credential it holds is still perfectly valid.
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

/**
 * Trades the refresh token for a new access token, and rotates the stored one.
 *
 * Needed because the access token lives fifteen minutes while a demo session lasts hours. Without
 * this the browser simply stopped being signed in mid-flow, and the screens that ask "is somebody
 * here" answered no: the hosted checkout stopped offering the buyer's saved cards, which reads as a
 * checkout bug rather than an expiry.
 *
 * The authority RETIRES the presented token as it redeems it, so the new one has to be written or the
 * next refresh fails. That is why this cannot happen in the browser: the credential is httpOnly.
 */
export async function refreshSession(): Promise<ExchangeResult> {
  const store = await cookies();
  const presented = store.get(REFRESH_COOKIE)?.value;
  if (!presented) return { ok: false, error: 'no_refresh_token' };

  try {
    const response = await fetch(`${issuerBase()}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: presented,
        client_id: CONSOLE_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // A refused refresh is a finished session, so nothing is left behind pretending otherwise.
      clearSession(store);
      return { ok: false, error: 'refresh_refused' };
    }

    const {
      access_token: accessToken, id_token: idToken, refresh_token: refreshToken,
      expires_in: expiresIn,
    } = await response.json() as {
      access_token?: string; id_token?: string; refresh_token?: string; expires_in?: number;
    };
    if (!accessToken) {
      clearSession(store);
      return { ok: false, error: 'no_token' };
    }
    persistSession(store, { accessToken, idToken, refreshToken, expiresIn });
    return { ok: true };
  } catch {
    // Left alone on a transport failure: the session is probably still valid and the next attempt
    // will say so. Clearing it here would sign somebody out because a network blinked.
    return { ok: false, error: 'authority_unreachable' };
  }
}

/** Removes every cookie this module owns, including the one script cannot reach. */
export function clearSession(store: CookieStore): void {
  store.delete(SESSION_COOKIE);
  store.delete(IDENTITY_COOKIE);
  store.delete(REFRESH_COOKIE);
}

/** Exchanges the returned code for a token, after checking the state this app itself issued. */
export async function completeSignIn(code: string, state: string): Promise<ExchangeResult> {
  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  const verifier = store.get(VERIFIER_COOKIE)?.value;

  store.delete(STATE_COOKIE);
  store.delete(VERIFIER_COOKIE);

  // Without this the callback accepts a code obtained in somebody else's browser.
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

    const {
      access_token: accessToken, id_token: idToken, refresh_token: refreshToken,
      expires_in: expiresIn,
    } = await response.json() as {
      access_token?: string; id_token?: string; refresh_token?: string; expires_in?: number;
    };
    if (!accessToken) return { ok: false, error: 'no_token' };

    persistSession(store, { accessToken, idToken, refreshToken, expiresIn });
    return { ok: true };
  } catch {
    return { ok: false, error: 'authority_unreachable' };
  }
}
