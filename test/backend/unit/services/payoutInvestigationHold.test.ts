/**
 * Unit tests: a payment flagged for investigation is ACCEPTED but NOT COMPLETED.
 *  - the payout is withheld while the fraud case is open (no ledger movement, no execution);
 *  - a cleared case releases the withheld payout;
 *  - a confirmed-fraud case returns the cardholder hold and declines the transaction;
 *  - an already settled/declined transaction is never re-processed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  debitPending: vi.fn(async () => true),
  releaseCardHold: vi.fn(async () => true),
  settleCardDebit: vi.fn(async () => true),
  creditAvailable: vi.fn(async () => true),
  creditDirect: vi.fn(async () => true),
  releasePendingCredit: vi.fn(async () => true),
  createExecution: vi.fn(async () => ({ paymentExecutionInstanceReference: 'exec-1' })),
  transitionExecution: vi.fn(async () => ({})),
  appendResolutionStep: vi.fn(async () => ({})),
  getExecution: vi.fn(async () => null),
  resolveMerchantFee: vi.fn(async () => ({ feeAmount: 0, netAmount: 100, fee: undefined })),
  getDefaultPayoutAccount: vi.fn(async () => null),
  dispatchProvider: vi.fn(async () => ({ provider: 'internal', status: 'received', responseBody: {} })),
  emitProcessEvent: vi.fn(),
  emitComplianceEvent: vi.fn(),
  declineTransaction: vi.fn(async () => {}),
  postCommission: vi.fn(async () => ({ outcome: 'collected' })),
}));

vi.mock('../../../../backend/src/modules/gateway/services/payoutAccountBalance.service', () => ({
  debitPending: h.debitPending, releaseCardHold: h.releaseCardHold, settleCardDebit: h.settleCardDebit,
  creditAvailable: h.creditAvailable, creditDirect: h.creditDirect, releasePendingCredit: h.releasePendingCredit,
}));
vi.mock('../../../../backend/src/modules/gateway/services/paymentExecution.service', () => ({
  createExecution: h.createExecution, transitionExecution: h.transitionExecution,
  appendResolutionStep: h.appendResolutionStep, getExecution: h.getExecution, resolveMerchantFee: h.resolveMerchantFee,
}));
vi.mock('../../../../backend/src/modules/gateway/services/payoutAccount.service', () => ({ getDefaultPayoutAccount: h.getDefaultPayoutAccount }));
vi.mock('../../../../backend/src/modules/gateway/services/commissionSettlement.service', () => ({
  postCommission: h.postCommission, requiresFeeRelease: () => false,
}));
vi.mock('../../../../backend/src/modules/provider/services/integrationDispatch.service', () => ({ dispatchProvider: h.dispatchProvider }));
vi.mock('../../../../backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: h.emitProcessEvent, emitComplianceEvent: h.emitComplianceEvent,
}));
vi.mock('../../../../backend/src/modules/transaction/services/cardTransaction.service', () => ({ declineTransaction: h.declineTransaction }));

import type { Db } from 'mongodb';
import { EventBusInProcess } from '../../../../backend/src/vendors/eventbus/EventBusInProcess';
import { makeEvent } from '../../../../backend/src/vendors/eventbus';
import { PayoutOrchestrationProcess } from '../../../../backend/src/modules/gateway/services/payoutOrchestration.process';

const flush = () => new Promise((r) => setTimeout(r, 20));
const TXN = 'txn-1';

// Fake Db: only the reads the payout path performs. `status` drives the transaction state under test.
function fakeDb(status: string): Db {
  const docs: Record<string, unknown> = {
    cardTransactionLog: {
      cardTransactionInstanceReference: TXN,
      merchantAgreementInstanceReference: 'mer-1',
      cardTransactionAmount: { amount: 100, currency: 'USD' },
      cardTransactionStatus: status,
      paymentCardInstanceReference: 'card-1',
    },
    merchantAgreementProcedure: { merchantAgreementInstanceReference: 'mer-1', merchantDefaultPayoutAccountReference: 'acc-mer' },
    payoutAccountArrangement: {
      payoutAccountInstanceReference: 'acc-mer', payoutAccountCurrency: 'USD', payoutAccountPreferredRail: 'internal_ledger',
    },
    paymentCardManagement: { paymentCardInstanceReference: 'card-1', fundingPayoutAccountInstanceReference: 'acc-holder' },
  };
  return {
    collection: (name: string) => ({
      findOne: vi.fn(async () => docs[name] ?? null),
      updateOne: vi.fn(async () => ({ matchedCount: 1 })),
      insertOne: vi.fn(async () => ({ insertedId: 'x' })),
    }),
  } as unknown as Db;
}

const authorized = (fraudCaseCreated: boolean) => makeEvent({
  eventType: 'card.payment.authorization.completed', correlationId: TXN, businessProcess: 'card_payment' as const,
  payload: { outcome: 'authorized', fraudCaseCreated, ...(fraudCaseCreated ? { fraudDiagnosisInstanceReference: 'case-1' } : {}) },
});
const caseResolved = (outcome: string) => makeEvent({
  eventType: 'fraud.case.resolved', correlationId: TXN, businessProcess: 'fraud_investigation' as const,
  payload: { fraudDiagnosisInstanceReference: 'case-1', cardTransactionInstanceReference: TXN, outcome },
});

function wire(status = 'authorized') {
  const bus = new EventBusInProcess();
  new PayoutOrchestrationProcess(fakeDb(status), bus).register();
  return bus;
}

describe('payout is withheld while an investigation is open', () => {
  beforeEach(() => { for (const fn of Object.values(h)) (fn as { mockClear?: () => void }).mockClear?.(); });

  it('pays out normally when no case was opened', async () => {
    await wire().publish(authorized(false));
    await flush();
    expect(h.debitPending).toHaveBeenCalled();
    expect(h.createExecution).toHaveBeenCalled();
  });

  it('does NOT move money nor create an execution when a case was opened', async () => {
    await wire().publish(authorized(true));
    await flush();
    expect(h.debitPending).not.toHaveBeenCalled();
    expect(h.createExecution).not.toHaveBeenCalled();
    expect(h.emitProcessEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ processAction: 'payout.withheld' }));
  });
});

describe('case resolution closes the withheld payment', () => {
  beforeEach(() => { for (const fn of Object.values(h)) (fn as { mockClear?: () => void }).mockClear?.(); });

  it('cleared: releases the withheld payout', async () => {
    await wire('authorized').publish(caseResolved('cleared'));
    await flush();
    expect(h.debitPending).toHaveBeenCalled();
    expect(h.createExecution).toHaveBeenCalled();
    expect(h.declineTransaction).not.toHaveBeenCalled();
  });

  it('confirmed fraud: returns the cardholder hold and declines, without paying the merchant', async () => {
    await wire('authorized').publish(caseResolved('confirmed_fraud'));
    await flush();
    expect(h.releaseCardHold).toHaveBeenCalledWith(expect.anything(), 'acc-holder', 100);
    expect(h.declineTransaction).toHaveBeenCalledWith(expect.anything(), TXN, 'confirmed_fraud', 'fraud_confirmed');
    expect(h.debitPending).not.toHaveBeenCalled();
  });

  it('ignores a resolution for an already settled transaction', async () => {
    await wire('settled').publish(caseResolved('confirmed_fraud'));
    await flush();
    expect(h.releaseCardHold).not.toHaveBeenCalled();
    expect(h.declineTransaction).not.toHaveBeenCalled();
  });

  it('ignores a resolution with no linked reference at all', async () => {
    const bus = wire('authorized');
    await bus.publish(makeEvent({
      eventType: 'fraud.case.resolved', correlationId: 'exec-9', businessProcess: 'fraud_investigation' as const,
      payload: { fraudDiagnosisInstanceReference: 'case-2', outcome: 'confirmed_fraud' },
    }));
    await flush();
    expect(h.releaseCardHold).not.toHaveBeenCalled();
    expect(h.debitPending).not.toHaveBeenCalled();
  });
});

// A transfer case carries the execution reference in the same field, so the resolution falls through
// to the held-transfer branch when the reference is not a card transaction.
describe('case resolution on a held transfer', () => {
  beforeEach(() => { for (const fn of Object.values(h)) (fn as { mockClear?: () => void }).mockClear?.(); });

  function wireNoCardTxn() {
    const bus = new EventBusInProcess();
    const db = { collection: () => ({ findOne: vi.fn(async () => null), updateOne: vi.fn(async () => ({ matchedCount: 0 })) }) } as unknown as Db;
    new PayoutOrchestrationProcess(db, bus).register();
    return bus;
  }

  it('routes a cleared resolution to the transfer branch, not the card branch', async () => {
    await wireNoCardTxn().publish(caseResolved('cleared'));
    await flush();
    // No card transaction exists, so nothing on the card path ran.
    expect(h.declineTransaction).not.toHaveBeenCalled();
    expect(h.debitPending).not.toHaveBeenCalled();
  });

  it('ignores an unknown resolution outcome', async () => {
    await wireNoCardTxn().publish(caseResolved('referred'));
    await flush();
    expect(h.declineTransaction).not.toHaveBeenCalled();
    expect(h.releaseCardHold).not.toHaveBeenCalled();
  });
});
