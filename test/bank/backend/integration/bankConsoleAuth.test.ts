/**
 * The bank's back office is behind a sign-in, and behind a ROLE.
 *
 * Before this, the console minted its own administrator token and the bank refused it, so every
 * screen was a 401 while the app looked fine. The fix was to carry the signed-in person's token, and
 * the property worth pinning is not that signing in works: it is that signing in as the WRONG person
 * still fails. An authentication gate that authorises nobody is the easy half.
 *
 * Skipped unless the bank console and the authority are both listening.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CONSOLE = process.env.BANK_UI_URL ?? 'http://localhost:8084';

// Seeded personas: one holds the bank's administrator role, one is an ordinary account holder.
const ADMIN = 'Samuel Adeyemi';
const CUSTOMER = 'Elena Duarte';
const DEMO_PASSWORD = 'demo-password';

// A resource the bank guards with `bankModules: view`.
const GUARDED = '/api/admin/module/config';

async function reachable(): Promise<boolean> {
  try {
    await fetch(`${CONSOLE}/`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

/** Signs in and returns the session cookie the console set, or '' when it refused. */
async function signIn(login: string): Promise<string> {
  const response = await fetch(`${CONSOLE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, password: DEMO_PASSWORD }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return '';
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

describe('v39: the bank console authenticates and authorises', () => {
  let live = false;

  beforeAll(async () => { live = await reachable(); });

  it('refuses a guarded resource when nobody is signed in', async () => {
    if (!live) return;
    const response = await fetch(`${CONSOLE}${GUARDED}`, { signal: AbortSignal.timeout(20000) });
    expect(response.status, 'an unauthenticated console must reach nothing').toBe(401);
  });

  it('refuses a wrong password', async () => {
    if (!live) return;
    const response = await fetch(`${CONSOLE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: ADMIN, password: 'not-the-password' }),
      signal: AbortSignal.timeout(20000),
    });
    expect(response.status).toBe(401);
  });

  it('sets an httpOnly session cookie, so the browser never holds the token', async () => {
    if (!live) return;
    const response = await fetch(`${CONSOLE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: ADMIN, password: DEMO_PASSWORD }),
      signal: AbortSignal.timeout(20000),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie, 'the session cookie must be httpOnly').toMatch(/httponly/i);
  });

  it('serves the guarded resource to a person holding the role', async () => {
    if (!live) return;
    const cookie = await signIn(ADMIN);
    expect(cookie, `${ADMIN} could not sign in`).toBeTruthy();

    const response = await fetch(`${CONSOLE}${GUARDED}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(20000),
    });
    expect(response.status).toBe(200);
  });

  it('refuses the same resource to a signed-in person WITHOUT the role', async () => {
    if (!live) return;
    const cookie = await signIn(CUSTOMER);
    expect(cookie, `${CUSTOMER} could not sign in`).toBeTruthy();

    const response = await fetch(`${CONSOLE}${GUARDED}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(20000),
    });
    // Authenticated and still refused, which is the difference between a login and authorisation.
    expect(response.status, 'an account holder must not administer the bank').toBe(403);
  });
});
