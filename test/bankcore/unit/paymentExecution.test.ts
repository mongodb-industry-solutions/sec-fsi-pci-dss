// v37 P5.A: the bank executes the payment, on-us or through the clearing scheme.
//
// Three properties matter more than the happy path.
//   · Internal or external is DERIVED from the creditor IBAN, never configured, so the PSP initiates the
//     same payment either way.
//   · The point of no return is ONE step (N3). Before it, a failure reverses the debit; after it, what
//     exists is a return, and calling that a compensation would promise something the rails do not keep.
//   · An unreachable beneficiary is refused BEFORE the debit, so a customer never loses money to a
//     destination nobody could reach.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import {
  executePayment, reconcileSubmission, applyInboundReturn, resolveReachability,
} from '../../../bankcore/src/modules/payment-hub/services/paymentExecution.service';
import { buildPacs008, buildPacs002, buildPacs004 } from '../../../bankcore/src/modules/payment-hub/services/iso20022.service';
import type { ClearingPort } from '../../../bankcore/src/modules/payment-hub/ports/clearing.port';
import type { PaymentInitiationControlRecord } from '../../../bankcore/src/modules/pisp/models/paymentInitiation.model';

// This bank owns ES bank code 9820; BBVA owns 0182 and is reachable; Meridian owns MERI and is not.
const OWN_IBAN_DEBTOR = 'ES2098208323403025812509';
const OWN_IBAN_CREDITOR = 'ES5198204792106903981974';
const BBVA_IBAN = 'ES9101828566110000000123';
const MERIDIAN_IBAN = 'GB29MERI60161331926819';
const UNKNOWN_BANK_IBAN = 'FR1420041010050500013M02606';

const PROFILE = {
  bankProfileInstanceReference: 'bank-1',
  bankProfileBic: 'VRDNESMMXXX',
  bankProfileIbanBankCodes: ['9820'],
  bankProfileNationalBankCodeByCountry: { ES: '9820' },
};

const COUNTERPARTIES = [
  {
    counterpartyBankInstanceReference: 'cpb-bbva',
    counterpartyBankName: 'BBVA',
    counterpartyBankBic: 'BBVAESMMXXX',
    counterpartyBankIbanBankCodes: ['0182'],
    counterpartyBankSchemes: ['sepa', 'sepa_instant'],
    counterpartyBankStatus: 'reachable',
  },
  {
    counterpartyBankInstanceReference: 'cpb-offline',
    counterpartyBankName: 'Meridian Trust',
    counterpartyBankBic: 'MERIGB2LXXX',
    counterpartyBankIbanBankCodes: ['MERI'],
    counterpartyBankSchemes: ['sepa'],
    counterpartyBankStatus: 'unreachable',
  },
];

