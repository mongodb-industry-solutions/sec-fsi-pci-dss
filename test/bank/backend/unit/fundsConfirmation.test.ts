// v37 P3.4: confirmation of funds.
//
// The property that matters is what is NOT disclosed. Under PSD2 this is a yes/no gate: a party asking
// "are there 40 euros" learns whether there are 40 euros and nothing else. A result that leaked the
// balance, or a reason that implied it, would turn a funds gate into an account information disclosure
// the caller may have no basis for.
import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import { confirmFunds } from '../../../../bank/backend/src/modules/payment-hub/services/fundsConfirmation.service';

const IBAN = 'ES2098208323403025812509';
const BLOCKED_IBAN = 'ES5198204792106903981974';
const USD_IBAN = 'GB92VRDN95504424063597';

const ACCOUNTS = [
  {
    accountArrangementInstanceReference: 'acc-1', accountIban: IBAN, accountStatus: 'active',
    accountCurrency: 'EUR', accountBalance: { availableAmount: 100, pendingAmount: 0, reservedAmount: 0, currency: 'EUR' },
  },
  {
    accountArrangementInstanceReference: 'acc-2', accountIban: BLOCKED_IBAN, accountStatus: 'blocked',
    accountCurrency: 'EUR', accountBalance: { availableAmount: 5000, pendingAmount: 0, reservedAmount: 0, currency: 'EUR' },
  },
  {
    accountArrangementInstanceReference: 'acc-3', accountIban: USD_IBAN, accountStatus: 'active',
    accountCurrency: 'USD', accountBalance: { availableAmount: 5000, pendingAmount: 0, reservedAmount: 0, currency: 'USD' },
  },
];

const db = {
  collection: () => ({
    async findOne(filter: { accountIban?: string }) {
      return ACCOUNTS.find((account) => account.accountIban === filter.accountIban) ?? null;
    },
  }),
} as unknown as Db;

const PERMITTED = ['acc-1', 'acc-2', 'acc-3'];

describe('v37 P3.4: the funds gate answers yes or no, and nothing more', () => {
  it('confirms funds that are there', async () => {
    const result = await confirmFunds(db, { accountIban: IBAN, amount: 40, currency: 'EUR', permittedAccountReferences: PERMITTED });
    expect(result).toMatchObject({ ok: true, fundsAvailable: true });
  });

  it('declines funds that are not, without revealing the balance', async () => {
    const result = await confirmFunds(db, { accountIban: IBAN, amount: 40000, currency: 'EUR', permittedAccountReferences: PERMITTED });
    expect(result).toMatchObject({ ok: true, fundsAvailable: false });
    // The whole result must not carry the figure, in any field: 100 is what an account has here.
    expect(JSON.stringify(result)).not.toContain('100');
  });

  it('confirms exactly the amount available, since the standard is "at least this much"', async () => {
    const result = await confirmFunds(db, { accountIban: IBAN, amount: 100, currency: 'EUR', permittedAccountReferences: PERMITTED });
    expect(result).toMatchObject({ ok: true, fundsAvailable: true });
  });

  it('answers a blocked account as NO rather than as an error', async () => {
    const result = await confirmFunds(db, { accountIban: BLOCKED_IBAN, amount: 40, currency: 'EUR', permittedAccountReferences: PERMITTED });
    // The funds are there but not usable, and "no" is the honest answer. An error would say more.
    expect(result).toMatchObject({ ok: true, fundsAvailable: false });
  });

  it('answers a currency mismatch as NO, rather than naming the currency it is held in', async () => {
    const result = await confirmFunds(db, { accountIban: USD_IBAN, amount: 40, currency: 'EUR', permittedAccountReferences: PERMITTED });
    expect(result).toMatchObject({ ok: true, fundsAvailable: false });
    expect(JSON.stringify(result)).not.toContain('USD');
  });

  it('refuses an account outside the consent, which is different from answering no', async () => {
    const result = await confirmFunds(db, { accountIban: IBAN, amount: 40, currency: 'EUR', permittedAccountReferences: ['acc-9'] });
    expect(result.ok).toBe(false);
    // A refusal and a "no" must not be conflated: one is the request being wrong, the other is the answer.
    if (!result.ok) expect(result.code).toBe('CONSENT_INVALID');
  });

  it('refuses an account this bank does not hold', async () => {
    const result = await confirmFunds(db, { accountIban: 'DE89370400440532013000', amount: 40, currency: 'EUR', permittedAccountReferences: PERMITTED });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RESOURCE_UNKNOWN');
  });

  it('refuses a non positive or unparseable amount', async () => {
    for (const amount of [0, -5, Number.NaN]) {
      const result = await confirmFunds(db, { accountIban: IBAN, amount, currency: 'EUR', permittedAccountReferences: PERMITTED });
      expect(result.ok, `${amount} must be refused`).toBe(false);
    }
  });

  it('refuses a missing currency instead of guessing the account currency', async () => {
    const result = await confirmFunds(db, { accountIban: IBAN, amount: 40, currency: '', permittedAccountReferences: PERMITTED });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORMAT_ERROR');
  });
});
