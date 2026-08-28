/**
 * With more than one bank registered, each request reaches the bank that owns it and no other.
 *
 * This is the property the whole separation exists for, and it is the one that cannot be observed with a
 * single institution registered: whatever the routing does, there is only one place a request can land, so a
 * broken resolver and a working one look identical. Every test here therefore registers TWO banks and asserts
 * which one was chosen.
 *
 * What it is defending against is not an exception but a plausible-looking success. Asking Bank B about a card
 * Bank A issued does not throw: B answers that it knows nothing about it, which arrives as a decline
 * indistinguishable from a genuine one. The customer sees a refused card, the logs show a normal refusal, and
 * nothing anywhere says the question went to the wrong institution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ providers: [] as unknown[], findOne: vi.fn() }));

vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationRegistry.service', () => ({
  getActiveProvidersForType: vi.fn(async () => h.providers),
  getActiveProviderForType: vi.fn(async () => h.providers[0]),
  updateHealthStatus: vi.fn(),
  hashPayload: vi.fn(() => 'hash'),
}));

import {
  resolveByAccountAspsp, resolveByCardIssuer, resolverKindFor, isEntityBound,
} from '../../../../../psp/backend/src/modules/provider/services/resolverStrategy';
import { PAYMENT_CARD_COLLECTION } from '../../../../../psp/backend/src/modules/customer/models/paymentCard.model';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../../../../psp/backend/src/modules/gateway/models/payoutAccount.model';
import {
  CardIssuerGroup, AccountInformationGroup, PaymentInitiationGroup, CardAuthorizationGroup,
  institutionGroupFor, INSTITUTION_BOUND_GROUPS,
} from '../../../../../psp/backend/src/providers/groups/capabilityGroup';

const BANKCORE = 'bank0001-0000-4000-8000-000000000001';
const OTHER_BANK = 'bank0002-0000-4000-8000-000000000002';

/** Two registered institutions serving the same capability, which is the situation that exposes the bug. */
function twoBanks(capability: string) {
  return [
    {
      externalProviderArrangementInstanceReference: 'arr-bankcore',
      externalProviderArrangementName: 'BankCore',
      externalProviderArrangementType: capability,
      externalProviderAspspReference: BANKCORE,
      externalProviderIbanBankCodes: ['9820'],
      externalProviderBinRanges: [{ binRangeFrom: '453900', binRangeTo: '453999' }],
    },
    {
      externalProviderArrangementInstanceReference: 'arr-other',
      externalProviderArrangementName: 'Another Bank',
      externalProviderArrangementType: capability,
      externalProviderAspspReference: OTHER_BANK,
      externalProviderIbanBankCodes: ['1234'],
      externalProviderBinRanges: [{ binRangeFrom: '510000', binRangeTo: '519999' }],
    },
  ];
}

function dbWith(docs: Record<string, unknown>) {
  return {
    collection: (name: string) => ({
      findOne: async () => (docs as Record<string, unknown>)[name] ?? null,
    }),
  } as never;
}

beforeEach(() => {
  h.providers = [];
});

describe('an account is served by the institution that holds it', () => {
  it('routes to the bank named on the account, not the first registered one', async () => {
    h.providers = twoBanks('account_information');
    // The account is at the SECOND bank, so a resolver that picked the first would look like it worked.
    const db = dbWith({ [PAYOUT_ACCOUNT_COLLECTION]: { payoutAccountAspspReference: OTHER_BANK } });

    const resolution = await resolveByAccountAspsp(db, 'account_information', { accountReference: 'acc-1' });
    expect(resolution.ok).toBe(true);
    expect(resolution.ok && resolution.provider.externalProviderAspspReference).toBe(OTHER_BANK);
  });

  it('routes to BankCore when the account is BankCore\'s', async () => {
    h.providers = twoBanks('account_information');
    const db = dbWith({ [PAYOUT_ACCOUNT_COLLECTION]: { payoutAccountAspspReference: BANKCORE } });

    const resolution = await resolveByAccountAspsp(db, 'account_information', { accountReference: 'acc-2' });
    expect(resolution.ok && resolution.provider.externalProviderAspspReference).toBe(BANKCORE);
  });

  it('REFUSES when the account names an institution nobody registered', async () => {
    h.providers = twoBanks('account_information');
    const db = dbWith({ [PAYOUT_ACCOUNT_COLLECTION]: { payoutAccountAspspReference: 'bank-nobody-has' } });

    const resolution = await resolveByAccountAspsp(db, 'account_information', { accountReference: 'acc-3' });
    // A fallback here would operate a different institution's account.
    expect(resolution.ok).toBe(false);
    expect(!resolution.ok && resolution.reason).toContain('bank-nobody-has');
  });

  it('routes a freshly typed IBAN by the bank code inside it', async () => {
    h.providers = twoBanks('payment_initiation');
    const db = dbWith({});

    // ES + check digits + bank code 1234 belongs to the second bank.
    const resolution = await resolveByAccountAspsp(db, 'payment_initiation', { iban: 'ES7612341234561234567890' });
    expect(resolution.ok && resolution.provider.externalProviderAspspReference).toBe(OTHER_BANK);
  });

  it('refuses an IBAN whose bank code nobody claims, rather than guessing', async () => {
    h.providers = twoBanks('payment_initiation');
    const resolution = await resolveByAccountAspsp(dbWith({}), 'payment_initiation', {
      iban: 'ES7699999999991234567890',
    });
    expect(resolution.ok).toBe(false);
    expect(!resolution.ok && resolution.reason).toContain('9999');
  });
});