function payment(overrides: Partial<PaymentInitiationControlRecord> = {}): PaymentInitiationControlRecord {
  return {
    paymentInitiationInstanceReference: 'pmt-1',
    paymentProduct: 'sepa-credit-transfers',
    paymentInitiatingTppClientId: 'leafypay-psp',
    bankConsentAgreementInstanceReference: 'cns-1',
    paymentDebtor: { accountReference: 'acc-debtor', iban: OWN_IBAN_DEBTOR },
    paymentCreditor: { iban: BBVA_IBAN },
    paymentCreditorName: 'Acme',
    paymentInstructedAmount: 100,
    paymentCurrency: 'EUR',
    paymentEndToEndIdentification: 'E2E-1',
    transactionStatus: 'ACTC',
    transactionStatusChangedDateTime: '2026-08-18T00:00:00.000Z',
    bianServiceDomain: 'Payment Execution',
    bianControlRecordType: 'PaymentInitiation',
    recordCreatedDateTime: '2026-08-18T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  } as PaymentInitiationControlRecord;
}

// The ledger, the payment, the registry and the logs. Balances are real numbers so a reversal is visible as
// a number rather than as an intention.
function fakeBank(options: { payments?: PaymentInitiationControlRecord[]; balances?: Record<string, number> } = {}) {
  const payments = options.payments ?? [payment()];
  const balances: Record<string, number> = { 'acc-debtor': 1000, 'acc-creditor': 500, ...(options.balances ?? {}) };
  const accounts = [
    { accountArrangementInstanceReference: 'acc-debtor', accountIban: OWN_IBAN_DEBTOR, accountStatus: 'active', accountCurrency: 'EUR' },
    { accountArrangementInstanceReference: 'acc-creditor', accountIban: OWN_IBAN_CREDITOR, accountStatus: 'active', accountCurrency: 'EUR' },
  ];
  const movements: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];

  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([key, expected]) => {
      const actual = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], doc);
      if (expected && typeof expected === 'object' && '$gte' in (expected as object)) {
        return typeof actual === 'number' && actual >= (expected as { $gte: number }).$gte;
      }
      return actual === expected;
    });

  const collection = (name: string) => ({
    async findOne(filter: Record<string, unknown> = {}) {
      if (name === 'bankProfile') return PROFILE;
      if (name === 'counterpartyBank') {
        const codes = filter.counterpartyBankIbanBankCodes;
        return COUNTERPARTIES.find((entry) => entry.counterpartyBankIbanBankCodes.includes(codes as string)) ?? null;
      }
      if (name === 'accountArrangement') {
        return accounts.find((account) => matches(account as never, filter)) ?? null;
      }
      if (name === 'paymentInitiationProcedure') {
        return payments.find((entry) => matches(entry as never, filter)) ?? null;
      }
      return null;
    },
    // Mirrors the driver under Queryable Encryption: `returnDocument: 'after'` is rejected, so this returns
    // the document from BEFORE the change. The ledger relies on that semantics.
    async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) {
      const account = accounts.find((entry) => {
        const balanceView = { ...entry, accountBalance: { availableAmount: balances[entry.accountArrangementInstanceReference], pendingAmount: 0, reservedAmount: 0, currency: 'EUR' } };
        return matches(balanceView as never, filter);
      });
      if (!account) return null;
      const before = { ...account, accountBalance: { availableAmount: balances[account.accountArrangementInstanceReference], pendingAmount: 0, reservedAmount: 0, currency: 'EUR', lastUpdatedDateTime: new Date() } };
      for (const [path, delta] of Object.entries(update.$inc ?? {})) {
        if (path.endsWith('availableAmount')) {
          balances[account.accountArrangementInstanceReference] += delta as number;
        }
      }
      return before;
    },
    async countDocuments(filter: Record<string, unknown>) {
      return accounts.filter((account) => matches(account as never, filter)).length;
    },
    async insertOne(doc: Record<string, unknown>) {
      (name === 'interbankMessageLog' ? messages : movements).push(doc);
      return { acknowledged: true };
    },
    async updateOne(filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
      const target = payments.find((entry) => matches(entry as never, filter));
      if (target) Object.assign(target, update.$set ?? {});
      return { acknowledged: true };
    },
    find() { return { async toArray() { return []; } }; },
  });

  return { db: { collection } as unknown as Db, balances, movements, messages, payments };
}

// A scheme that accepts and then settles, and one that refuses the message outright.
const acceptingPort = (status: 'ACSC' | 'RJCT' | 'ACSP' = 'ACSC', reasonCode?: string): ClearingPort => ({
  async submit() { return { accepted: true, clearingReference: 'SIM-ABC', expectedSettlementMs: 0 }; },
  async statusOf() { return { status, reasonCode, clearingReference: 'SIM-ABC' }; },
});
const refusingPort: ClearingPort = {
  async submit() { return { accepted: false, reasonCode: 'AC01' }; },
  async statusOf() { return { status: 'RJCT', reasonCode: 'AC01' }; },
};

let bank: ReturnType<typeof fakeBank>;
beforeEach(() => { bank = fakeBank(); });

describe('v37 P5.A1: an on-us payment is a book transfer, derived not configured', () => {
  it('settles immediately with no scheme and no message', async () => {
    bank = fakeBank({ payments: [payment({ paymentCreditor: { iban: OWN_IBAN_CREDITOR } })] });
    const outcome = await executePayment(bank.db, 'pmt-1', { port: refusingPort });
    // The port would have refused: proof that no scheme was involved at all.
    expect(outcome).toEqual({ state: 'settled', scheme: 'book_transfer' });
    expect(bank.balances['acc-debtor']).toBe(900);
    expect(bank.balances['acc-creditor']).toBe(600);
    expect(bank.messages).toEqual([]);
    expect(bank.payments[0].transactionStatus).toBe('ACSC');
  });

  it('rejects when the creditor account is unknown here, before moving anything', async () => {
    bank = fakeBank({ payments: [payment({ paymentCreditor: { iban: 'ES8098201234567890123456' } })] });
    const outcome = await executePayment(bank.db, 'pmt-1');
    expect(outcome).toMatchObject({ state: 'rejected' });
    expect(bank.balances['acc-debtor']).toBe(1000);
  });

  it('rejects on insufficient funds without a partial movement', async () => {
    bank = fakeBank({
      payments: [payment({ paymentCreditor: { iban: OWN_IBAN_CREDITOR }, paymentInstructedAmount: 5000 })],
    });
    const outcome = await executePayment(bank.db, 'pmt-1');
    expect(outcome).toMatchObject({ state: 'rejected', reasonCode: 'AM04' });
    expect(bank.balances['acc-debtor']).toBe(1000);
    expect(bank.balances['acc-creditor']).toBe(500);
  });
});

