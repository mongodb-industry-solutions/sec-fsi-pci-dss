/**
 * Unit tests: fraudDiagnosis.service (FR-v1-04)
 * Source: backend/src/modules/fraud/services/fraudDiagnosis.service.ts
 */
import { describe, it, expect, vi } from 'vitest';

// dispatchProvider is a fire-and-forget side effect (outbound webhook). Stub it so
// case creation is tested in isolation and no real dispatch is attempted.
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationDispatch.service', () => ({
  dispatchProvider: vi.fn().mockResolvedValue(undefined),

  // The institution-bound door (v37 P13) delegates to the same spy, so assertions about what was
  // dispatched are unaffected; the extra resolution argument is dropped where it is not asserted.
  dispatchToInstitution: (db: any, type: any, event: any, payload: any, _resolution: any, context: any) =>
    (vi.fn().mockResolvedValue(undefined))(db, type, event, payload, context),
}));
// emitProcessEvent is a fire-and-forget audit write (businessProcessEvent collection). Stub it so the
// shared insertOne spy counts only the case + opening-event writes this test asserts on.
vi.mock('../../../../../psp/backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: vi.fn().mockResolvedValue(undefined),
}));

// createNotification is a fire-and-forget side effect at the end of createFraudCase. Stub it so the
// execution-open tests focus on the case + link writes.
vi.mock('../../../../../psp/backend/src/modules/notification/notifications.service', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

import { createFraudCase, getCases, getCaseById, openCaseFromExecution } from '../../../../../psp/backend/src/modules/fraud/services/fraudDiagnosis.service';

// Minimal transaction snapshot embedded in every fraud case .
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
      // ADR-024: restart-safe case reference uses an atomic counter (findOneAndUpdate).
      findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'caseRefSeq', seq: 1 }),
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

