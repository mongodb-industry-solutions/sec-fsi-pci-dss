// v37 P3.7b (PSP side): the PSP holds the TPP credential in the provider arrangement record and
// exchanges it for a scoped token at the bank's token endpoint.
//
// The property that matters is the absence of a fallback: when the record carries no credential the
// call must fail, because the alternative (minting a token with the shared platform secret) is exactly
// what this replaces.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import {
  getProviderAccessToken, resetProviderTokenCache,
} from '../../../../backend/src/modules/provider/services/providerAccessToken.service';

const WITH_CREDENTIAL = {
  externalProviderArrangementInstanceReference: 'int-internal-ais-001',
  externalProviderArrangementType: 'account_information',
  externalProviderArrangementStatus: 'active',
  externalProviderIsInternal: true,
  authConfig: {
    scheme: 'oauth2_cc',
    oauth2: {
      clientId: 'leafypay-psp',
      clientSecretPlaintext: 'dev-bankcore-tpp-secret',
      tokenEndpoint: 'http://bank:8083/v1/oauth/token',
      scopes: ['accounts', 'balances'],
      tokenCachingEnabled: true,
    },
  },
};

function fakeDb(records: unknown[]): Db {
  return { collection: () => ({ find: () => ({ async toArray() { return records; } }) }) } as unknown as Db;
}

// Records every token request so the body can be asserted as the grant defines it.
function fakeTokenEndpoint(payload: unknown, ok = true, status = 200) {
  const calls: Array<{ url: string; body: string }> = [];
  const impl = (async (url: string, init: Record<string, unknown>) => {
    calls.push({ url, body: String(init.body) });
    return { ok, status, json: async () => payload };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(() => resetProviderTokenCache());

describe('v37 P3.7b: the PSP exchanges its credential for a scoped token', () => {
  it('posts the client credentials grant and returns the access token', async () => {
    const { impl, calls } = fakeTokenEndpoint({ access_token: 'bank-token', expires_in: 300 });
    const result = await getProviderAccessToken('account_information', {
      db: fakeDb([WITH_CREDENTIAL]), scope: 'balances', fetchImpl: impl,
    });
    expect(result.accessToken).toBe('bank-token');
    expect(calls[0].url).toBe('http://bank:8083/v1/oauth/token');
    const body = new URLSearchParams(calls[0].body);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('leafypay-psp');
    expect(body.get('scope')).toBe('balances');
  });

  it('defaults the scope to what the record grants, so the caller need not repeat it', async () => {
    const { impl, calls } = fakeTokenEndpoint({ access_token: 'bank-token', expires_in: 300 });
    await getProviderAccessToken('account_information', { db: fakeDb([WITH_CREDENTIAL]), fetchImpl: impl });
    expect(new URLSearchParams(calls[0].body).get('scope')).toBe('accounts balances');
  });

  it('caches the token, so a page of accounts costs one exchange rather than one each', async () => {
    const { impl, calls } = fakeTokenEndpoint({ access_token: 'bank-token', expires_in: 300 });
    const db = fakeDb([WITH_CREDENTIAL]);
    await getProviderAccessToken('account_information', { db, scope: 'balances', fetchImpl: impl });
    await getProviderAccessToken('account_information', { db, scope: 'balances', fetchImpl: impl });
    expect(calls.length).toBe(1);
  });

  it('does not reuse a token across scopes, since a scope is what the bank enforces on', async () => {
    const { impl, calls } = fakeTokenEndpoint({ access_token: 'bank-token', expires_in: 300 });
    const db = fakeDb([WITH_CREDENTIAL]);
    await getProviderAccessToken('account_information', { db, scope: 'balances', fetchImpl: impl });
    await getProviderAccessToken('account_information', { db, scope: 'demo-credits', fetchImpl: impl });
    expect(calls.length).toBe(2);
  });

  it('never caches a token past its expiry', async () => {
    const { impl, calls } = fakeTokenEndpoint({ access_token: 'bank-token', expires_in: 1 });
    const db = fakeDb([WITH_CREDENTIAL]);
    await getProviderAccessToken('account_information', { db, scope: 'balances', fetchImpl: impl });
    // One second minus the refresh margin is already in the past, so the next call re-exchanges.
    await getProviderAccessToken('account_information', { db, scope: 'balances', fetchImpl: impl });
    expect(calls.length).toBe(2);
  });

  it('fails with a reason when no provider carries a credential, and NEVER falls back', async () => {
    const withoutCredential = { ...WITH_CREDENTIAL, authConfig: { scheme: 'api_key' } };
    const { impl, calls } = fakeTokenEndpoint({ access_token: 'must-not-be-requested' });
    const result = await getProviderAccessToken('account_information', {
      db: fakeDb([withoutCredential]), fetchImpl: impl,
    });
    expect(result.accessToken).toBeUndefined();
    expect(result.error).toContain('client credentials');
    expect(calls.length).toBe(0);
  });

  it("reports the bank's refusal instead of returning an unusable token", async () => {
    const { impl } = fakeTokenEndpoint({ error: 'invalid_client', error_description: 'Unknown client' }, false, 401);
    const result = await getProviderAccessToken('account_information', {
      db: fakeDb([WITH_CREDENTIAL]), fetchImpl: impl,
    });
    expect(result.accessToken).toBeUndefined();
    expect(result.error).toContain('Unknown client');
  });
});
