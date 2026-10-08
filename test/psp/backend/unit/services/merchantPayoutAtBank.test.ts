/**
 * A card payment funded from a bank account is paid to the merchant AT THE BANK:
 *  - the authorisation hold is released first, then the bank pays the merchant's IBAN from the cardholder account;
 *  - the PSP takes no local reservation and credits nobody;
 *  - the transaction becomes settled only when the bank reports the payment settled;
 *  - a refusal puts the hold back, so the authorized payment stays covered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  order: [] as string[],
  debitPending: vi.fn(async () => true),
  creditAvailable: vi.fn(async () => true),
  creditDirect: vi.fn(async () => true),
  createExecution: vi.fn(async () => ({ paymentExecutionInstanceReference: 'exec-1' })),
  transitionExecution: vi.fn(async () => true),
  appendResolutionStep: vi.fn(async () => ({})),
  getExecution: vi.fn(async () => null as unknown),
  resolveMerchantFee: vi.fn(async () => ({ feeAmount: 1, netAmount: 99, fee: undefined })),
  ask: vi.fn(async () => ({ provider: 'external', status: 'sent', responseBody: { accountStatus: 'enabled' } })),
  disposeHoldAtBank: vi.fn(async () => ({ applied: true })),
  holdFundsAtBank: vi.fn(async () => ({ approved: true })),
  initiatePaymentAtBank: vi.fn(async () => ({ bankPaymentReference: 'bank-pay-1', transactionStatus: 'ACTC' }) as { bankPaymentReference?: string; transactionStatus?: string; error?: string }),
  emitProcessEvent: vi.fn(),
  updates: [] as Array<{ filter: unknown; update: unknown }>,
}));

vi.mock('../../../../../psp/backend/src/modules/gateway/services/payoutAccountBalance.service', () => ({
  debitPending: h.debitPending, releaseReservation: vi.fn(), settleReservedDebit: vi.fn(),
  creditAvailable: h.creditAvailable, creditDirect: h.creditDirect, releasePendingCredit: vi.fn(),
}));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/paymentExecution.service', () => ({
  createExecution: h.createExecution, transitionExecution: h.transitionExecution,
  appendResolutionStep: h.appendResolutionStep, getExecution: h.getExecution, resolveMerchantFee: h.resolveMerchantFee,
}));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/payoutAccount.service', () => ({ getDefaultPayoutAccount: vi.fn(async () => null) }));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/commissionSettlement.service', () => ({
  postCommission: vi.fn(async () => ({ outcome: 'posted' })), requiresFeeRelease: () => false,
}));
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationDispatch.service', () => ({
  dispatchProvider: vi.fn(async () => ({ provider: 'internal', status: 'error' })),
  dispatchToInstitution: vi.fn(),
}));
vi.mock('../../../../../psp/backend/src/providers/groups/capabilityGroup', () => ({
  institutionGroupFor: () => ({ ask: h.ask }),
}));
vi.mock('../../../../../psp/backend/src/providers/card-authorization/services/bankcoreCardAuthorisation.client', () => ({
  disposeHoldAtBank: async (...a: unknown[]) => { h.order.push('release'); return (h.disposeHoldAtBank as (...x: unknown[]) => unknown)(...a); },
  holdFundsAtBank: async (...a: unknown[]) => { h.order.push('rehold'); return (h.holdFundsAtBank as (...x: unknown[]) => unknown)(...a); },
  isBankLinked: (a: { payoutAccountBankAccountReference?: string; payoutAccountAspspReference?: string; payoutAccountConsentReference?: string }) =>
    Boolean(a.payoutAccountBankAccountReference && a.payoutAccountAspspReference && a.payoutAccountConsentReference),
}));
vi.mock('../../../../../psp/backend/src/providers/payment-initiation/services/bankcorePis.client', () => ({
  initiatePaymentAtBank: async (...a: unknown[]) => { h.order.push('pay'); return (h.initiatePaymentAtBank as (...x: unknown[]) => unknown)(...a); },
  selectPaymentProduct: () => 'sepa-credit-transfers',
}));
vi.mock('../../../../../psp/backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: h.emitProcessEvent, emitComplianceEvent: vi.fn(),
}));
vi.mock('../../../../../psp/backend/src/modules/transaction/services/cardTransaction.service', () => ({ declineTransaction: vi.fn() }));

import type { Db } from 'mongodb';
import { EventBusInProcess } from '@ist-sec/eventbus';
import { makeEvent } from '../../../../../psp/backend/src/vendors/eventbus';
import { PayoutOrchestrationProcess } from '../../../../../psp/backend/src/modules/gateway/services/payoutOrchestration.process';

const TXN = 'txn-1';
const flush = () => new Promise((r) => setTimeout(r, 30));

const docs: Record<string, unknown> = {
  cardTransactionLog: {
    cardTransactionInstanceReference: TXN, merchantAgreementInstanceReference: 'mer-1',
    cardTransactionAmount: { amount: 100, currency: 'EUR' }, cardTransactionStatus: 'authorized',
    paymentCardReference: 'pm_token_1',
  },
  merchantAgreementProcedure: { merchantAgreementInstanceReference: 'mer-1', merchantDefaultPayoutAccountReference: 'acc-mer' },
  paymentCardManagement: { paymentCardReference: 'pm_token_1', fundingPayoutAccountInstanceReference: 'acc-holder' },
  payoutAccountArrangement: {
    payoutAccountInstanceReference: 'acc-mer', payoutAccountCurrency: 'EUR', payoutAccountPreferredRail: 'sepa',
    payoutAccountIban: 'ES5198201054503844130418', payoutAccountAlias: 'Merchant Settlement',
  },
};

function fakeDb(): Db {
  return {
    collection: (name: string) => ({
      findOne: vi.fn(async (filter: { payoutAccountInstanceReference?: string }) =>
        name === 'payoutAccountArrangement' && filter?.payoutAccountInstanceReference === 'acc-holder'
          ? {
            payoutAccountInstanceReference: 'acc-holder', payoutAccountCurrency: 'EUR',
            payoutAccountBankAccountReference: 'acc-bank-1', payoutAccountAspspReference: 'bank-1', payoutAccountConsentReference: 'cns-1',
          }
          : (docs[name] ?? null)),
      updateOne: vi.fn(async (filter: unknown, update: unknown) => { h.updates.push({ filter, update }); return { matchedCount: 1 }; }),
      insertOne: vi.fn(async () => ({ insertedId: 'x' })),
    }),
  } as unknown as Db;
}

const caseCleared = makeEvent({
  eventType: 'fraud.case.resolved', correlationId: TXN, businessProcess: 'fraud_investigation' as const,
  payload: { fraudDiagnosisInstanceReference: 'case-1', cardTransactionInstanceReference: TXN, outcome: 'cleared' },
});

describe('merchant payout at the bank', () => {
  beforeEach(() => {
    h.order.length = 0;
    h.updates.length = 0;
    for (const fn of [h.debitPending, h.creditAvailable, h.creditDirect, h.appendResolutionStep, h.transitionExecution, h.ask, h.createExecution]) fn.mockClear();
    h.initiatePaymentAtBank.mockResolvedValue({ bankPaymentReference: 'bank-pay-1', transactionStatus: 'ACTC' });
  });

  it('releases the hold, then pays the merchant IBAN, with no local reservation', async () => {
    const bus = new EventBusInProcess();
    new PayoutOrchestrationProcess(fakeDb(), bus).register();
    await bus.publish(caseCleared);
    await flush();

    expect(h.order).toEqual(['release', 'pay']);
    expect(h.debitPending).not.toHaveBeenCalled();
    expect(h.initiatePaymentAtBank).toHaveBeenCalledWith(expect.objectContaining({
      creditorIban: 'ES5198201054503844130418', endToEndIdentification: 'exec-1', amount: 100, currency: 'EUR',
    }));
    expect(h.transitionExecution).toHaveBeenCalledWith(expect.anything(), 'exec-1', 'in_flight', expect.anything());
    expect(h.updates.some((u) => JSON.stringify(u.update).includes('paymentExecutionDelegatedToAspsp'))).toBe(true);
  });

  it('puts the hold back when the bank refuses the payment', async () => {
    h.initiatePaymentAtBank.mockResolvedValue({ error: 'insufficient funds' });
    const bus = new EventBusInProcess();
    new PayoutOrchestrationProcess(fakeDb(), bus).register();
    await bus.publish(caseCleared);
    await flush();

    expect(h.order).toEqual(['release', 'pay', 'rehold']);
    expect(h.transitionExecution).not.toHaveBeenCalledWith(expect.anything(), 'exec-1', 'in_flight', expect.anything());
  });

  it('settles the transaction when the bank reports the payment settled, crediting nobody', async () => {
    h.getExecution.mockResolvedValue({
      paymentExecutionInstanceReference: 'exec-1', cardTransactionInstanceReference: TXN,
      paymentExecutionDelegatedToAspsp: true, aspspPaymentReference: 'bank-pay-1',
      grossAmount: 100, netAmount: 99, feeAmount: 1, currency: 'EUR', resolvedPayoutAccountReference: 'acc-mer',
    });
    const bus = new EventBusInProcess();
    new PayoutOrchestrationProcess(fakeDb(), bus).register();
    await bus.publish(makeEvent({
      eventType: 'bank.transfer.settled', correlationId: 'exec-1', businessProcess: 'payment_processing' as never,
      payload: { paymentExecutionInstanceReference: 'exec-1', railRef: 'bank-pay-1' },
    }));
    await flush();

    expect(h.creditAvailable).not.toHaveBeenCalled();
    expect(h.creditDirect).not.toHaveBeenCalled();
    expect(h.updates.some((u) => JSON.stringify(u.update).includes('"cardTransactionStatus":"settled"'))).toBe(true);
  });
});

describe('a payout never moves a bank balance twice', () => {
  it('does nothing when a live execution already exists for the transaction', async () => {
    docs.paymentExecutionProcedure = { paymentExecutionInstanceReference: 'exec-live', paymentExecutionStatus: 'in_flight' };
    h.order.length = 0;
    try {
      const bus = new EventBusInProcess();
      new PayoutOrchestrationProcess(fakeDb(), bus).register();
      await bus.publish(caseCleared);
      await flush();
      expect(h.order).toEqual([]);
      expect(h.createExecution).not.toHaveBeenCalled();
    } finally {
      delete docs.paymentExecutionProcedure;
    }
  });
});