describe('openCaseFromExecution (SD-65 transfer)', () => {
  const exec = {
    paymentExecutionInstanceReference: 'exec-777',
    initiatorPartyReference: 'party-1',
    grossAmount: 850,
    currency: 'USD',
    paymentExecutionRail: 'sepa',
    paymentExecutionStatus: 'completed',
    beneficiaryName: 'Jane Roe',
    destinationAccountMasked: 'ES12••••5477',
    destinationIban: 'SHOULD-NEVER-APPEAR',
    initiatedAt: new Date(),
    recordCreatedDateTime: new Date(),
  };

  // Multi-collection mock: routes findOne/insertOne/updateOne per collection name and records writes.
  function makeExecDb(opts?: { dedup?: unknown; exec?: unknown; agreementUuid?: string }) {
    const writes = { inserts: [] as Array<{ name: string; doc: any }>, updates: [] as Array<{ name: string; filter: any; update: any }> };
    let createdCase: any = null;

    const collection = vi.fn((name: string) => ({
      findOne: vi.fn((filter: any) => {
        if (name === 'fraudDiagnosisCase') {
          // dedup query carries paymentExecutionInstanceReference + status; getCaseById carries the instance ref.
          if (filter?.paymentExecutionInstanceReference && filter?.fraudDiagnosisCaseStatus) return Promise.resolve(opts?.dedup ?? null);
          return Promise.resolve(createdCase);
        }
        if (name === 'paymentExecutionProcedure') return Promise.resolve(opts && 'exec' in opts ? opts.exec : exec);
        if (name === 'customerAgreementProcedure') {
          // Service derives the agreement by party; createFraudCase notification lookup also hits this.
          if (filter?.partyInstanceReference) return Promise.resolve(opts?.agreementUuid ? { customerAgreementInstanceReference: opts.agreementUuid } : null);
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      }),
      insertOne: vi.fn((doc: any) => {
        writes.inserts.push({ name, doc });
        if (name === 'fraudDiagnosisCase') createdCase = doc; // getCaseById reads it back
        return Promise.resolve({ insertedId: 'x' });
      }),
      updateOne: vi.fn((filter: any, update: any) => {
        writes.updates.push({ name, filter, update });
        if (name === 'fraudDiagnosisCase' && createdCase && update?.$set) Object.assign(createdCase, update.$set);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'caseRefSeq', seq: 1 }),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    }));

    return { db: { collection } as any, writes };
  }

  it('creates a case and links the SD-65 execution (paymentExecutionInstanceReference + transactionKind p2p)', async () => {
    const { db, writes } = makeExecDb({ agreementUuid: 'cust-uuid-1' });
    const res = await openCaseFromExecution(db, 'exec-777', 'suspicious transfer');
    expect('notFound' in res).toBe(false);
    if ('notFound' in res) return;
    expect(res.alreadyExisted).toBe(false);
    expect(res.fraudDiagnosisInstanceReference).toMatch(/^[0-9a-f-]{36}$/);

    const link = writes.updates.find((u) => u.name === 'fraudDiagnosisCase' && u.update?.$set?.paymentExecutionInstanceReference);
    expect(link).toBeTruthy();
    expect(link!.update.$set.paymentExecutionInstanceReference).toBe('exec-777');
    expect(link!.update.$set.transactionKind).toBe('p2p');
  });

  it('derives the customer agreement from the initiator party', async () => {
    const { db, writes } = makeExecDb({ agreementUuid: 'cust-uuid-1' });
    await openCaseFromExecution(db, 'exec-777', undefined);
    const caseDoc = writes.inserts.find((i) => i.name === 'fraudDiagnosisCase');
    expect(caseDoc!.doc.customerAgreementInstanceReference).toBe('cust-uuid-1');
    expect(caseDoc!.doc.cardTransactionInstanceReference).toBe('exec-777');
  });

  it('builds a display-safe snapshot with NO raw IBAN', async () => {
    const { db, writes } = makeExecDb({ agreementUuid: 'cust-uuid-1' });
    await openCaseFromExecution(db, 'exec-777', undefined);
    const caseDoc = writes.inserts.find((i) => i.name === 'fraudDiagnosisCase')!.doc;
    const serialized = JSON.stringify(caseDoc.transactionSnapshot);
    expect(serialized).not.toContain('SHOULD-NEVER-APPEAR');
    expect(caseDoc.transactionSnapshot.cardTransactionMaskedPanDisplay).toBe('ES12••••5477');
  });

  it('dedups: returns an existing non-resolved case without creating a duplicate', async () => {
    const { db, writes } = makeExecDb({ dedup: { fraudDiagnosisInstanceReference: 'case-existing', fraudDiagnosisCaseReference: 'FD-2026-000009' } });
    const res = await openCaseFromExecution(db, 'exec-777', undefined);
    expect(res).toEqual({ fraudDiagnosisInstanceReference: 'case-existing', fraudDiagnosisCaseReference: 'FD-2026-000009', alreadyExisted: true });
    expect(writes.inserts.some((i) => i.name === 'fraudDiagnosisCase')).toBe(false);
  });

  it('returns notFound when the execution does not exist', async () => {
    const { db } = makeExecDb({ exec: null });
    const res = await openCaseFromExecution(db, 'missing', undefined);
    expect(res).toEqual({ notFound: true });
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

// The payment follow-up is event-driven: resolving a case publishes fraud.case.resolved, which the
// payout process consumes to release or reverse the withheld payment.
describe('updateCase publishes the resolution', () => {
  function resolveDb(caseDoc: Record<string, unknown>) {
    return {
      collection: vi.fn().mockReturnValue({
        findOneAndUpdate: vi.fn().mockResolvedValue(caseDoc),
      }),
    } as any;
  }

  async function captureResolution(status: string, caseDoc: Record<string, unknown>) {
    const { setEventBus, getEventBus } = await import('../../../../../psp/backend/src/vendors/eventbus');
    const { EventBusInProcess } = await import('@leafypay/eventbus');
    setEventBus(new EventBusInProcess());
    const seen: Array<Record<string, unknown>> = [];
    getEventBus().subscribe('fraud.case.resolved', (e) => { seen.push(e.payload as Record<string, unknown>); });
    const { updateCase } = await import('../../../../../psp/backend/src/modules/fraud/services/fraudDiagnosis.service');
    await updateCase(resolveDb(caseDoc), 'case-1', { fraudDiagnosisCaseStatus: status as never });
    return seen;
  }

  const linked = { fraudDiagnosisInstanceReference: 'case-1', cardTransactionInstanceReference: 'txn-1' };

  it('maps resolved_cleared to a cleared outcome', async () => {
    const seen = await captureResolution('resolved_cleared', linked);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ outcome: 'cleared', cardTransactionInstanceReference: 'txn-1' });
  });

  it('maps resolved_fraud to a confirmed_fraud outcome', async () => {
    const seen = await captureResolution('resolved_fraud', linked);
    expect(seen[0]).toMatchObject({ outcome: 'confirmed_fraud' });
  });

  it('publishes nothing for a non-terminal status change', async () => {
    expect(await captureResolution('under_review', linked)).toHaveLength(0);
  });

  it('publishes nothing for a case with no linked transaction reference at all', async () => {
    const seen = await captureResolution('resolved_fraud', { fraudDiagnosisInstanceReference: 'case-2' });
    expect(seen).toHaveLength(0);
  });
});
