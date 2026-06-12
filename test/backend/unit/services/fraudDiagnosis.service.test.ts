/**
 * Unit tests: fraudDiagnosis.service (FR-v1-04)
 * Source: backend/src/modules/fraud/services/fraudDiagnosis.service.ts
 */
import { describe, it, expect, vi } from 'vitest';

// dispatchIntegration is a fire-and-forget side effect (outbound webhook). Stub it so
// case creation is tested in isolation and no real dispatch is attempted.
vi.mock('../../../../backend/src/modules/integrations/services/integrationDispatch.service', () => ({
  dispatchIntegration: vi.fn().mockResolvedValue(undefined),
}));

import { createFraudCase, getCases, getCaseById } from '../../../../backend/src/modules/fraud/services/fraudDiagnosis.service';

// Minimal transaction snapshot embedded in every fraud case (BIAN SD-254).
const snapshot = {
  cardTransactionAmount: { amount: 850, currency: 'USD' },
  cardTransactionMerchantName: 'Test Merchant',
  cardTransactionDateTime: new Date(),
  cardTransactionStatus: 'authorized' as const,
  cardTransactionMaskedPanDisplay: '****-****-****-1234',
};

function makeDb(overrides?: { findResults?: unknown[]; total?: number; findOneResult?: unknown }) {
  const insertOneMock = vi.fn().mockResolvedValue({ insertedId: 'mock' });
  const docs = overrides?.findResults ?? [];
  return {
    collection: vi.fn().mockReturnValue({
      insertOne: insertOneMock,
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(docs),
      }),
      findOne: vi.fn().mockResolvedValue(overrides?.findOneResult ?? null),
      countDocuments: vi.fn().mockResolvedValue(overrides?.total ?? docs.length),
    }),
    _insertOne: insertOneMock,
  } as any;
}

describe('createFraudCase', () => {
  // The service writes two documents: the case (FraudDiagnosis collection) and a
  // case_opened audit event (FraudDiagnosisEvents collection). The mock shares one
  // insertOne spy, so calls[0] = case doc, calls[1] = event doc.
  it('inserts case + opening event and returns a UUID reference', async () => {
    const db = makeDb();
    const result = await createFraudCase(db, 'txn-001', 'cust-001', ['amount_threshold'], 'high', snapshot);
    expect(result.fraudDiagnosisInstanceReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(db._insertOne).toHaveBeenCalledTimes(2);
  });

  it('document starts with status = open', async () => {
    const db = makeDb();
    await createFraudCase(db, 'txn-001', 'cust-001', ['amount_threshold'], 'medium', snapshot);
    expect(db._insertOne.mock.calls[0][0].fraudDiagnosisCaseStatus).toBe('open');
  });

  it('fraudDiagnosisCaseReference follows FD-YYYY-NNNNNN pattern', async () => {
    const db = makeDb();
    await createFraudCase(db, 'txn-001', 'cust-001', ['amount_threshold'], 'high', snapshot);
    expect(db._insertOne.mock.calls[0][0].fraudDiagnosisCaseReference).toMatch(/^FD-\d{4}-\d{6}$/);
  });

  it('opening event is a single case_opened entry authored by payment_service', async () => {
    const db = makeDb();
    await createFraudCase(db, 'txn-001', 'cust-001', ['amount_threshold'], 'high', snapshot);
    const event = db._insertOne.mock.calls[1][0];
    expect(event.actionType).toBe('case_opened');
    expect(event.performedByRole).toBe('payment_service');
  });

  it('links to the correct transaction and customer references', async () => {
    const db = makeDb();
    await createFraudCase(db, 'txn-xyz', 'cust-abc', ['high_risk_mcc'], 'critical', snapshot);
    const doc = db._insertOne.mock.calls[0][0];
    expect(doc.cardTransactionInstanceReference).toBe('txn-xyz');
    expect(doc.customerAgreementInstanceReference).toBe('cust-abc');
  });

  it('fraudDiagnosisScore grows with more risk indicators', async () => {
    const db1 = makeDb();
    await createFraudCase(db1, 'txn-1', 'c-1', ['amount_threshold'], 'high', snapshot);
    const score1 = db1._insertOne.mock.calls[0][0].fraudDiagnosisAssessment.fraudDiagnosisScore;

    const db2 = makeDb();
    await createFraudCase(db2, 'txn-2', 'c-1', ['amount_threshold', 'high_risk_mcc'], 'critical', snapshot);
    const score2 = db2._insertOne.mock.calls[0][0].fraudDiagnosisAssessment.fraudDiagnosisScore;

    expect(score1).toBeLessThan(score2);
  });
});

describe('getCases', () => {
  it('returns paginated results with correct metadata', async () => {
    const cases = Array.from({ length: 5 }, (_, i) => ({ fraudDiagnosisInstanceReference: `case-${i}` }));
    const result = await getCases(makeDb({ findResults: cases, total: 20 }), {}, 1, 5);
    expect(result.results).toHaveLength(5);
    expect(result.total).toBe(20);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(5);
  });

  it('passes status filter to query', async () => {
    const db = makeDb({ findResults: [], total: 0 });
    await getCases(db, { status: 'open' }, 1, 10);
    expect(db.collection().find).toHaveBeenCalledWith(
      expect.objectContaining({ fraudDiagnosisCaseStatus: 'open' })
    );
  });

  it('passes severity filter to query', async () => {
    const db = makeDb({ findResults: [], total: 0 });
    await getCases(db, { severity: 'high' }, 1, 10);
    expect(db.collection().find).toHaveBeenCalledWith(
      expect.objectContaining({ fraudDiagnosisCaseSeverity: 'high' })
    );
  });

  it('passes empty query when no filters provided', async () => {
    const db = makeDb({ findResults: [], total: 0 });
    await getCases(db, {}, 1, 10);
    expect(db.collection().find).toHaveBeenCalledWith({});
  });
});

describe('getCaseById', () => {
  it('returns the fraud case when found', async () => {
    const caseDoc = { fraudDiagnosisInstanceReference: 'case-001', fraudDiagnosisCaseReference: 'FD-2026-001001' };
    const result = await getCaseById(makeDb({ findOneResult: caseDoc }), 'case-001');
    expect(result).toEqual(caseDoc);
  });

  it('returns null when not found', async () => {
    expect(await getCaseById(makeDb({ findOneResult: null }), 'nonexistent')).toBeNull();
  });
});
