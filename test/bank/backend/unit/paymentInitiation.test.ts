// v37 P3.3/P3.5: payment initiation, its validation, and the transaction status lifecycle.
//
// Two properties matter most. The bank RE-VALIDATES everything the TPP already checked, because an ASPSP
// does not trust a client: every refusal here is one a real bank would make. And initiation moves NO
// money, so the crossing from reversible to irreversible stays one identifiable step in the payment hub
// rather than being smeared across initiation.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import {
  initiatePayment, findPayment, cancelPayment, changeTransactionStatus, toBerlinGroupPayment,
} from '../../../../bank/backend/src/modules/pisp/services/paymentInitiation.service';
import type { PaymentInitiationControlRecord } from '../../../../bank/backend/src/modules/pisp/models/paymentInitiation.model';

const TPP = 'leafypay-psp';
const OTHER_TPP = 'someone-else';
// Real IBANs with valid mod-97 check digits: a fixture that failed the checksum would make every test
// pass for the wrong reason.
const DEBTOR = 'ES2098208323403025812509';
const DEBTOR_BLOCKED = 'ES5198204792106903981974';
const CREDITOR = 'DE89370400440532013000';

const ACCOUNTS = [
  {
    accountArrangementInstanceReference: 'acc-1',
    accountHolderInstanceReference: 'hld-1',
    accountIban: DEBTOR,
    accountStatus: 'active',
    accountCurrency: 'EUR',
    accountBalance: { availableAmount: 3500, pendingAmount: 0, reservedAmount: 0, currency: 'EUR', lastUpdatedDateTime: '2026-08-18T00:00:00.000Z' },
  },
  {
    accountArrangementInstanceReference: 'acc-2',
    accountHolderInstanceReference: 'hld-1',
    accountIban: DEBTOR_BLOCKED,
    accountStatus: 'blocked',
    accountCurrency: 'EUR',
    accountBalance: { availableAmount: 100, pendingAmount: 0, reservedAmount: 0, currency: 'EUR', lastUpdatedDateTime: '2026-08-18T00:00:00.000Z' },
  },
];

function fakeDb() {
  const payments: PaymentInitiationControlRecord[] = [];
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([key, expected]) => {
      const actual = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], doc);
      return actual === expected;
    });
  const store = (name: string) => (name === 'accountArrangement'
    ? ACCOUNTS as unknown as Array<Record<string, unknown>>
    : payments as unknown as Array<Record<string, unknown>>);

  const collection = (name: string) => ({
    async findOne(filter: Record<string, unknown>) {
      return store(name).find((doc) => matches(doc, filter)) ?? null;
    },
    async insertOne(doc: Record<string, unknown>) { store(name).push(doc); return { acknowledged: true }; },
    async updateOne(filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
      const doc = store(name).find((candidate) => matches(candidate, filter));
      if (doc) Object.assign(doc, update.$set ?? {});
      return { acknowledged: true };
    },
  });
  return { db: { collection } as unknown as Db, payments };
}

let bank: ReturnType<typeof fakeDb>;
beforeEach(() => { bank = fakeDb(); });

const VALID = {
  product: 'sepa-credit-transfers' as const,
  tppClientId: TPP,
  consentReference: 'cns-1',
  debtorIban: DEBTOR,
  creditorIban: CREDITOR,
  creditorName: 'Acme GmbH',
  amount: 125.5,
  currency: 'EUR',
  permittedAccountReferences: ['acc-1'],
};

