/**
 * Unit tests: an account's movements include its cards' payments.
 *
 * The card lookup matched the cards' INSTANCE references against `paymentCardReference`, which stores
 * the card TOKEN (the PAN surrogate). The two never matched, so a card payment was recorded, moved the
 * balance, showed in payment history and in the card view, and yet never appeared among the funding
 * account's movements. That inconsistency is exactly what made an investigator doubt the data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import { listAccountMovements } from '../../../../../psp/backend/src/modules/gateway/services/accountMovements.service';

const ACCOUNT = 'pau-1';
const CARD_UUID = 'card-uuid-1';
const CARD_TOKEN = 'pm_token_1';

const card = { paymentCardInstanceReference: CARD_UUID, paymentCardReference: CARD_TOKEN, fundingPayoutAccountInstanceReference: ACCOUNT };
const cardTxn = {
  cardTransactionInstanceReference: 'txn-1',
  paymentCardReference: CARD_TOKEN,
  cardTransactionAmount: { amount: 24.5, currency: 'GBP' },
  cardTransactionDateTime: new Date('2026-08-13T17:17:00Z'),
  cardTransactionStatus: 'settled',
  cardTransactionDescription: 'Espresso Beans 1kg',
  cardTransactionMerchantName: 'Espresso Works Ltd',
};

// Records the filter each collection was queried with, so the test can assert WHICH key was used.
function fakeDb(txns: unknown[]) {
  const seen: Record<string, unknown> = {};
  const db = {
    collection: (name: string) => ({
      find: (filter: unknown) => {
        seen[name] = filter;
        const rows = name === 'paymentCardManagement' ? [card]
          : name === 'cardTransactionLog' ? txns
          : [];
        return { toArray: async () => rows, sort: () => ({ toArray: async () => rows }) };
      },
      findOne: vi.fn(async () => null),
      countDocuments: vi.fn(async () => 0),
    }),
  } as unknown as Db;
  return { db, seen };
}

describe('card payments appear among an account movements', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('matches the cards by token, not by instance reference', async () => {
    const { db, seen } = fakeDb([cardTxn]);
    await listAccountMovements(db, ACCOUNT, { page: 1, limit: 50 });
    expect(seen['cardTransactionLog']).toEqual({ paymentCardReference: { $in: [CARD_TOKEN] } });
    // The old behaviour queried the UUIDs, which never match a token.
    expect(JSON.stringify(seen['cardTransactionLog'])).not.toContain(CARD_UUID);
  });

  it('returns the card payment as a debit movement', async () => {
    const { db } = fakeDb([cardTxn]);
    const out = await listAccountMovements(db, ACCOUNT, { page: 1, limit: 50 });
    const hit = out.movements.find((m) => m.movementId === 'txn-1');
    expect(hit).toMatchObject({ movementType: 'card_debit', direction: 'debit', amount: 24.5, currency: 'GBP' });
  });

  it('does not invent movements when the account has no card activity', async () => {
    const { db } = fakeDb([]);
    const out = await listAccountMovements(db, ACCOUNT, { page: 1, limit: 50 });
    expect(out.movements.filter((m) => m.movementType === 'card_debit')).toEqual([]);
  });
});
