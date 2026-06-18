/**
 * Unit tests: businessProcessEvent.service (ADR-025 + dev.v8 P6 §9.2 publish-then-project).
 * The audit ledger is now a PROJECTION: the emit helpers PUBLISH a domain event; the
 * LedgerProjection bus subscriber writes businessProcessEvent/complianceProcessEvent. Covers routing
 * by ledgerKind, CHD sanitization (stripped by the bus on publish), and fire-and-forget robustness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'mock-id' });
  const collection = vi.fn(() => ({ insertOne }));
  return { insertOne, collection };
});
vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

import {
  emitProcessEvent,
  emitComplianceEvent,
  LedgerProjection,
} from '../../../../backend/src/modules/provider/services/businessProcessEvent.service';
import { EventBusInProcess } from '../../../../backend/src/vendors/eventbus/EventBusInProcess';
import { setEventBus, getEventBus, makeEvent } from '../../../../backend/src/vendors/eventbus';

const mockDb = { collection: h.collection } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.insertOne.mockClear();
  h.collection.mockClear();
  // Fresh bus + the projection subscriber that writes the ledger from published events.
  setEventBus(new EventBusInProcess());
  new LedgerProjection(mockDb, getEventBus()).register();
});

// ── routing (now via the projection subscriber) ───────────────────────────────
describe('emit* → LedgerProjection routing', () => {
  it('routes payment_processing (business) to businessProcessEvent collection', async () => {
    emitProcessEvent(mockDb, {
      entityType: 'transaction', entityId: 'txn-001', processType: 'payment_processing',
      processAction: 'transaction.authorized', processOutcome: 'approved',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { amount: 100 }, bianServiceDomain: 'Card Transaction', bianControlRecordType: 'CardTransactionLog',
    });
    await flush();
    expect(h.collection).toHaveBeenCalledWith('businessProcessEvent');
  });

  it('routes kyc_verification (compliance) to complianceProcessEvent collection', async () => {
    emitComplianceEvent(mockDb, {
      entityType: 'customer', entityId: 'cust-001', processType: 'kyc_verification',
      processAction: 'profile.validation.completed', processOutcome: 'approved',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: {}, bianServiceDomain: 'Customer Agreement', bianControlRecordType: 'CustomerAgreementProcedure',
    });
    await flush();
    expect(h.collection).toHaveBeenCalledWith('complianceProcessEvent');
  });

  it('projects a faithful ledger row (action, outcome, entity, bian)', async () => {
    emitProcessEvent(mockDb, {
      entityType: 'transaction', entityId: 'txn-007', processType: 'payment_processing',
      processAction: 'transaction.authorized', processOutcome: 'approved',
      performedByPartyReference: 'p1', performedByRole: 'system',
      eventSummary: { amount: 10 }, bianServiceDomain: 'Card Transaction', bianControlRecordType: 'CardTransactionLog',
    });
    await flush();
    const row = h.insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(row.processAction).toBe('transaction.authorized');
    expect(row.processOutcome).toBe('approved');
    expect(row.entityId).toBe('txn-007');
    expect(row.entityType).toBe('transaction');
    expect(row.bianServiceDomain).toBe('Card Transaction');
    expect((row.eventSummary as Record<string, unknown>).amount).toBe(10);
    // projection metadata must NOT leak into the ledger eventSummary
    expect(row.eventSummary).not.toHaveProperty('ledgerKind');
    expect(row.eventSummary).not.toHaveProperty('processType');
  });
});

// ── P13.4: canonical §5 milestones project to the business ledger (no ledgerKind) ──────────────
describe('canonical milestone projection (P13.4)', () => {
  it('projects a gate *.completed (fds.scoring.completed) to the business ledger', async () => {
    getEventBus().publish(makeEvent({
      eventType: 'fds.scoring.completed', correlationId: 'txn-900', businessProcess: 'card_payment', source: 'callback.fds',
      payload: { transactionId: 'txn-900', outcome: 'approved', approved: true, riskScore: 75, rulesFired: ['HIGH_VALUE_TXN'] },
      bian: { serviceDomain: 'SD-63 Fraud Evaluation', controlRecord: 'FraudEvaluationAssessment' },
    }));
    await flush();
    expect(h.collection).toHaveBeenCalledWith('businessProcessEvent');
    const row = h.insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(row.processAction).toBe('fds.scoring.completed');
    expect(row.entityId).toBe('txn-900');
    expect(row.processType).toBe('fraud_evaluation');
    expect((row.eventSummary as Record<string, unknown>).riskScore).toBe(75);
  });

  it('projects the journey closing event (card.payment.authorization.completed)', async () => {
    getEventBus().publish(makeEvent({
      eventType: 'card.payment.authorization.completed', correlationId: 'txn-901', businessProcess: 'card_payment', source: 'saga.payment-authorization',
      payload: { outcome: 'authorized', fraudCaseCreated: false },
      bian: { serviceDomain: 'SD-254 Card Transaction', controlRecord: 'CardTransactionRecord' },
    }));
    await flush();
    const row = h.insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(row.processAction).toBe('card.payment.authorization.completed');
    expect(row.processOutcome).toBe('authorized');
  });

  it('does NOT project a non-canonical bus event that carries no ledgerKind', async () => {
    getEventBus().publish(makeEvent({
      eventType: 'fds.scoring.requested', correlationId: 'txn-902', businessProcess: 'card_payment', source: 'psp.core',
      payload: { amount: 100 },
    }));
    await flush();
    expect(h.insertOne).not.toHaveBeenCalled();
  });
});

// ── CHD sanitization (stripped by the bus on publish) ──────────────────────────
describe('CHD blocklist sanitization', () => {
  it('strips pan/cvv/cardNumber/expiryDate/trackData from the projected eventSummary', async () => {
    emitProcessEvent(mockDb, {
      entityType: 'transaction', entityId: 'txn-002', processType: 'payment_processing',
      processAction: 'transaction.authorized', processOutcome: 'approved',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { amount: 500, pan: '4111111111111111', cvv: '123', cvv2: '456', cardNumber: '4111111111111111', expiryDate: '12/26', trackData: 'x', merchant: 'Safe Store' },
      bianServiceDomain: 'Card Transaction', bianControlRecordType: 'CardTransactionLog',
    });
    await flush();
    const summary = (h.insertOne.mock.calls[0][0] as Record<string, unknown>).eventSummary as Record<string, unknown>;
    for (const k of ['pan', 'cvv', 'cvv2', 'cardNumber', 'expiryDate', 'trackData']) expect(summary).not.toHaveProperty(k);
    expect(summary).toHaveProperty('amount', 500);
    expect(summary).toHaveProperty('merchant', 'Safe Store');
  });
});

// ── fire-and-forget robustness ─────────────────────────────────────────────────
describe('fire-and-forget robustness', () => {
  it('emit* never throws even if the bus throws on publish', () => {
    setEventBus({ publish: () => { throw new Error('bus down'); }, subscribe: () => ({ unsubscribe() {} }), start: async () => {}, stop: async () => {} } as never);
    expect(() => emitProcessEvent(mockDb, {
      entityType: 'transaction', entityId: 'txn-004', processType: 'payment_processing',
      processAction: 'transaction.authorized', processOutcome: 'approved',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: {}, bianServiceDomain: '', bianControlRecordType: '',
    })).not.toThrow();
  });

  it('the projection swallows a failing ledger insert (no unhandled rejection)', async () => {
    h.insertOne.mockRejectedValueOnce(new Error('DB write error'));
    emitProcessEvent(mockDb, {
      entityType: 'transaction', entityId: 'txn-005', processType: 'payment_processing',
      processAction: 'transaction.authorized', processOutcome: 'approved',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: {}, bianServiceDomain: '', bianControlRecordType: '',
    });
    await flush();
    expect(h.insertOne).toHaveBeenCalledTimes(1);
  });
});
