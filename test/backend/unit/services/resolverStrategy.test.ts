// v37 P6.1/P6.3/P6.4: how a provider is chosen, per capability.
//
// The mistake this exists to prevent is specific and expensive: dispatching a payment to the bank that owns
// the CREDITOR's IBAN. That bank is a beneficiary reached through a scheme, not a party Leafy Pay can
// instruct, and with a second ASPSP registered a strategy resolver would pick it happily. The routing key for
// a payment is the DEBTOR, always.
import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import {
  resolveProvider, resolveByAccountAspsp, resolveByCardIssuer, resolveByStrategy,
  resolverKindFor, ibanBankCodeOf, withinBinRange,
} from '../../../../backend/src/modules/provider/services/resolverStrategy';

// Two registered banks, which is the whole point: with one, every resolver looks correct.
const VERDANT = {
  externalProviderArrangementInstanceReference: 'int-verdant-pis',
  externalProviderArrangementType: 'payment_initiation',
  externalProviderArrangementStatus: 'active',
  externalProviderAspspReference: 'bank-verdant',
  externalProviderIbanBankCodes: ['9820'],
  externalProviderBinRanges: [{ binRangeFrom: '453900', binRangeTo: '453999' }],
};
const BBVA = {
  externalProviderArrangementInstanceReference: 'int-bbva-pis',
  externalProviderArrangementType: 'payment_initiation',
  externalProviderArrangementStatus: 'active',
  externalProviderAspspReference: 'bank-bbva',
  externalProviderIbanBankCodes: ['0182'],
  externalProviderBinRanges: [],
};

const ACCOUNTS = [
  // A linked account at Verdant.
  { payoutAccountInstanceReference: 'pau-verdant', payoutAccountAspspReference: 'bank-verdant' },
  // A linked account at BBVA: the customer holds accounts at two banks, which is the case that breaks a
  // strategy resolver.
  { payoutAccountInstanceReference: 'pau-bbva', payoutAccountAspspReference: 'bank-bbva' },
  // Linked to nothing: not routable, and a default would be the wrong bank.
  { payoutAccountInstanceReference: 'pau-orphan' },
];

const CARDS = [
  { paymentCardReference: 'pm_registered', paymentCardIssuerReference: 'bank-verdant', paymentCardBin: '453901' },
  { paymentCardReference: 'pm_bin_only', paymentCardBin: '453950' },
  { paymentCardReference: 'pm_unknown_bin', paymentCardBin: '999999' },
];

function fakeDb(providers: unknown[] = [VERDANT, BBVA]) {
  const collection = (name: string) => ({
    find(filter: Record<string, unknown> = {}) {
      if (name !== 'externalProviderArrangement') return { async toArray() { return []; } };
      const matching = (providers as Array<Record<string, unknown>>).filter((p) => (
        (!filter.externalProviderArrangementType || p.externalProviderArrangementType === filter.externalProviderArrangementType)
        && (!filter.externalProviderArrangementStatus || p.externalProviderArrangementStatus === filter.externalProviderArrangementStatus)
      ));
      return { async toArray() { return matching; } };
    },
    async findOne(filter: Record<string, unknown>) {
      if (name === 'payoutAccountArrangement') {
        return ACCOUNTS.find((a) => a.payoutAccountInstanceReference === filter.payoutAccountInstanceReference) ?? null;
      }
      if (name === 'paymentCardManagement') {
        return CARDS.find((c) => c.paymentCardReference === filter.paymentCardReference) ?? null;
      }
      return null;
    },
  });
  return { collection } as unknown as Db;
}

describe('v37 P6.1: which resolver a capability gets', () => {
  it('binds the banking capabilities to an entity', () => {
    for (const type of ['aspsp', 'account_information', 'payment_initiation', 'card_issuer', 'card_authorization'] as const) {
      expect(resolverKindFor(type), type).toBe('entity_bound');
    }
  });

  it('leaves the assessment capabilities on strategy', () => {
    // Any active provider can score a transaction or screen a name; which one is a matter of priority.
    for (const type of ['fraud_detection', 'aml_monitoring', 'hrp_sanctions', 'vop_verification', 'kyc_identity', 'credit_bureau'] as const) {
      expect(resolverKindFor(type), type).toBe('strategy_bound');
    }
  });
});

