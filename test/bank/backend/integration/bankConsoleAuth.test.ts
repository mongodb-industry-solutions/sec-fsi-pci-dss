/**
 * The bank's back office is behind an authorization code flow, and behind a ROLE.
 *
 * Two things are pinned here. That the console collects no credential of its own: it starts a code
 * request and receives a code, and the password is only ever presented at the authority. And that
 * signing in as the WRONG person still fails, because an authentication gate that authorises nobody
 * is the easy half.
 *
 * Skipped unless the bank console and the authority are both listening.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CONSOLE = process.env.BANK_UI_URL ?? 'http://localhost:8084';
const AUTHORITY = process.env.GIAM_BASE_URL ?? 'http://127.0.0.1:8085';

// Seeded personas: one holds the bank's administrator role, one is an ordinary account holder.
const ADMIN = 'Samuel Adeyemi';
const CUSTOMER = 'Elena Duarte';
const DEMO_PASSWORD = 'demo-password';

// A resource the bank guards with `bankModules: view`.
const GUARDED = '/api/admin/module/config';

type Jar = Record<string, string>;

function cookieHeader(jar: Jar): string {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');
}

function collect(jar: Jar, response: Response): void {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
}

async function reachable(): Promise<boolean> {
  try {
    await fetch(`${CONSOLE}/`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The whole flow, as the hosted sign-in page drives it in a browser.
 *
 * Returns the console's cookie jar, which holds the session when it worked.
 */
async function signIn(login: string): Promise<{ jar: Jar; codeIssued: boolean }> {
  const jar: Jar = {};

  const start = await fetch(`${CONSOLE}/api/auth/login`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  collect(jar, start);
  const params = new URL(start.headers.get('location') ?? '').searchParams;

  const session = await fetch(`${AUTHORITY}/realms/leafypay/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password: DEMO_PASSWORD }),
    signal: AbortSignal.timeout(20000),
  });
  if (!session.ok) return { jar, codeIssued: false };
  const { sessionId } = await session.json() as { sessionId: string };

  const authorize = await fetch(`${AUTHORITY}/realms/leafypay/protocol/openid-connect/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: params.get('client_id'),
      redirect_uri: params.get('redirect_uri'),
      response_type: 'code',
      scope: params.get('scope'),
      state: params.get('state'),
      session_id: sessionId,
      code_challenge: params.get('code_challenge'),
      code_challenge_method: 'S256',
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!authorize.ok) return { jar, codeIssued: false };
  const { code } = await authorize.json() as { code: string };

  const callback = await fetch(
    `${CONSOLE}/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(params.get('state') ?? '')}`,
    { headers: { cookie: cookieHeader(jar) }, redirect: 'manual', signal: AbortSignal.timeout(20000) },
  );
  collect(jar, callback);
  return { jar, codeIssued: true };
}

describe('v39: the bank console signs in at the authority and authorises by role', () => {
  let live = false;

  beforeAll(async () => { live = await reachable(); });

  it('refuses a guarded resource when nobody is signed in', async () => {
    if (!live) return;
    const response = await fetch(`${CONSOLE}${GUARDED}`, { signal: AbortSignal.timeout(20000) });
    expect(response.status, 'an unauthenticated console must reach nothing').toBe(401);
  });

  it('collects no credential of its own, and starts a code request instead', async () => {
    if (!live) return;
    const start = await fetch(`${CONSOLE}/api/auth/login`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    expect(start.status).toBe(307);

    const location = new URL(start.headers.get('location') ?? '');
    expect(location.pathname, 'the sign-in page belongs to the authority').toBe('/auth/login');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('code_challenge_method'), 'PKCE is not optional here').toBe('S256');
    // The realm the bank sends people to is the shared one (ADR-003); the COOKIE prefix stays
    // `bankcore`, because that names the application holding the session and not the directory.
    expect(location.searchParams.get('realm')).toBe('leafypay');

    // The verifier stays with this app; only its hash travels.
    const cookies = (start.headers.getSetCookie?.() ?? []).join(' ');
    expect(cookies).toMatch(/bankcore\.pkce/);
    expect(cookies, 'the verifier must not be readable by script').toMatch(/httponly/i);
  });

  it('accepts no credential of its own, on the very route that starts the flow', async () => {
    if (!live) return;
    const response = await fetch(`${CONSOLE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: ADMIN, password: DEMO_PASSWORD }),
      signal: AbortSignal.timeout(20000),
    });
    // 405, not 404: the route exists to START the flow and implements no POST at all, so there is
    // nowhere in this app a password can be sent even by an honest mistake.
    expect(response.status, 'a credential must not be postable to this app').toBe(405);
  });

  it('refuses a callback whose state it did not issue', async () => {
    if (!live) return;
    const start = await fetch(`${CONSOLE}/api/auth/login`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const jar: Jar = {};
    collect(jar, start);

    const callback = await fetch(`${CONSOLE}/api/auth/callback?code=whatever&state=not-the-one`, {
      headers: { cookie: cookieHeader(jar) },
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    expect(callback.headers.get('location') ?? '').toContain('state_mismatch');
  });

  it('serves the guarded resource to a person holding the role', async () => {
    if (!live) return;
    const { jar, codeIssued } = await signIn(ADMIN);
    expect(codeIssued, `${ADMIN} could not complete the flow`).toBe(true);
    expect(jar['bankcore.session'], 'the session cookie must be set').toBeTruthy();

    const response = await fetch(`${CONSOLE}${GUARDED}`, {
      headers: { cookie: cookieHeader(jar) },
      signal: AbortSignal.timeout(20000),
    });
    expect(response.status).toBe(200);
  });

  it('refuses the same resource to a signed-in person WITHOUT the role', async () => {
    if (!live) return;
    const { jar, codeIssued } = await signIn(CUSTOMER);
    expect(codeIssued, `${CUSTOMER} could not complete the flow`).toBe(true);

    const response = await fetch(`${CONSOLE}${GUARDED}`, {
      headers: { cookie: cookieHeader(jar) },
      signal: AbortSignal.timeout(20000),
    });
    // Authenticated and still refused, which is the difference between a login and authorisation.
    expect(response.status, 'an account holder must not administer the bank').toBe(403);
  });
});