describe('v37 P5.A2/P5.A3: an external payment goes through the scheme', () => {
  it('debits, presents pacs.008 and reports in flight', async () => {
    const outcome = await executePayment(bank.db, 'pmt-1', { port: acceptingPort('ACSP') });
    expect(outcome).toMatchObject({ state: 'in_flight', scheme: 'sepa' });
    expect(bank.balances['acc-debtor']).toBe(900);
    // ACSP, not ACSC: the money is with the scheme and has not settled.
    expect(bank.payments[0].transactionStatus).toBe('ACSP');
    const sent = bank.messages.find((message) => message.interbankMessageType === 'pacs.008');
    expect(sent).toBeDefined();
    expect(sent!.interbankMessageDirection).toBe('sent');
  });

  it('REFUSES an unreachable institution before the debit', async () => {
    bank = fakeBank({ payments: [payment({ paymentCreditor: { iban: MERIDIAN_IBAN } })] });
    const outcome = await executePayment(bank.db, 'pmt-1');
    expect(outcome).toMatchObject({ state: 'rejected' });
    // The whole purpose of the registry: the customer does not lose the money to a destination nobody
    // could reach, and no message was presented.
    expect(bank.balances['acc-debtor']).toBe(1000);
    expect(bank.messages).toEqual([]);
  });

  it('refuses an institution nobody has registered', async () => {
    bank = fakeBank({ payments: [payment({ paymentCreditor: { iban: UNKNOWN_BANK_IBAN } })] });
    const outcome = await executePayment(bank.db, 'pmt-1');
    expect(outcome).toMatchObject({ state: 'rejected' });
    expect(bank.balances['acc-debtor']).toBe(1000);
  });

  it('reverses the debit when the scheme will not take the message', async () => {
    const outcome = await executePayment(bank.db, 'pmt-1', { port: refusingPort });
    expect(outcome).toMatchObject({ state: 'rejected', reasonCode: 'AC01' });
    // Legitimate compensation, BECAUSE nothing was presented: still on the reversible side of the line.
    expect(bank.balances['acc-debtor']).toBe(1000);
    // And the refused submission is still logged: evidence of what was attempted.
    expect(bank.messages.length).toBe(1);
  });

  it('refuses to execute a payment that is not technically accepted', async () => {
    bank = fakeBank({ payments: [payment({ transactionStatus: 'ACSP' })] });
    const outcome = await executePayment(bank.db, 'pmt-1', { port: acceptingPort() });
    // Re-executing an in-flight payment would double the debit, which is the cheapest thing to refuse.
    expect(outcome.state).toBe('error');
    expect(bank.balances['acc-debtor']).toBe(1000);
  });

  it('picks the scheme from the product, falling back to one the counterparty has', async () => {
    const instant = await resolveReachability(bank.db, BBVA_IBAN, 'instant-sepa-credit-transfers');
    expect('scheme' in instant && instant.scheme).toBe('sepa_instant');
    // BBVA is not in SWIFT here, so a cross-border request falls back rather than failing: the customer
    // asked to pay, not to use a particular rail.
    const crossBorder = await resolveReachability(bank.db, BBVA_IBAN, 'cross-border-credit-transfers');
    expect('scheme' in crossBorder && crossBorder.scheme).toBe('sepa');
  });
});

