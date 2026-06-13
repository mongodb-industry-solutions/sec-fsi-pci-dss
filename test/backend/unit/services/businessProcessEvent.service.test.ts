/**
 * Unit tests: businessProcessEvent.service (ADR-025 / F7.1)
 * Covers: routing by processType, CHD sanitization, fire-and-forget robustness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'mock-id' });
  const collection = vi.fn(() => ({ insertOne }));
  return { insertOne, collection };
});

// We only mock uuid so we get deterministic IDs in assertions
vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

import {
  emitProcessEvent,
  emitComplianceEvent,
} from '../../../../backend/src/modules/integrations/services/businessProcessEvent.service';

function makeDb() {
  return { collection: h.collection } as unknown as Parameters<typeof emitProcessEvent>[0];
}

beforeEach(() => {
  h.insertOne.mockClear();
  h.collection.mockClear();
});

// ── routing ──────────────────────────────────────────────────────────────────

describe('emitProcessEvent — routing', () => {
  it('routes payment_processing to businessProcessEvent collection', () => {
    emitProcessEvent(makeDb(), {
      entityType: 'transaction',
      entityId: 'txn-001',
      processType: 'payment_processing',
      processAction: 'transaction.authorized',
      processOutcome: 'approved',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: { amount: 100 },
      bianServiceDomain: 'Card Transaction',
      bianControlRecordType: 'CardTransactionLog',
    });
    expect(h.collection).toHaveBeenCalledWith('businessProcessEvent');
  });

  it('routes fraud_evaluation to businessProcessEvent collection', () => {
    emitProcessEvent(makeDb(), {
      entityType: 'fraud_case',
      entityId: 'case-001',
      processType: 'fraud_evaluation',
      processAction: 'case.created',
      processOutcome: 'pending',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: {},
      bianServiceDomain: 'Fraud Diagnosis',
      bianControlRecordType: 'FraudDiagnosisCase',
    });
    expect(h.collection).toHaveBeenCalledWith('businessProcessEvent');
  });
});

describe('emitComplianceEvent — routing', () => {
  it('routes kyc_verification to complianceProcessEvent collection', () => {
    emitComplianceEvent(makeDb(), {
      entityType: 'customer',
      entityId: 'cust-001',
      processType: 'kyc_verification',
      processAction: 'kyc.initiated',
      processOutcome: 'pending',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: {},
      bianServiceDomain: 'Customer Agreement',
      bianControlRecordType: 'CustomerAgreementProcedure',
    });
    expect(h.collection).toHaveBeenCalledWith('complianceProcessEvent');
  });

  it('routes merchant_onboarding to complianceProcessEvent collection', () => {
    emitComplianceEvent(makeDb(), {
      entityType: 'merchant',
      entityId: 'merch-001',
      processType: 'merchant_onboarding',
      processAction: 'merchant.submitted',
      processOutcome: 'pending',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: {},
      bianServiceDomain: 'Merchant Relations',
      bianControlRecordType: 'MerchantAgreementProcedure',
    });
    expect(h.collection).toHaveBeenCalledWith('complianceProcessEvent');
  });
});

// ── CHD sanitization ─────────────────────────────────────────────────────────

describe('CHD blocklist sanitization', () => {
  it('removes pan from eventSummary', () => {
    emitProcessEvent(makeDb(), {
      entityType: 'transaction',
      entityId: 'txn-002',
      processType: 'payment_processing',
      processAction: 'transaction.authorized',
      processOutcome: 'approved',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: { amount: 500, pan: '4111111111111111', currency: 'USD' },
      bianServiceDomain: 'Card Transaction',
      bianControlRecordType: 'CardTransactionLog',
    });
    const doc = h.insertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    const summary = doc.eventSummary as Record<string, unknown>;
    expect(summary).not.toHaveProperty('pan');
    expect(summary).toHaveProperty('amount', 500);
    expect(summary).toHaveProperty('currency', 'USD');
  });

  it('removes cvv, cvv2, cardNumber, expiryDate from eventSummary', () => {
    emitProcessEvent(makeDb(), {
      entityType: 'transaction',
      entityId: 'txn-003',
      processType: 'payment_processing',
      processAction: 'transaction.authorized',
      processOutcome: 'approved',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: {
        amount: 200,
        cvv: '123',
        cvv2: '456',
        cardNumber: '4111111111111111',
        expiryDate: '12/26',
        trackData: 'sensitive',
        merchant: 'Safe Store',
      },
      bianServiceDomain: 'Card Transaction',
      bianControlRecordType: 'CardTransactionLog',
    });
    const doc = h.insertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    const summary = doc.eventSummary as Record<string, unknown>;
    expect(summary).not.toHaveProperty('cvv');
    expect(summary).not.toHaveProperty('cvv2');
    expect(summary).not.toHaveProperty('cardNumber');
    expect(summary).not.toHaveProperty('expiryDate');
    expect(summary).not.toHaveProperty('trackData');
    expect(summary).toHaveProperty('merchant', 'Safe Store');
  });
});

// ── fire-and-forget robustness ────────────────────────────────────────────────

describe('fire-and-forget robustness', () => {
  it('does not throw when db has no collection method (test mock)', () => {
    expect(() => {
      emitProcessEvent({} as never, {
        entityType: 'transaction',
        entityId: 'txn-004',
        processType: 'payment_processing',
        processAction: 'transaction.authorized',
        processOutcome: 'approved',
        performedByPartyReference: null,
        performedByRole: null,
        eventSummary: {},
        bianServiceDomain: 'Card Transaction',
        bianControlRecordType: 'CardTransactionLog',
      });
    }).not.toThrow();
  });

  it('does not throw when insertOne rejects', () => {
    h.insertOne.mockRejectedValueOnce(new Error('DB write error'));
    expect(() => {
      emitProcessEvent(makeDb(), {
        entityType: 'transaction',
        entityId: 'txn-005',
        processType: 'payment_processing',
        processAction: 'transaction.authorized',
        processOutcome: 'approved',
        performedByPartyReference: null,
        performedByRole: null,
        eventSummary: {},
        bianServiceDomain: 'Card Transaction',
        bianControlRecordType: 'CardTransactionLog',
      });
    }).not.toThrow();
  });

  it('insertOne is called exactly once per emit', () => {
    emitProcessEvent(makeDb(), {
      entityType: 'transaction',
      entityId: 'txn-006',
      processType: 'payment_processing',
      processAction: 'transaction.authorized',
      processOutcome: 'approved',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: { amount: 10 },
      bianServiceDomain: 'Card Transaction',
      bianControlRecordType: 'CardTransactionLog',
    });
    expect(h.insertOne).toHaveBeenCalledTimes(1);
  });
});
