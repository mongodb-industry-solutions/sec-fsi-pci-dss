/**
 * The merchant app starts its sign-in at the AUTHORIZATION ENDPOINT, and gets a scoped roster.
 *
 * The bank pins the same thing, and the merchant did not, which is how it kept pointing at the
 * authority's sign-in page after that page stopped reading OAuth parameters. Two consequences, both
 * silent: the person is signed in and stranded with no code and no way back, and the demo roster is
 * unscoped, so a merchant's screen offers the payment service's analysts and the bank's staff.
 *
 * Skipped unless the merchant app and the authority are both listening.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const MERCHANT = process.env.PSP_MERCHANT_BASE_URL ?? 'http://localhost:8082';
const AUTHORITY = process.env.GIAM_BASE_URL ?? 'http://127.0.0.1:8085';
const MERCHANT_CLIENT_ID = 'oauth001-0000-4000-8000-000000000001';

// Roles that belong to the payment service or the bank, and to no merchant application's screen.
const NOT_THE_MERCHANTS = [
  'level1_analyst', 'level2_investigator', 'merchant_officer', 'operations_officer',
  'manager', 'security_auditor',
  'bank_admin', 'bank_card_officer', 'bank_compliance', 'bank_customer', 'bank_operations',
];

async function reachable(): Promise<boolean> {
  try {
    await fetch(`${MERCHANT}/`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function startSignIn(): Promise<URL> {
  const start = await fetch(`${MERCHANT}/api/auth/login`, {
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  });
  return new URL(start.headers.get('location') ?? '');
}

describe('the merchant app starts sign-in at the authority', () => {
  let live = false;

  beforeAll(async () => { live = await reachable(); });

  it('addresses the authorization endpoint, not the authority sign-in page', async () => {
    if (!live) return;
    const location = await startSignIn();
    // The realm is in the path, not a parameter: that is the shared realm seen from here.
    expect(location.pathname, 'the request must go to the authorization endpoint')
      .toBe('/realms/leafypay/protocol/openid-connect/auth');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('client_id')).toBe(MERCHANT_CLIENT_ID);
    expect(location.searchParams.get('code_challenge_method'), 'PKCE is not optional here').toBe('S256');
  });

  it('is parked at a sign-in screen carrying a request_id and nothing else', async () => {
    if (!live) return;
    const parked = await fetch(await startSignIn(), {
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
    const screen = new URL(parked.headers.get('location') ?? '');
    expect(screen.searchParams.get('request_id'), 'the screen is named a pending request').toBeTruthy();
    // Carrying them would let a detour through sign-in alter the request that gets exercised.
    expect(screen.searchParams.get('client_id')).toBeNull();
    expect(screen.searchParams.get('redirect_uri')).toBeNull();
  });

  it('offers only the personas the merchant client declares', async () => {
    if (!live) return;
    const parked = await fetch(await startSignIn(), {
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
    const requestId = new URL(parked.headers.get('location') ?? '').searchParams.get('request_id');
    expect(requestId).toBeTruthy();

    const context = await fetch(
      `${AUTHORITY}/realms/leafypay/login-context?request_id=${encodeURIComponent(requestId as string)}`,
      { signal: AbortSignal.timeout(20000) },
    );
    expect(context.ok).toBe(true);
    const roster = (await context.json() as { roster: Array<{ role?: string }> }).roster;
    const offered = [...new Set(roster.map((entry) => entry.role ?? '(none)'))];

    expect(offered).toContain('customer');
    for (const role of NOT_THE_MERCHANTS) {
      expect(offered, `${role} has no place on a merchant application's sign-in screen`).not.toContain(role);
    }
  });
});