describe('v37 P3.3: what the bank accepts', () => {
  it('accepts a valid payment as technically validated, not as executed', async () => {
    const result = await initiatePayment(bank.db, VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ACTC, not ACSC: nothing has been debited and nothing has been presented for settlement.
    expect(result.payment.transactionStatus).toBe('ACTC');
    expect(result.payment.paymentDebtor.accountReference).toBe('acc-1');
    expect(result.payment.bankConsentAgreementInstanceReference).toBe('cns-1');
  });

  it('leaves the debtor balance untouched, because initiation is not execution', async () => {
    await initiatePayment(bank.db, VALID);
    expect(ACCOUNTS[0].accountBalance.availableAmount).toBe(3500);
  });

  it("carries the caller's end to end id, and invents one only when it is absent", async () => {
    const withId = await initiatePayment(bank.db, { ...VALID, endToEndIdentification: 'PSP-PAY-1' });
    expect(withId.ok && withId.payment.paymentEndToEndIdentification).toBe('PSP-PAY-1');
    const withoutId = await initiatePayment(bank.db, VALID);
    expect(withoutId.ok && withoutId.payment.paymentEndToEndIdentification).toMatch(/^E2E-/);
  });
});

describe('v37 P3.3: what the bank refuses, having re-validated it itself', () => {
  const cases: Array<[string, Partial<typeof VALID>, string]> = [
    ['a zero amount', { amount: 0 }, 'FORMAT_ERROR'],
    ['a negative amount', { amount: -10 }, 'FORMAT_ERROR'],
    ['an amount with more precision than a currency has', { amount: 10.005 }, 'FORMAT_ERROR'],
    ['a missing creditor name', { creditorName: '  ' }, 'FORMAT_ERROR'],
    // A typo that keeps the length is the common case, which is why this is mod-97 and not a length check.
    ['a creditor IBAN failing its check digits', { creditorIban: 'DE89370400440532013001' }, 'FORMAT_ERROR'],
    ['the same account on both sides', { creditorIban: DEBTOR }, 'FORMAT_ERROR'],
    ['a debtor this bank does not hold', { debtorIban: 'GB33BUKB20201555555555' }, 'RESOURCE_UNKNOWN'],
    ['a debtor the consent does not cover', { debtorIban: DEBTOR_BLOCKED, permittedAccountReferences: ['acc-1'] }, 'CONSENT_INVALID'],
    ['a blocked debtor account', { debtorIban: DEBTOR_BLOCKED, permittedAccountReferences: ['acc-1', 'acc-2'] }, 'PAYMENT_FAILED'],
    ['a currency the debtor account is not held in', { currency: 'USD' }, 'PAYMENT_FAILED'],
    ['insufficient funds', { amount: 999999 }, 'PAYMENT_FAILED'],
  ];

  for (const [description, override, code] of cases) {
    it(`refuses ${description}`, async () => {
      const result = await initiatePayment(bank.db, { ...VALID, ...override });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    });
  }

  it('records nothing when it refuses, so a rejected attempt leaves no payment behind', async () => {
    await initiatePayment(bank.db, { ...VALID, amount: 999999 });
    expect(bank.payments.length).toBe(0);
  });

  it('checks the consent against the RESOLVED account, not the IBAN the caller sent', async () => {
    // The caller names an account it does have access to under a different reference: the check has to
    // survive that, or naming an account would be enough to be believed.
    const result = await initiatePayment(bank.db, { ...VALID, permittedAccountReferences: [DEBTOR] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONSENT_INVALID');
  });
});

describe('v37 P3.5: reading and cancelling', () => {
  it('scopes a read to the initiating TPP and to the product in the path', async () => {
    const created = await initiatePayment(bank.db, VALID);
    if (!created.ok) throw new Error('unexpected refusal');
    const id = created.payment.paymentInitiationInstanceReference;

    expect(await findPayment(bank.db, id, TPP, 'sepa-credit-transfers')).not.toBeNull();
    // Another client's payment, and the same payment under the wrong product, are both "not found":
    // answering either would make the scoping decorative.
    expect(await findPayment(bank.db, id, OTHER_TPP, 'sepa-credit-transfers')).toBeNull();
    expect(await findPayment(bank.db, id, TPP, 'instant-sepa-credit-transfers')).toBeNull();
  });

  it('cancels a payment that has not been presented for settlement', async () => {
    const created = await initiatePayment(bank.db, VALID);
    if (!created.ok) throw new Error('unexpected refusal');
    const result = await cancelPayment(bank.db, created.payment);
    expect(result.ok && result.payment.transactionStatus).toBe('CANC');
  });

  it('refuses to cancel once settlement is under way or done, and says why', async () => {
    for (const status of ['ACSP', 'ACSC', 'RJCT', 'CANC'] as const) {
      const created = await initiatePayment(bank.db, VALID);
      if (!created.ok) throw new Error('unexpected refusal');
      const id = created.payment.paymentInitiationInstanceReference;
      const moved = await changeTransactionStatus(bank.db, id, status, 'test');
      const result = await cancelPayment(bank.db, moved!);
      // Past the point of no return what exists is a recall or a return, which the creditor's bank may
      // refuse. Calling that a cancellation would promise something the rails do not keep.
      expect(result.ok, `${status} must not be cancellable`).toBe(false);
      if (!result.ok) expect(result.text).toContain(status);
    }
  });

  it('renders the standard resource, with the amount as a decimal string', async () => {
    const created = await initiatePayment(bank.db, VALID);
    if (!created.ok) throw new Error('unexpected refusal');
    const resource = toBerlinGroupPayment(created.payment);
    expect(resource.instructedAmount).toEqual({ currency: 'EUR', amount: '125.50' });
    expect(resource.debtorAccount.iban).toBe(DEBTOR);
    expect(resource.transactionStatus).toBe('ACTC');

    // A value large enough that a JSON number would lose cents, which is why ISO 20022 uses strings.
    // The mapper is pure, so it is exercised directly rather than by funding an account to test it.
    const large = toBerlinGroupPayment({ ...created.payment, paymentInstructedAmount: 12345678.91 });
    expect(large.instructedAmount.amount).toBe('12345678.91');
  });
});