describe('a card is served by the institution that issued it', () => {
  it('routes by the issuer recorded on a registered card', async () => {
    h.providers = twoBanks('card_issuer');
    const db = dbWith({ [PAYMENT_CARD_COLLECTION]: { paymentCardIssuerReference: OTHER_BANK, paymentCardBin: '453995' } });

    // The BIN says BankCore and the RECORD says the other bank. The record wins, so a re-drawn BIN range
    // cannot silently move an existing card to a different issuer.
    const resolution = await resolveByCardIssuer(db, 'card_issuer', { cardToken: 'pm_x' });
    expect(resolution.ok && resolution.provider.externalProviderAspspReference).toBe(OTHER_BANK);
  });

  it("routes a card with no recorded issuer by its BIN, to the bank whose range covers it", async () => {
    h.providers = twoBanks('card_issuer');
    const db = dbWith({ [PAYMENT_CARD_COLLECTION]: { paymentCardBin: '453995' } });

    const resolution = await resolveByCardIssuer(db, 'card_issuer', { cardToken: 'pm_y' });
    expect(resolution.ok && resolution.provider.externalProviderAspspReference).toBe(BANKCORE);
  });

  it('routes a just-typed number by its leading digits', async () => {
    h.providers = twoBanks('card_issuer');
    const resolution = await resolveByCardIssuer(dbWith({}), 'card_issuer', { cardNumberBin: '515000' });
    expect(resolution.ok && resolution.provider.externalProviderAspspReference).toBe(OTHER_BANK);
  });

  it('REFUSES a BIN no registered issuer covers', async () => {
    h.providers = twoBanks('card_issuer');
    const resolution = await resolveByCardIssuer(dbWith({}), 'card_issuer', { cardNumberBin: '999999' });
    expect(resolution.ok).toBe(false);
    expect(!resolution.ok && resolution.reason).toContain('999999');
  });

  it('refuses an unknown card token instead of falling back to a BIN guess', async () => {
    h.providers = twoBanks('card_issuer');
    const resolution = await resolveByCardIssuer(dbWith({}), 'card_issuer', { cardToken: 'pm_unknown' });
    expect(resolution.ok).toBe(false);
  });
});

describe('each capability group states its own routing key', () => {
  // The reason this is a type hierarchy: a group that could not say how to find its institution used to
  // dispatch anyway, by strategy, to whichever provider happened to be active.
  it('every institution-bound capability has a group', () => {
    for (const capability of ['card_issuer', 'card_authorization', 'account_information', 'payment_initiation', 'aspsp'] as const) {
      expect(isEntityBound(capability), `${capability} must be institution bound`).toBe(true);
      expect(resolverKindFor(capability)).toBe('entity_bound');
      expect(INSTITUTION_BOUND_GROUPS[capability], `${capability} needs a group`).toBeDefined();
      expect(institutionGroupFor(dbWith({}), capability)).toBeInstanceOf(Object);
    }
  });

  it('a strategy-bound capability is not in the institution-bound set', () => {
    for (const capability of ['fraud_detection', 'aml_monitoring', 'kyc_identity', 'credit_bureau'] as const) {
      expect(isEntityBound(capability)).toBe(false);
      expect(resolverKindFor(capability)).toBe('strategy_bound');
    }
  });

  it.each([
    ['card issuer', () => new CardIssuerGroup(dbWith({})), 'identify the issuer'],
    ['card authorisation', () => new CardAuthorizationGroup(dbWith({})), 'identify the issuer'],
    ['account information', () => new AccountInformationGroup(dbWith({})), 'servicing institution'],
    ['payment initiation', () => new PaymentInitiationGroup(dbWith({})), 'executes the debit'],
  ])('%s refuses a request with no subject, and says what is missing', async (_name, make, expected) => {
    // No dispatch happens: there is no institution to send it to, and sending it anywhere would be a guess.
    const result = await make().ask({ event: 'probe', payload: {} });
    expect(result.status).toBe('error');
    expect(result.error).toContain('could not be routed');
    expect(result.error).toContain(expected);
  });

  it('the card groups will not accept an account as their subject, nor the reverse', async () => {
    // A subject of the wrong KIND is as unroutable as none at all, and quietly ignoring it would send the
    // request by strategy again.
    const byAccount = { accountReference: 'acc-1' };
    const byCard = { cardToken: 'pm_1' };

    expect((await new CardIssuerGroup(dbWith({})).ask({ event: 'e', payload: {}, subject: byAccount })).status)
      .toBe('error');
    expect((await new CardAuthorizationGroup(dbWith({})).ask({ event: 'e', payload: {}, subject: byAccount })).status)
      .toBe('error');
    expect((await new PaymentInitiationGroup(dbWith({})).ask({ event: 'e', payload: {}, subject: byCard })).status)
      .toBe('error');
  });
});
