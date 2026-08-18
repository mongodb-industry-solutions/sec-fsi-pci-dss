// v37 P2.4/P2.5: the balance the PSP reports is the bank's, and the PSP stops minting money.
//
// Two properties matter more than the mapping itself. With the kill switch off nothing changes, which
// is what makes the migration safe. And a failed read must NEVER produce a number: showing a customer
// a balance of zero because a network call failed is worse than showing the last known figure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const LINKED = {
  payoutAccountInstanceReference: 'pau00001-0000-4000-8000-000000000001',
  payoutAccountBankAccountReference: 'acc00001-0000-4000-8000-000000000001',
  payoutAccountAspspReference: 'bank0001-0000-4000-8000-000000000001',
  payoutAccountConsentReference: 'consent-1',
  payoutAccountBalance: {
    availableAmount: 3500, pendingAmount: 0, reservedAmount: 0,
    currency: 'EUR', lastUpdatedDateTime: new Date('2026-07-01T00:00:00.000Z'),
  },
} as never;

const UNLINKED = {
  payoutAccountInstanceReference: 'pao00001-0000-4000-8000-000000000001',
  payoutAccountBalance: {
    availableAmount: 2847.5, pendingAmount: 0, reservedAmount: 0,
    currency: 'EUR', lastUpdatedDateTime: new Date('2026-07-01T00:00:00.000Z'),
  },
} as never;

// Berlin Group balances: decimal STRINGS, and `expected` includes what is booked but unsettled.
function bankAnswers(available: string, expected = available, blocked?: string) {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      balances: [
        { balanceType: 'interimAvailable', balanceAmount: { currency: 'EUR', amount: available }, lastChangeDateTime: '2026-08-18T10:00:00.000Z' },
        { balanceType: 'expected', balanceAmount: { currency: 'EUR', amount: expected } },
        ...(blocked ? [{ balanceType: 'blocked', balanceAmount: { currency: 'EUR', amount: blocked } }] : []),
      ],
    }),
  })) as unknown as typeof fetch;
}

// The TPP token is injected, so a unit test neither opens a database nor knows how the credential is
// obtained. That the bank refuses a token at all is asserted in the tpp authorisation suites.
const token = async () => ({ accessToken: 'bank-issued-token' });

async function load(enabled: boolean) {
  vi.resetModules();
  process.env.PSP_BANKCORE_ENABLED = String(enabled);
  process.env.PSP_BANKCORE_BASE_URL = 'http://bank:8083';
  return {
    projection: await import('../../../../backend/src/modules/gateway/services/payoutAccountBalanceProjection'),
    client: await import('../../../../backend/src/providers/account-information/services/bankcoreAis.client'),
  };
}

beforeEach(() => { process.env.PSP_JWT_SECRET = 'test-secret'; });
afterEach(() => {
  delete process.env.PSP_BANKCORE_ENABLED;
  delete process.env.PSP_BANKCORE_BASE_URL;
});

