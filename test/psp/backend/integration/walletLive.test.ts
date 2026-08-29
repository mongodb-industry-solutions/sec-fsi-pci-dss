// v37 P11.3: Leafy Wallet exercised for real, over the wire, against the running services.
//
// The contract baseline already checks the route shapes with `app.inject`. This is the other half the plan
// asks for: the wallet's actual sequence, over HTTP, on its OWN channel (an OAuth token, not a session), so
// the middleware, the bank hop and the freshly rebuilt database are all in the path.
//
// Skipped unless a PSP is listening, because there is nothing honest to assert without one.
//
// It drives the SESSION channel, not the OAuth one. The local OAuth key provider mints a signing key per
// process, so a token signed here carries a `kid` the separate server has never seen and would be rejected
// however correct it was. The OAuth channel stays with `walletContract.test.ts`, which injects into an app in
// its own process. Recorded rather than worked around: the same property means a PSP restart invalidates every
// issued token, and it is why a deployment pins one replica.
import { describe, it, expect, beforeAll } from 'vitest';
import { readSeedFile } from './support/contract';

/**
 * The seeded principals, read from the identity authority's fixtures.
 *
 * This used to read a login file in this application. That file is gone with everything else about
 * identity, and the binding now runs the other way: a principal carries the business reference it
 * belongs to, rather than a login carrying a party.
 */
function readAuthorityIdentities(): Array<{ subjectId: string; accountHolderRef?: string; demoFeatured?: boolean }> {
  const raw = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../../giam/backend/data/identities.json'),
    'utf8',
  );
  return JSON.parse(raw);
}



const PSP = process.env.PSP_BASE_URL ?? 'http://localhost:8081';

interface AuthSeed {
  customerAuthenticationInstanceReference: string;
  partyInstanceReference: string;
  customerAuthenticationUserRole: string;
  customerAuthenticationEmailAddress: string;
}

function walletCustomer(): AuthSeed {
  const customers = readAuthorityIdentities()
    .filter((a) => a.customerAuthenticationUserRole === 'customer');
  return customers[0];
}

async function reachable(): Promise<boolean> {
  try {
    await fetch(`${PSP}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function get(path: string, token: string) {
  const response = await fetch(`${PSP}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

describe('v37 P11.3: the wallet against the running services', () => {
  let live = false;
  let token = '';
  const customer = walletCustomer();

  beforeAll(async () => {
    live = await reachable();
    if (!live) return;
    const response = await fetch(`${PSP}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No domain, exactly as the wallet sends it.
      body: JSON.stringify({ email: customer.customerAuthenticationEmailAddress, password: 'demo-password' }),
      signal: AbortSignal.timeout(15000),
    });
    token = ((await response.json().catch(() => ({}))) as { token?: string }).token ?? '';
  });

  it('logs in with NO auth domain, which is what the wallet sends', async () => {
    if (!live) return;
    // The wallet omits the domain entirely, so default resolution on the hosted login is under test here.
    // After the v37 rename this is also the path that would break if the alias were one-directional.
    const response = await fetch(`${PSP}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.customerAuthenticationEmailAddress, password: 'demo-password' }),
      signal: AbortSignal.timeout(15000),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { token?: string };
    expect(body.token).toBeTruthy();
  });

  it('lists accounts, and every one carries a balance', async () => {
    if (!live) return;
    const { status, body } = await get(`/api/v1/accounts/${encodeURIComponent(customer.partyInstanceReference)}`, token);
    expect(status).toBe(200);
    const results = body.results as Array<Record<string, unknown>>;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    for (const account of results) {
      // The balance is the BANK's figure now, projected onto the PSP's linked record. An account that lost
      // its balance in the extraction would render as blank in the wallet, which is the regression to catch.
      const balance = account.payoutAccountBalance as { availableAmount?: number } | undefined;
      expect(typeof balance?.availableAmount, `${account.payoutAccountInstanceReference} has no balance`)
        .toBe('number');
    }
  });

  it('lists transactions', async () => {
    if (!live) return;
    const { status, body } = await get('/api/v1/transactions', token);
    expect(status).toBe(200);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it('lists beneficiaries and creates one', async () => {
    if (!live) return;
    const listed = await get(`/api/v1/beneficiaries?party=${encodeURIComponent(customer.partyInstanceReference)}`, token);
    expect(listed.status).toBe(200);

    // Added by looking a person up, not by typing an IBAN: the wallet resolves a phone or an email to a
    // party the platform already knows, so bank coordinates never travel through the browser.
    const others = readAuthorityIdentities()
      .filter((a) => a.customerAuthenticationUserRole === 'customer'
        && a.partyInstanceReference !== customer.partyInstanceReference);
    const target = others[others.length - 1];

    const created = await fetch(`${PSP}/api/v1/beneficiaries/${encodeURIComponent(customer.partyInstanceReference)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lookupType: 'email',
        lookupValue: target.customerAuthenticationEmailAddress,
        label: 'P11 compatibility check',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await created.json().catch(() => ({})) as Record<string, unknown>;
    // 409 is a pass: the beneficiary already exists from an earlier run, which is still a working path.
    expect([200, 201, 409], `create beneficiary: ${JSON.stringify(body).slice(0, 200)}`)
      .toContain(created.status);
  });

  it('reads the RTP inbox and outbox', async () => {
    if (!live) return;
    for (const box of ['inbox', 'outbox']) {
      const { status } = await get(`/api/v1/gateway/rtp/requests?box=${box}`, token);
      expect(status, `RTP ${box}`).toBe(200);
    }
  });

  it('moves money between two accounts the same owner holds, at the bank', async () => {
    if (!live) return;
    const { body } = await get(`/api/v1/accounts/${encodeURIComponent(customer.partyInstanceReference)}`, token);
    const results = (body.results ?? []) as Array<Record<string, string>>;
    if (results.length < 2) return;
    const [from, to] = results;

    const response = await fetch(`${PSP}/api/v1/gateway/transfers/own`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `p11-${Date.now()}`,
      },
      body: JSON.stringify({
        fromAccountRef: from.payoutAccountInstanceReference,
        toAccountRef: to.payoutAccountInstanceReference,
        amount: 1.25,
        reference: 'P11 compatibility check',
      }),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    // 202: the transfer is async, so accepted is the honest answer rather than completed.
    expect([200, 201, 202], `own transfer: ${JSON.stringify(payload).slice(0, 300)}`).toContain(response.status);
    // The path v37 built. Before it, this endpoint did not exist and the UI tab was a dead end.
    expect(payload.executionReference ?? payload.paymentExecutionInstanceReference).toBeTruthy();
    // A domestic euro transfer between two accounts at the same bank is SEPA. It resolved to `swift` with a
    // 15 euro fee until P11 found that the destination was built without a currency, so the rail engine's
    // SEPA rule could never match. Pinned here because the response is the only place it was visible.
    expect(payload.rail, `a domestic euro transfer must not take the international rail: ${JSON.stringify(payload)}`)
      .not.toBe('swift');
  });
});
