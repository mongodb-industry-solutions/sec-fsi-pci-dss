import { createHash, randomBytes } from 'crypto';

/**
 * The authorization code flow, driven the way a conforming client drives it.
 *
 * One helper because four suites across two applications were each doing it by hand, and each had
 * memorised the shape the authority's endpoint used to have: a POST with a JSON body carrying
 * `session_id`, a JSON response holding the code, and a second POST repeating the request with
 * `consent_granted: true`. When the authority made the endpoint conforming, all four broke in the
 * same way for the same reason, which is what a shared helper exists to prevent.
 *
 * What it exercises is deliberately the real thing rather than a shortcut: the session arrives as a
 * COOKIE, the authorization endpoint is a `GET`, and the code is read out of the `Location` header
 * of a 302. A test that took a shortcut past any of those would pass while the flow was broken for
 * every browser.
 */

const TIMEOUT = 20000;

/** The session cookie a sign-in hands back, ready to be sent on the next request. */
export function sessionCookieFrom(response: Response): string | undefined {
  const header = response.headers.get('set-cookie');
  if (!header) return undefined;
  const match = /giam_session=([^;]+)/.exec(header);
  return match ? `giam_session=${match[1]}` : undefined;
}

export interface SignedInSession {
  sessionId: string;
  cookie: string;
  subjectId: string;
}

/** Signs in and keeps both halves: the id for anything that names a session, the cookie for the flow. */
export async function signIn(
  authority: string, realm: string, login: string, password: string,
): Promise<SignedInSession | null> {
  const response = await fetch(`${authority}/realms/${realm}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!response.ok) return null;
  const cookie = sessionCookieFrom(response);
  if (!cookie) return null;
  const body = await response.json() as { sessionId: string; subjectId: string };
  return { sessionId: body.sessionId, cookie, subjectId: body.subjectId };
}

export interface CodeRequest {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  /** Supply one to redeem the code afterwards; omit and the helper generates the pair. */
  codeChallenge?: string;
}

/**
 * Runs the flow as far as the code, answering the consent question when the authority asks it.
 *
 * Returns '' rather than throwing, so a suite can assert "this persona could not get a code" as a
 * value instead of an exception.
 */
export async function authorizationCode(
  authority: string, realm: string, cookie: string, request: CodeRequest,
): Promise<string> {
  const url = new URL(`${authority}/realms/${realm}/protocol/openid-connect/auth`);
  url.searchParams.set('client_id', request.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', request.scope ?? 'openid profile');
  url.searchParams.set('code_challenge', request.codeChallenge ?? '');
  url.searchParams.set('code_challenge_method', 'S256');
  if (request.state) url.searchParams.set('state', request.state);

  // Manual, because the redirect IS the answer: following it would fetch the client's callback page
  // and lose the code that is in the Location header.
  const options = { headers: { cookie }, redirect: 'manual' as const, signal: AbortSignal.timeout(TIMEOUT) };
  let location = (await fetch(url, options)).headers.get('location');
  if (!location) return '';

  /**
   * ANSWER THE CONSENT QUESTION when the authority asks it.
   *
   * A client that is not first party needs the person's approval before a code exists, and that
   * approval is recorded by the authority against the pending request rather than asserted by the
   * caller. A helper that stopped at the first redirect would report "could not sign in" for every
   * third-party client on a freshly seeded directory, and pass only where a grant already existed.
   */
  if (location.includes('/auth/consent')) {
    const requestId = new URL(location).searchParams.get('request_id');
    if (!requestId) return '';

    const decided = await fetch(`${authority}/realms/${realm}/protocol/openid-connect/auth/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      // No `granted_scopes`, which means all of them: this helper exists to obtain a working token,
      // and partial consent is asserted where it belongs, in the authority's own suite.
      body: JSON.stringify({ request_id: requestId, approved: true }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!decided.ok) return '';

    const { continue: next } = await decided.json() as { continue: string };
    location = (await fetch(next, options)).headers.get('location');
    if (!location) return '';
  }

  // A redirect carrying `error` instead of `code` is a refusal delivered the way the specification
  // says to deliver one, so it is not an exception here either.
  return new URL(location).searchParams.get('code') ?? '';
}

/** The whole flow, ending in an access token, or '' when any step refuses. */
export async function interactiveToken(
  authority: string,
  realm: string,
  login: string,
  password: string,
  clientId: string,
  redirectUri: string,
  scope = 'openid profile',
): Promise<string> {
  const session = await signIn(authority, realm, login, password);
  if (!session) return '';

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const code = await authorizationCode(authority, realm, session.cookie, {
    clientId, redirectUri, scope, codeChallenge: challenge,
  });
  if (!code) return '';

  const token = await fetch(`${authority}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!token.ok) return '';
  return (await token.json() as { access_token?: string }).access_token ?? '';
}