describe('v37 P5.A6: the status report and the return', () => {
  it('settles on ACSC and records the pacs.002', async () => {
    await executePayment(bank.db, 'pmt-1', { port: acceptingPort('ACSC') });
    const outcome = await reconcileSubmission(bank.db, 'pmt-1', 'SIM-ABC', { port: acceptingPort('ACSC') });
    expect(outcome).toMatchObject({ state: 'settled' });
    expect(bank.payments[0].transactionStatus).toBe('ACSC');
    expect(bank.messages.some((message) => message.interbankMessageType === 'pacs.002')).toBe(true);
  });

  it('reverses the debit on RJCT and carries the scheme reason code', async () => {
    await executePayment(bank.db, 'pmt-1', { port: acceptingPort('RJCT', 'AC06') });
    expect(bank.balances['acc-debtor']).toBe(900);
    const outcome = await reconcileSubmission(bank.db, 'pmt-1', 'SIM-ABC', { port: acceptingPort('RJCT', 'AC06') });
    expect(outcome).toMatchObject({ state: 'rejected', reasonCode: 'AC06' });
    expect(bank.balances['acc-debtor']).toBe(1000);
  });

  it('leaves an in-process payment alone', async () => {
    await executePayment(bank.db, 'pmt-1', { port: acceptingPort('ACSP') });
    const outcome = await reconcileSubmission(bank.db, 'pmt-1', 'SIM-ABC', { port: acceptingPort('ACSP') });
    expect(outcome.state).toBe('in_flight');
    expect(bank.payments[0].transactionStatus).toBe('ACSP');
  });

  it('credits a RETURN after settlement and keeps the payment settled', async () => {
    bank = fakeBank({ payments: [payment({ transactionStatus: 'ACSC' })] });
    const outcome = await applyInboundReturn(bank.db, 'pmt-1', 'AC04');
    expect(outcome.state).toBe('settled');
    // The customer gets the money back...
    expect(bank.balances['acc-debtor']).toBe(1100);
    // ...and the payment stays ACSC: it DID settle, and rewriting it as rejected would leave the two
    // movements on the statement unexplainable.
    expect(bank.payments[0].transactionStatus).toBe('ACSC');
    expect(String(bank.payments[0].transactionStatusReason)).toContain('AC04');
    expect(bank.messages.some((message) => message.interbankMessageType === 'pacs.004')).toBe(true);
  });

  it('refuses to return a payment that never settled', async () => {
    bank = fakeBank({ payments: [payment({ transactionStatus: 'ACSP' })] });
    const outcome = await applyInboundReturn(bank.db, 'pmt-1', 'AC04');
    expect(outcome.state).toBe('error');
    expect(bank.balances['acc-debtor']).toBe(1000);
  });
});

describe('v37 P5.A5: the ISO 20022 messages', () => {
  it('builds a pacs.008 with the standard element names and the end to end id', () => {
    const { message, messageIdentification } = buildPacs008(payment(), {
      debtorBic: 'VRDNESMMXXX', creditorBic: 'BBVAESMMXXX', scheme: 'sepa',
    });
    expect(messageIdentification).toMatch(/^MSG-/);
    const transaction = message.FIToFICstmrCdtTrf.CdtTrfTxInf[0] as Record<string, never>;
    // The standard's own nesting, not a flattened convenience shape.
    expect((transaction.PmtId as unknown as { EndToEndId: string }).EndToEndId).toBe('E2E-1');
    expect((transaction.CdtrAcct as unknown as { Id: { IBAN: string } }).Id.IBAN).toBe(BBVA_IBAN);
    expect((transaction.IntrBkSttlmAmt as unknown as { amount: string }).amount).toBe('100.00');
  });

  it('puts a reason code on a rejection and NOT on an acceptance', () => {
    const rejected = buildPacs002({
      originalMessageIdentification: 'MSG-1', originalEndToEndIdentification: 'E2E-1',
      status: 'RJCT', reasonCode: 'AC06',
    });
    const accepted = buildPacs002({
      originalMessageIdentification: 'MSG-1', originalEndToEndIdentification: 'E2E-1', status: 'ACSC',
    });
    const rejectedTx = rejected.message.FIToFIPmtStsRpt.TxInfAndSts[0] as Record<string, never>;
    const acceptedTx = accepted.message.FIToFIPmtStsRpt.TxInfAndSts[0] as Record<string, never>;
    expect(rejectedTx.StsRsnInf).toBeDefined();
    // A reason code on an acceptance would be meaningless and misread.
    expect(acceptedTx.StsRsnInf).toBeUndefined();
  });

  it('builds a pacs.004 carrying the returned amount and its reason', () => {
    const { message } = buildPacs004({
      originalEndToEndIdentification: 'E2E-1', amount: 100, currency: 'EUR', reasonCode: 'AC04',
    });
    const returned = message.PmtRtr.TxInf[0] as Record<string, never>;
    expect((returned.RtrdIntrBkSttlmAmt as unknown as { amount: string }).amount).toBe('100.00');
    expect(returned.OrgnlEndToEndId).toBe('E2E-1');
  });
});