describe('v37 P6.3: the routing key is the DEBTOR, never the creditor', () => {
  it('routes a payment to the bank holding the payer account', async () => {
    const resolution = await resolveProvider(fakeDb(), 'payment_initiation', { accountReference: 'pau-verdant' });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.provider.externalProviderAspspReference).toBe('bank-verdant');
  });

  it('NEVER selects a bank because it owns the creditor IBAN', async () => {
    // The debtor banks with Verdant and the money is going to a BBVA IBAN. BBVA is registered as an ASPSP,
    // which is exactly the trap: being registered means the user can hold accounts there, not that it can be
    // instructed to move someone else's money.
    const resolution = await resolveProvider(fakeDb(), 'payment_initiation', {
      accountReference: 'pau-verdant',
      // Present in the context and deliberately ignored by this resolver: the creditor IBAN drives the
      // payment PRODUCT, a separate derivation.
      iban: 'ES9101825566110000000123',
    });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.provider.externalProviderAspspReference).toBe('bank-verdant');
      expect(resolution.provider.externalProviderAspspReference).not.toBe('bank-bbva');
    }
  });

  it('routes each account to ITS bank, which is what a second registered bank tests', async () => {
    const first = await resolveProvider(fakeDb(), 'payment_initiation', { accountReference: 'pau-verdant' });
    const second = await resolveProvider(fakeDb(), 'payment_initiation', { accountReference: 'pau-bbva' });
    expect(first.ok && first.provider.externalProviderAspspReference).toBe('bank-verdant');
    // No code change was needed for the second bank: it is a seeded record. That is the property.
    expect(second.ok && second.provider.externalProviderAspspReference).toBe('bank-bbva');
  });

  it('reads a LINKED account from the record rather than deriving it', async () => {
    const resolution = await resolveByAccountAspsp(fakeDb(), 'payment_initiation', { accountReference: 'pau-bbva' });
    expect(resolution.ok && resolution.reason).toContain('linked account');
  });

  it('derives a NEWLY ENTERED account from its IBAN bank code', async () => {
    const resolution = await resolveByAccountAspsp(fakeDb(), 'payment_initiation', { iban: 'ES9101825566110000000123' });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.provider.externalProviderAspspReference).toBe('bank-bbva');
      expect(resolution.reason).toContain('0182');
    }
  });

  it('REFUSES an identifier no registered bank claims, with no default', async () => {
    const resolution = await resolveByAccountAspsp(fakeDb(), 'payment_initiation', { iban: 'FR7630006000011234567890189' });
    expect(resolution.ok).toBe(false);
    // A default bank here would operate an institution that never agreed to serve this account.
    if (!resolution.ok) expect(resolution.reason).toContain('no registered institution');
  });

  it('refuses an account linked to nothing, rather than picking the only bank there is', async () => {
    const resolution = await resolveByAccountAspsp(fakeDb(), 'payment_initiation', { accountReference: 'pau-orphan' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toContain('names no ASPSP');
  });

  it('refuses when there is nothing to resolve from at all', async () => {
    const resolution = await resolveByAccountAspsp(fakeDb(), 'payment_initiation', {});
    expect(resolution.ok).toBe(false);
  });
});

describe('v37 P6.3: a card routes to its issuer', () => {
  const cardProviders = [
    { ...VERDANT, externalProviderArrangementType: 'card_issuer', externalProviderArrangementInstanceReference: 'int-verdant-cards' },
    { ...BBVA, externalProviderArrangementType: 'card_issuer', externalProviderArrangementInstanceReference: 'int-bbva-cards' },
  ];

  it('prefers the issuer on a registered card over re-deriving from the BIN', async () => {
    const resolution = await resolveByCardIssuer(fakeDb(cardProviders), 'card_issuer', { cardToken: 'pm_registered' });
    expect(resolution.ok).toBe(true);
    // Re-deriving would let a BIN range change silently move an existing card to another issuer.
    if (resolution.ok) expect(resolution.reason).toContain('registered card issuer');
  });

  it('falls back to the BIN for a card with no issuer recorded', async () => {
    const resolution = await resolveByCardIssuer(fakeDb(cardProviders), 'card_issuer', { cardToken: 'pm_bin_only' });
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.reason).toContain('BIN');
  });

  it('refuses a BIN no registered issuer covers', async () => {
    const resolution = await resolveByCardIssuer(fakeDb(cardProviders), 'card_issuer', { cardToken: 'pm_unknown_bin' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toContain('no registered issuer');
  });
});

describe('v37 P6.4: a capability nobody offers fails with a reason', () => {
  it('refuses rather than falling back when no provider serves the institution', async () => {
    // Verdant serves payments, but nothing here serves BBVA's.
    const resolution = await resolveByAccountAspsp(fakeDb([VERDANT]), 'payment_initiation', { accountReference: 'pau-bbva' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toContain('bank-bbva');
  });

  it('says so plainly when a strategy capability has no provider at all', async () => {
    const resolution = await resolveByStrategy(fakeDb([]), 'fraud_detection');
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.reason).toContain('no active fraud_detection provider');
  });
});

describe('v37: the identifier derivations both sides have to agree on', () => {
  it('reads the national bank code at the right offset per country', () => {
    expect(ibanBankCodeOf('ES2098208323403025812509')).toBe('9820');
    expect(ibanBankCodeOf('DE89370400440532013000')).toBe('37040044');
    expect(ibanBankCodeOf('GB29MERI60161331926819')).toBe('MERI');
    expect(ibanBankCodeOf('es20 9820 8323 4030 2581 2509')).toBe('9820');
  });

  it('returns nothing for a country it has no rule for, rather than a wrong slice', () => {
    // A guessed offset would produce a plausible code belonging to the wrong institution.
    expect(ibanBankCodeOf('XX0012345678')).toBeNull();
    expect(ibanBankCodeOf('ES')).toBeNull();
  });

  it('compares BIN ranges inclusively and across differing lengths', () => {
    expect(withinBinRange('453901', '453900', '453999')).toBe(true);
    expect(withinBinRange('453900', '453900', '453999')).toBe(true);
    expect(withinBinRange('453999', '453900', '453999')).toBe(true);
    expect(withinBinRange('454000', '453900', '453999')).toBe(false);
    // A short range must not accidentally claim every card beginning with the same digit.
    expect(withinBinRange('4539123456', '4539', '4539')).toBe(true);
    expect(withinBinRange('4600000000', '4539', '4539')).toBe(false);
  });
});