describe('v37 P2.4: the balance is projected from the bank', () => {
  it('is a no-op with the kill switch off, which is what makes the migration safe', async () => {
    const { projection } = await load(false);
    const [account] = await projection.projectBalances([LINKED]);
    expect(account.payoutAccountBalance.availableAmount).toBe(3500);
    expect(account.payoutAccountBalanceSource).toBeUndefined();
  });

  it('reads the bank figure at the identical field path every consumer parses', async () => {
    const { client } = await load(true);
    const result = await client.readAccountBalance(
      { bankAccountReference: 'acc-1', consentReference: 'c1' },
      bankAnswers('1234.56'),
      token,
    );
    expect(result.balance).toMatchObject({ availableAmount: 1234.56, currency: 'EUR' });
  });

  it('derives pending from the difference between expected and available', async () => {
    const { client } = await load(true);
    const result = await client.readAccountBalance(
      { bankAccountReference: 'acc-1', consentReference: 'c1' },
      bankAnswers('100.00', '175.50', '20.00'),
      token,
    );
    expect(result.balance).toMatchObject({ availableAmount: 100, pendingAmount: 75.5, reservedAmount: 20 });
  });

  it('parses the amount as a decimal string, never assuming a JSON number', async () => {
    const { client } = await load(true);
    // A value that a float would round: the standard sends strings for exactly this reason.
    const result = await client.readAccountBalance(
      { bankAccountReference: 'acc-1', consentReference: 'c1' },
      bankAnswers('12345678.91'),
      token,
    );
    expect(result.balance!.availableAmount).toBe(12345678.91);
  });

  it('keeps the stored figure and says why when the bank cannot be read', async () => {
    const { projection } = await load(true);
    // Injected reader, not a module mock: a leaked mock is how one test's stub answers another's call.
    const failing = async () => ({ error: 'AIS balance read unreachable: connect ECONNREFUSED' });
    const [account] = await projection.projectBalances([LINKED], undefined, failing);
    // The last known figure survives, flagged as stored rather than presented as the bank's.
    expect(account.payoutAccountBalance.availableAmount).toBe(3500);
    expect(account.payoutAccountBalanceSource).toBe('stored');
    expect(account.payoutAccountBalanceStaleReason).toContain('ECONNREFUSED');
  });

  it('leaves an account with no bank link alone: there is no bank to ask', async () => {
    const { projection } = await load(true);
    const [account] = await projection.projectBalances([UNLINKED]);
    expect(account.payoutAccountBalance.availableAmount).toBe(2847.5);
    expect(account.payoutAccountBalanceSource).toBeUndefined();
  });

  it('refuses a bank response that omits the spendable balance rather than defaulting to zero', async () => {
    const { client } = await load(true);
    const noAvailable = (async () => ({
      ok: true, status: 200,
      json: async () => ({ balances: [{ balanceType: 'expected', balanceAmount: { currency: 'EUR', amount: '10.00' } }] }),
    })) as unknown as typeof fetch;
    const result = await client.readAccountBalance({ bankAccountReference: 'a', consentReference: 'c' }, noAvailable, token);
    expect(result.balance).toBeUndefined();
    expect(result.error).toContain('interimAvailable');
  });
});

describe('v37 P2.5: the PSP asks the bank to credit, and never credits locally on failure', () => {
  it('sends the standard headers and the PSP payment id', async () => {
    const { client } = await load(true);
    let seen: { url?: string; headers?: Record<string, string>; body?: string } = {};
    const capturing = (async (url: string, init: Record<string, unknown>) => {
      seen = { url, headers: init.headers as Record<string, string>, body: init.body as string };
      return { ok: true, status: 200, json: async () => ({ applied: true, balanceAfter: 4000 }) };
    }) as unknown as typeof fetch;

    const result = await client.requestDemoCredit(
      { bankAccountReference: 'acc-1', amount: 500, currency: 'EUR', endToEndIdentification: 'CREDIT-42' },
      capturing,
      token,
    );
    expect(result).toMatchObject({ applied: true, balanceAfter: 4000 });
    expect(seen.url).toBe('http://bank:8083/v1/accounts/acc-1/credits');
    expect(seen.headers!['X-Request-ID']).toBe('CREDIT-42');
    expect(seen.headers!.Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(seen.body!)).toMatchObject({ endToEndIdentification: 'CREDIT-42', amount: 500 });
  });

  it('reports the bank\'s refusal instead of swallowing it', async () => {
    const { client } = await load(true);
    const refusing = (async () => ({
      ok: false, status: 400,
      json: async () => ({ tppMessages: [{ text: 'Account is held in USD' }] }),
    })) as unknown as typeof fetch;
    const result = await client.requestDemoCredit({ bankAccountReference: 'a', amount: 1, currency: 'EUR' }, refusing, token);
    expect(result).toMatchObject({ applied: false, error: 'Account is held in USD' });
  });
});
