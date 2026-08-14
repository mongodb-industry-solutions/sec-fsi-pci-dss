/**
 * Unit tests (v36 P2, ADR-063): the shared movement read-model.
 * One normalization + merge + RTP de-dup for card, transfer and RTP movements, replacing the three
 * copies of the rule (merchant channel, customer history, merchant app).
 *
 * Includes the leafy-wallet field contract: that external consumer reads the row field names
 * directly (tmp/leafy-wallet/frontend/src/lib/psp/PspClient.js), so a rename breaks it silently.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Db } from 'mongodb';
import {
  normalizeExecutionRow, normalizeRequestRow, normalizeCardRow,
  dedupeRtpExecutions, sortAndPage, listNonCardMovements, getMovementByRef,
  type MovementRow,
} from '../../../../backend/src/modules/gateway/services/paymentMovement.service';
import type { PaymentExecutionProcedure } from '../../../../backend/src/modules/gateway/models/paymentExecution.model';
import type { PaymentRequestProcedure } from '../../../../backend/src/modules/gateway/models/paymentRequest.model';

const PARTY = 'party-1';
const OTHER = 'party-2';

const execution = (over: Partial<PaymentExecutionProcedure> = {}): PaymentExecutionProcedure => ({
  paymentExecutionInstanceReference: 'exec-1',
  paymentOrderInstanceReference: 'exec-1',
  beneficiaryType: 'user',
  initiatorPartyReference: PARTY,
  beneficiaryPartyReference: OTHER,
  grossAmount: 150, netAmount: 150, feeAmount: 0, currency: 'EUR',
  paymentExecutionRail: 'sepa',
  paymentExecutionStatus: 'completed',
  paymentExecutionRemittanceInformation: 'Dinner split',
  initiatedAt: new Date('2026-07-01T10:00:00Z'),
  completedAt: new Date('2026-07-01T11:00:00Z'),
  resolutionLog: [],
  bianServiceDomain: 'Payment Execution',
  bianControlRecordType: 'PaymentExecutionProcedure',
  recordCreatedDateTime: new Date('2026-07-01T10:00:00Z'),
  recordUpdatedDateTime: new Date('2026-07-01T10:00:00Z'),
  schemaVersion: 1,
  ...over,
} as PaymentExecutionProcedure);

const request = (over: Partial<PaymentRequestProcedure> = {}): PaymentRequestProcedure => ({
  paymentRequestInstanceReference: 'req-1',
  amount: 90, currency: 'EUR', status: 'accepted',
  payeeName: 'Ana Ruiz', purpose: 'Shared rent',
  requesterPartyReference: OTHER, payerPartyReference: PARTY,
  recordCreatedDateTime: new Date('2026-07-02T09:00:00Z'),
  ...over,
} as PaymentRequestProcedure);

const cardTxn = (over: Record<string, unknown> = {}) => ({
  cardTransactionInstanceReference: 'txn-1',
  cardTransactionAmount: { amount: 30, currency: 'EUR' },
  cardTransactionStatus: 'settled',
  cardTransactionMerchantName: 'Coffee Ltd',
  cardTransactionMaskedPanDisplay: '****-****-****-4242',
  cardTransactionDescription: 'COFFEE LTD',
  cardTransactionDateTime: new Date('2026-07-03T08:00:00Z'),
  ...over,
});

describe('the leafy-wallet row contract', () => {
  it('keeps every field name that external consumer reads', () => {
    const row = normalizeExecutionRow(execution(), PARTY);
    for (const key of [
      'paymentExecutionInstanceReference', 'direction', 'grossAmount', 'currency',
      'paymentExecutionStatus', 'concept', 'initiatedAt', 'completedAt',
    ]) expect(row, key).toHaveProperty(key);
    // Dates travel as ISO strings, which is what the consumer parses.
    expect(typeof row.initiatedAt).toBe('string');
    expect(row.concept).toBe('Dinner split');
  });

  it('falls back to the routing note when there is no remittance information', () => {
    const row = normalizeExecutionRow(execution({ paymentExecutionRemittanceInformation: undefined, routingNote: 'Bank transfer' }), PARTY);
    expect(row.concept).toBe('Bank transfer');
  });
});

describe('direction is relative to the viewer', () => {
  it('is sent for the initiator and received for the beneficiary', () => {
    expect(normalizeExecutionRow(execution(), PARTY).direction).toBe('sent');
    expect(normalizeExecutionRow(execution(), OTHER).direction).toBe('received');
  });

  it('defaults to sent with no viewer (staff view)', () => {
    expect(normalizeExecutionRow(execution()).direction).toBe('sent');
  });
});

describe('a held movement is flagged, not hidden', () => {
  it('marks an execution parked by the risk gate', () => {
    const held = execution({ paymentExecutionStatus: 'pending', resolutionLog: [{ stepName: 'risk.hold', stepOutcome: 'fallback', stepDateTime: new Date() }] });
    expect(normalizeExecutionRow(held, PARTY).heldForReview).toBe(true);
  });

  it('does not mark a pending execution with no hold step', () => {
    const pending = execution({ paymentExecutionStatus: 'pending', resolutionLog: [] });
    expect(normalizeExecutionRow(pending, PARTY).heldForReview).toBe(false);
  });

  it('marks an accepted RTP and an authorized card payment', () => {
    expect(normalizeRequestRow(request()).heldForReview).toBe(true);
    expect(normalizeCardRow(cardTxn({ cardTransactionStatus: 'authorized' })).heldForReview).toBe(true);
    expect(normalizeCardRow(cardTxn()).heldForReview).toBe(false);
  });
});

describe('the RTP payee name is only carried when allowed', () => {
  it('withholds it by default (QE:none, L2 only)', () => {
    expect(normalizeRequestRow(request()).beneficiaryName).toBeNull();
  });

  it('carries it when the caller allows it', () => {
    expect(normalizeRequestRow(request(), { includePayeeName: true }).beneficiaryName).toBe('Ana Ruiz');
  });
});

describe('RTP de-dup keeps one row per movement', () => {
  const rows = (): MovementRow[] => [
    normalizeRequestRow(request({ linkedPaymentExecutionReference: 'exec-1' })),
    normalizeExecutionRow(execution(), PARTY),
    normalizeExecutionRow(execution({ paymentExecutionInstanceReference: 'exec-9' }), PARTY),
  ];

  it('hides the execution linked to an RTP and keeps the rest', () => {
    const out = dedupeRtpExecutions(rows());
    expect(out.map((r) => r.paymentExecutionInstanceReference)).toEqual(['req-1', 'exec-9']);
  });

  it('is a no-op when no RTP links an execution', () => {
    const plain = [normalizeExecutionRow(execution(), PARTY), normalizeRequestRow(request())];
    expect(dedupeRtpExecutions(plain)).toHaveLength(2);
  });
});

describe('sorting and pagination', () => {
  const mixed = () => [
    normalizeCardRow(cardTxn()),                                   // 07-03
    normalizeExecutionRow(execution(), PARTY),                     // 07-01 (completedAt 11:00)
    normalizeRequestRow(request()),                                // 07-02
  ];

  it('sorts newest first and strips the internal sort key', () => {
    const { results, total } = sortAndPage(mixed(), 1, 10);
    expect(total).toBe(3);
    expect(results.map((r) => r.kind)).toEqual(['card', 'rtp', 'transfer']);
    expect(results[0]).not.toHaveProperty('_sortAt');
  });

  it('pages over the merged set', () => {
    const p2 = sortAndPage(mixed(), 2, 2);
    expect(p2.total).toBe(3);
    expect(p2.results).toHaveLength(1);
    expect(p2.results[0].kind).toBe('transfer');
  });
});

// Fake Db: one cursor per collection, so the filters can be inspected.
function fakeDb(docs: { executions?: unknown[]; requests?: unknown[]; card?: unknown }) {
  const seen: Record<string, unknown> = {};
  const cursor = (rows: unknown[]) => ({
    sort: () => ({ limit: () => ({ toArray: async () => rows }) }),
  });
  const db = {
    collection: (name: string) => ({
      find: (filter: unknown) => { seen[name] = filter; return cursor(name === 'paymentExecutionProcedure' ? (docs.executions ?? []) : (docs.requests ?? [])); },
      findOne: vi.fn(async () => (name === 'cardTransactionLog' ? docs.card ?? null : null)),
    }),
  } as unknown as Db;
  return { db, seen };
}

describe('listNonCardMovements', () => {
  it('scopes to the party on both sides of the movement', async () => {
    const { db, seen } = fakeDb({ executions: [execution()], requests: [request()] });
    const rows = await listNonCardMovements(db, { partyRef: PARTY });
    expect(rows).toHaveLength(2);
    expect(seen['paymentExecutionProcedure']).toEqual({
      $or: [{ initiatorPartyReference: PARTY }, { beneficiaryPartyReference: PARTY }],
    });
    expect(seen['paymentRequestProcedure']).toEqual({
      $or: [{ payerPartyReference: PARTY }, { requesterPartyReference: PARTY }],
    });
  });

  // Merchant isolation: RTP has no merchant attribution, and the merchant clients fetch RTP
  // themselves, so including it here would break isolation AND duplicate their rows.
  it('returns no RTP rows for a merchant-scoped query', async () => {
    const { db, seen } = fakeDb({ executions: [execution()], requests: [request()] });
    const rows = await listNonCardMovements(db, { partyRef: PARTY, merchantRef: 'mer-1' });
    expect(rows.every((r) => r.kind === 'transfer')).toBe(true);
    expect(seen['paymentExecutionProcedure']).toMatchObject({ merchantAgreementReference: 'mer-1' });
  });

  it('applies the RTP de-dup across the merged sources', async () => {
    const { db } = fakeDb({
      executions: [execution({ paymentExecutionInstanceReference: 'exec-1' })],
      requests: [request({ linkedPaymentExecutionReference: 'exec-1' })],
    });
    const rows = await listNonCardMovements(db, { partyRef: PARTY });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('rtp');
  });
});

describe('getMovementByRef resolves any kind', () => {
  it('finds an execution', async () => {
    const db = { collection: () => ({ findOne: async () => execution() }) } as unknown as Db;
    expect((await getMovementByRef(db, 'exec-1'))?.kind).toBe('transfer');
  });

  it('falls through to the card transaction and normalizes it', async () => {
    const db = {
      collection: (name: string) => ({
        findOne: async () => (name === 'cardTransactionLog' ? cardTxn() : null),
      }),
    } as unknown as Db;
    const row = await getMovementByRef(db, 'txn-1');
    expect(row).toMatchObject({ kind: 'card', paymentExecutionRail: 'card', grossAmount: 30, currency: 'EUR' });
  });

  it('returns null for an unknown reference', async () => {
    const db = { collection: () => ({ findOne: async () => null }) } as unknown as Db;
    expect(await getMovementByRef(db, 'nope')).toBeNull();
  });
});

/**
 * Contract guard for the one external consumer (leafy-wallet). It reads the row fields directly, so
 * this test fails loudly if a rename ever reaches the merged history it consumes through the
 * merchant OAuth channel of GET /api/v1/transactions.
 */
