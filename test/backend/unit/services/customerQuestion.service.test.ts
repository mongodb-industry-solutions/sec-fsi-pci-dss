/**
 * Unit tests: customer questions service (ADR-031, SD-83).
 * Validates immutability (no answer after close), option validation, "Other" free-text rules,
 * and ownership enforcement — the core PCI DSS Req 7/10 guarantees of the feature.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the case lookup + audit append + business events the service depends on.
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({
  getCaseById: vi.fn(),
  appendAuditEvent: vi.fn(async () => {}),
}));
vi.mock('../../../../backend/src/modules/providers/services/businessProcessEvent.service', () => ({
  emitProcessEvent: vi.fn(() => {}),
}));

import { createQuestion, submitResponse } from '../../../../backend/src/modules/fraud/services/customerQuestion.service';
import { getCaseById } from '../../../../backend/src/modules/fraud/services/fraudDiagnosis.service';
import { CUSTOMER_QUESTION_COLLECTION } from '../../../../backend/src/modules/fraud/models/customerQuestion.model';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../../../backend/src/modules/customer/models/customerAgreement.model';

const mockGetCaseById = getCaseById as unknown as ReturnType<typeof vi.fn>;

// In-memory fake of the two collections the service touches.
function makeDb(party = 'party-1') {
  const store = new Map<string, Record<string, unknown>>();
  const questionColl = {
    insertOne: async (doc: Record<string, unknown>) => { store.set(doc.customerQuestionInstanceReference as string, { ...doc }); return { acknowledged: true }; },
    findOne: async (filter: Record<string, unknown>) => {
      const id = filter.customerQuestionInstanceReference as string;
      const rec = id ? store.get(id) : undefined;
      if (!rec) return null;
      if (filter.questionStatus && rec.questionStatus !== filter.questionStatus) return null;
      return rec;
    },
    updateOne: async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      const id = filter.customerQuestionInstanceReference as string;
      const rec = store.get(id);
      if (!rec) return { matchedCount: 0 };
      if (filter.questionStatus && rec.questionStatus !== filter.questionStatus) return { matchedCount: 0 };
      Object.assign(rec, update.$set);
      return { matchedCount: 1 };
    },
    find: () => ({ sort: () => ({ toArray: async () => [...store.values()] }) }),
    countDocuments: async () => store.size,
  };
  return {
    collection: (name: string) => {
      if (name === CUSTOMER_QUESTION_COLLECTION) return questionColl;
      if (name === CUSTOMER_AGREEMENT_COLLECTION) return { findOne: async () => ({ partyInstanceReference: party }) };
      return { findOne: async () => null };
    },
  } as never;
}

const CASE = {
  fraudDiagnosisInstanceReference: 'case-1',
  fraudDiagnosisCaseReference: 'FD-0001',
  cardTransactionInstanceReference: 'txn-1',
  customerAgreementInstanceReference: 'agr-1',
};

async function seedQuestion(db: unknown) {
  mockGetCaseById.mockResolvedValue(CASE);
  const r = await createQuestion(db as never, 'case-1', { questionText: 'Did you perform this operation?', options: ['Yes', 'No'], allowOther: true }, { ref: 'analyst-1', name: 'L1', role: 'level1_analyst' });
  if (!r.ok) throw new Error('seed failed');
  return r.question.questionId;
}

describe('createQuestion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending question with the given options', async () => {
    const db = makeDb();
    mockGetCaseById.mockResolvedValue(CASE);
    const r = await createQuestion(db, 'case-1', { questionText: 'Q?', options: ['Yes', 'No'], allowOther: false }, { ref: 'a', role: 'level1_analyst' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.question.status).toBe('pending'); expect(r.question.options).toEqual(['Yes', 'No']); }
  });

  it('rejects an empty question or empty options', async () => {
    const db = makeDb();
    mockGetCaseById.mockResolvedValue(CASE);
    expect((await createQuestion(db, 'case-1', { questionText: '', options: ['Yes'], allowOther: false }, { role: 'level1_analyst' })).ok).toBe(false);
    expect((await createQuestion(db, 'case-1', { questionText: 'Q', options: [], allowOther: false }, { role: 'level1_analyst' })).ok).toBe(false);
  });

  it('returns case_not_found when the case does not exist', async () => {
    const db = makeDb();
    mockGetCaseById.mockResolvedValue(null);
    const r = await createQuestion(db, 'nope', { questionText: 'Q', options: ['Yes'], allowOther: false }, { role: 'level1_analyst' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('case_not_found');
  });
});

describe('submitResponse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a valid option and closes the question', async () => {
    const db = makeDb();
    const qid = await seedQuestion(db);
    const r = await submitResponse(db, qid, { option: 'No' }, { partyRef: 'party-1', txnId: 'txn-1' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.question.status).toBe('closed'); expect(r.question.responseOption).toBe('No'); }
  });

  it('is immutable: a second answer is rejected with already_closed', async () => {
    const db = makeDb();
    const qid = await seedQuestion(db);
    await submitResponse(db, qid, { option: 'Yes' }, { partyRef: 'party-1', txnId: 'txn-1' });
    const again = await submitResponse(db, qid, { option: 'No' }, { partyRef: 'party-1', txnId: 'txn-1' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe('already_closed');
  });

  it('rejects an option that is not offered', async () => {
    const db = makeDb();
    const qid = await seedQuestion(db);
    const r = await submitResponse(db, qid, { option: 'Maybe' }, { partyRef: 'party-1', txnId: 'txn-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid');
  });

  it('requires free text when answering "Other"', async () => {
    const db = makeDb();
    const qid = await seedQuestion(db);
    const r = await submitResponse(db, qid, { option: 'Other', text: '' }, { partyRef: 'party-1', txnId: 'txn-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid');
    const ok = await submitResponse(db, qid, { option: 'Other', text: 'It was my spouse.' }, { partyRef: 'party-1', txnId: 'txn-1' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.question.responseText).toBe('It was my spouse.');
  });

  it('forbids answering a question that belongs to another party', async () => {
    const db = makeDb('party-1');
    const qid = await seedQuestion(db);
    const r = await submitResponse(db, qid, { option: 'Yes' }, { partyRef: 'someone-else', txnId: 'txn-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('forbidden');
  });

  it('forbids answering through a different transaction', async () => {
    const db = makeDb();
    const qid = await seedQuestion(db);
    const r = await submitResponse(db, qid, { option: 'Yes' }, { partyRef: 'party-1', txnId: 'other-txn' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('forbidden');
  });
});
