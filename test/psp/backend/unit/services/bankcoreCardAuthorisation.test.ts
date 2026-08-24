// v37 P4.5: the card funds gate holds at the bank, and fails CLOSED when it cannot.
//
// The property that matters: a funds gate that fails open authorises a payment nobody checked. With the
// ledger at the bank, the thing we could not reach is precisely the authoritative balance, so an
// unreachable bank must decline. A local hold is no longer a fallback: it would mutate a projection.
import { describe, it, expect, vi } from 'vitest';

// The endpoint lookup and the token exchange read the provider arrangement record, which would open a QE
// client here. Stubbed, so this file stays a unit test of the request the client builds.
vi.mock('../../../../../psp/backend/src/modules/provider/services/providerAccessToken.service', async () => {
  const { stubProviderResolution } = await import('../support/providerResolution');
  return stubProviderResolution();
});

import {
  isBankLinked, holdFundsAtBank, disposeHoldAtBank,
} from '../../../../../psp/backend/src/providers/card-authorization/services/bankcoreCardAuthorisation.client';

const LINKED = {
  payoutAccountInstanceReference: 'pau-1',
  payoutAccountBankAccountReference: 'acc-1',
  payoutAccountAspspReference: 'bank-1',
  payoutAccountConsentReference: 'cns-1',
} as never;

describe('v37 P4.5: which accounts are the bank\'s to authorise', () => {
  it('treats an account with a bank reference, an ASPSP and a consent as linked', () => {
    expect(isBankLinked(LINKED)).toBe(true);
  });

  it('does not treat a half-linked account as linked', () => {
    // Any of the three missing means the bank cannot be asked, and guessing is what this prevents.
    expect(isBankLinked({ payoutAccountBankAccountReference: 'acc-1' } as never)).toBe(false);
    expect(isBankLinked({ payoutAccountBankAccountReference: 'acc-1', payoutAccountAspspReference: 'b' } as never)).toBe(false);
    expect(isBankLinked({} as never)).toBe(false);
  });
});

describe('v37 P4.5: the hold', () => {
  // The endpoint and the token come from the stubbed provider port, so the only fetch left is the
  // authorisation itself. Calls are matched by URL, never by position.
  function stubbedBank(authorisationResponse: unknown, status = 200) {
    const calls: Array<{ url: string; method?: string; headers: Record<string, string>; body?: string }> = [];
    const impl = (async (url: string, init: Record<string, unknown> = {}) => {
      calls.push({
        url,
        method: init.method as string | undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body as string | undefined,
      });
      if (url.includes('/v1/oauth/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'bank-token', expires_in: 300 }) };
      }
      return { ok: status === 200, status, json: async () => authorisationResponse };
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('declines when the bank cannot be reached, rather than falling back to a local hold', async () => {
    const unreachable = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const result = await holdFundsAtBank({
      account: LINKED, amount: 40, currency: 'EUR', clientReference: 'TXN-1',
    }, unreachable);
    expect(result.approved).toBe(false);
    // The error is reported so the caller can decline for the right reason, not silently approve.
    expect(result.error).toBeTruthy();
  });

  it('reports a refusal (no consent, wrong scope) as an error, not as a decline', async () => {
    const { impl } = stubbedBank({ tppMessages: [{ code: 'CONSENT_INVALID', text: 'not covered' }] }, 401);
    const result = await holdFundsAtBank({
      account: LINKED, amount: 40, currency: 'EUR', clientReference: 'TXN-2',
    }, impl);
    expect(result.approved).toBe(false);
    // A configuration problem and an insufficient balance are different facts; conflating them sends
    // whoever is debugging in the wrong direction.
    expect(result.error).toContain('CONSENT_INVALID');
  });

  it('carries the issuer response code through, rather than re-deriving one', async () => {
    const { impl } = stubbedBank({ responseCode: '51', approved: false });
    const result = await holdFundsAtBank({
      account: LINKED, amount: 999, currency: 'EUR', clientReference: 'TXN-3',
    }, impl);
    expect(result).toMatchObject({ approved: false, responseCode: '51' });
    expect(result.error).toBeUndefined();
  });

  it('sends the consent, the correlation id and a decimal amount string', async () => {
    const { impl, calls } = stubbedBank({ responseCode: '00', approved: true, authorisationReference: 'TXN-4' });
    const result = await holdFundsAtBank({
      account: LINKED, amount: 75.5, currency: 'EUR', cardToken: 'pm_x', clientReference: 'TXN-4',
    }, impl);
    expect(result).toMatchObject({ approved: true, responseCode: '00', authorisationReference: 'TXN-4' });

    const authorisation = calls.find((call) => call.url.includes('/v1/cards/authorisations'))!;
    expect(authorisation.headers['Consent-ID']).toBe('cns-1');
    expect(authorisation.headers['X-Request-ID']).toBe('TXN-4');
    const body = JSON.parse(authorisation.body!);
    // The bank's own account reference, not the PSP's: they are different identifiers on purpose.
    expect(body.fundingAccount.resourceId).toBe('acc-1');
    // A decimal STRING per ISO 20022, since a JSON number loses cents on a large value.
    expect(body.instructedAmount).toEqual({ currency: 'EUR', amount: '75.50' });
    expect(body.cardToken).toBe('pm_x');
  });

  it('releases and settles the same hold by its reference', async () => {
    for (const disposition of ['release', 'settle'] as const) {
      const { impl, calls } = stubbedBank({ applied: true });
      const result = await disposeHoldAtBank({
        account: LINKED, amount: 75.5, currency: 'EUR', authorisationReference: 'TXN-4', disposition,
      }, impl);
      expect(result.applied).toBe(true);
      const call = calls.find((entry) => entry.url.includes('/v1/cards/authorisations/TXN-4'))!;
      expect(call.method).toBe('DELETE');
      expect(JSON.parse(call.body!).disposition).toBe(disposition);
    }
  });

  it('reports a failed release, since a hold left behind strands the customer\'s money', async () => {
    const { impl } = stubbedBank({ applied: false, reason: 'insufficient_reserved' });
    const result = await disposeHoldAtBank({
      account: LINKED, amount: 10, currency: 'EUR', authorisationReference: 'TXN-5', disposition: 'release',
    }, impl);
    expect(result.applied).toBe(false);
    expect(result.error).toBe('insufficient_reserved');
  });
});