describe('external consumer contract (leafy-wallet)', () => {
  // Mirrors tmp/leafy-wallet/frontend/src/lib/psp/PspClient.js normalizeTransaction().
  function leafyNormalize(t: Record<string, unknown>) {
    const gross = (t.grossAmount ?? (t.paymentExecutionAmount as { amount?: number } | undefined)?.amount ?? 0) as number;
    return {
      reference: t.paymentExecutionInstanceReference ?? t.transferReference,
      counterpartyReference: t.beneficiaryArrangementReference ?? t.counterpartyArrangementReference ?? null,
      direction: t.direction ?? 'sent',
      value: typeof gross === 'number' ? gross : 0,
      currency: t.currency ?? 'EUR',
      status: t.paymentExecutionStatus ?? t.status ?? 'pending',
      note: t.concept ?? t.paymentExecutionRemittanceInformation ?? t.description ?? '',
      createdAt: t.completedAt ?? t.initiatedAt ?? t.scheduledAt ?? t.recordCreatedDateTime ?? null,
    };
  }

  it('every field the consumer reads resolves on a transfer row', () => {
    const row = normalizeExecutionRow(execution({ beneficiaryArrangementReference: 'cab-1' }), PARTY) as unknown as Record<string, unknown>;
    expect(leafyNormalize(row)).toEqual({
      reference: 'exec-1',
      counterpartyReference: 'cab-1',
      direction: 'sent',
      value: 150,
      currency: 'EUR',
      status: 'completed',
      note: 'Dinner split',
      createdAt: '2026-07-01T11:00:00.000Z',
    });
  });

  it('nothing the consumer reads is undefined on a card row either', () => {
    const row = normalizeCardRow(cardTxn()) as unknown as Record<string, unknown>;
    const out = leafyNormalize(row);
    for (const [k, v] of Object.entries(out)) expect(v, k).not.toBeUndefined();
    expect(out.reference).toBe('txn-1');
  });

  it('the paged envelope keeps its field names', () => {
    const paged = sortAndPage([normalizeExecutionRow(execution(), PARTY)], 1, 20);
    expect(Object.keys(paged).sort()).toEqual(['results', 'total']);
  });
});
