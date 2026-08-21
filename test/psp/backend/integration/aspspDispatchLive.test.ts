// v37 P6.2d: a real ASPSP call, end to end THROUGH dispatchProvider rather than through a bespoke client.
//
// This is the claim the routing work exists to support: a standard bank API is reachable through the same
// pipeline as any other provider, so it gets the same audit row, the same field mapping and the same
// substitutability. Before it, a host-less configured path resolved against PSP_BASE_URL and was sent to the
// PSP itself, so no configuration could ever reach a bank and a hand-written client was the only option.
//
// Skipped unless the bank is listening, because the point is that a real institution answers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildContractApp, closeContractApp } from './support/contract';
import { dispatchProvider, resolveServiceUrl } from '../../../../psp/backend/src/modules/provider/services/integrationDispatch.service';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../../../psp/backend/src/modules/gateway/models/payoutAccount.model';
import { EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION } from '../../../../psp/backend/src/modules/provider/models/externalProviderArrangement.model';

const BANK = process.env.PSP_BANKCORE_BASE_URL ?? 'http://localhost:8083';

async function bankIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${BANK}/health`, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch { return false; }
}

describe('v37 P6.2d: the bank is reachable through the dispatch pipeline', () => {
  it('resolves a host-less path against the PROVIDER base URL when it has one', () => {
    // The unit of the fix. Pure, so it holds with or without a running bank.
    expect(resolveServiceUrl('/v1/accounts/x/balances', 'http://bank.example:8083'))
      .toBe('http://bank.example:8083/v1/accounts/x/balances');
    // And falls back to the PSP for the built-in loopback engines, which is what it did before.
    expect(resolveServiceUrl('/api/v1/modules/account-information/validate'))
      .toContain('/api/v1/modules/account-information/validate');
    // An absolute URL is never rewritten, whatever the provider says.
    expect(resolveServiceUrl('https://elsewhere.example/v1/x', 'http://bank.example:8083'))
      .toBe('https://elsewhere.example/v1/x');
  });

  it('trims a blank provider base URL rather than producing http:///path', () => {
    // A record seeded without a base URL must not turn into a malformed host.
    expect(resolveServiceUrl('/v1/x', '   ')).not.toContain('http:///');
  });
});

describe('v37 P6.2d: a live ASPSP read through dispatchProvider', () => {
  let app: FastifyInstance | undefined;
  let live = false;

  beforeAll(async () => {
    live = await bankIsUp();
    if (!live) return;
    app = await buildContractApp();
  });

  afterAll(async () => {
    if (app) await closeContractApp(app);
  });

  it('carries the bank base URL on the same record as its credential', async () => {
    if (!app) return;
    // The two must come from ONE record: picking a host from one and a token from another is how a
    // credential ends up presented at the wrong bank.
    const provider = await app.db.collection(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION)
      .findOne({ externalProviderArrangementInstanceReference: 'int-internal-ais-001' });
    expect(provider?.externalProviderBaseUrl, 'the seeder must resolve the bank link').toBeTruthy();
    expect((provider as { authConfig?: { scheme?: string } })?.authConfig?.scheme).toBe('oauth2_cc');
  });

  it('declares the standard path as configuration, not as code', async () => {
    if (!app) return;
    const provider = await app.db.collection(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION)
      .findOne({ externalProviderArrangementInstanceReference: 'int-internal-ais-001' });
    const events = (provider?.externalProviderEvents ?? []) as Array<{ event: string; outbound?: { url?: string; httpMethod?: string } }>;
    const balanceRead = events.find((e) => e.event === 'bank.balance.read.requested');
    expect(balanceRead?.outbound?.url, 'the bank path must be declared on the record').toBe('/v1/accounts/{accountId}/balances');
    expect(balanceRead?.outbound?.httpMethod).toBe('GET');
  });

  it('reads a real balance from the bank through the pipeline, and audits it', async () => {
    if (!app) return;
    // A genuinely linked account, so there is something at the bank to read.
    const account = await app.db.collection(PAYOUT_ACCOUNT_COLLECTION).findOne({
      payoutAccountBankAccountReference: { $exists: true, $ne: null },
      payoutAccountConsentReference: { $exists: true, $ne: null },
    });
    if (!account) return;

    const result = await dispatchProvider(
      app.db,
      'account_information',
      // The declared event decides the path and the method, which is the whole point.
      'bank.balance.read.requested',
      {
        accountId: account.payoutAccountBankAccountReference,
        // Spent on the declared `Consent-ID` header, not sent in the body: Berlin Group carries the consent
        // in a header, and templating one is what makes a standard bank API configurable rather than coded.
        consentId: account.payoutAccountConsentReference,
        correlationId: 'p6-2d-live',
      },
      undefined,
      { accountReference: account.payoutAccountInstanceReference as string },
    );

    // Sent, and to the BANK. An error here is the finding: it means the pipeline still cannot reach it.
    expect(result.status, `dispatch: ${JSON.stringify(result)}`).not.toBe('error');
    expect(result.provider, 'the call must leave the PSP').toBe('external');
    expect(result.responseCode).toBe(200);

    // And it answered with a BALANCE. "not an error" would also be true of an empty 200, which would leave
    // the claim resting on nothing.
    const body = result.responseBody as { balances?: Array<{ balanceAmount?: { amount?: unknown; currency?: unknown } }> };
    expect(Array.isArray(body?.balances), `no balances in ${JSON.stringify(result.responseBody).slice(0, 200)}`).toBe(true);
    expect(body.balances!.length).toBeGreaterThan(0);
    expect(body.balances![0].balanceAmount?.currency).toBeTruthy();

    // Audited like every other capability, which is the reason to route it here rather than through a client.
    const logged = await app.db.collection('externalProviderArrangementActionLog').findOne(
      { externalProviderArrangementInstanceReference: 'int-internal-ais-001' },
      { sort: { recordCreatedDateTime: -1 } },
    );
    expect(logged, 'the dispatch must leave an audit row').toBeTruthy();
  }, 60000);
});
