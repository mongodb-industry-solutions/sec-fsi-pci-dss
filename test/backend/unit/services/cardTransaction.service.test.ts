/**
 * Unit tests: cardTransaction.service (FR-v1-03)
 * Source: backend/src/services/cardTransaction.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTransaction, getTransactionById, getTransactionsByCardToken } from '../../../../backend/src/services/cardTransaction.service';

function makeDb(overrides?: { findOneResult?: unknown; findResults?: unknown[] }) {
  const insertOneMock = vi.fn().mockResolvedValue({ insertedId: 'mock-id' });
  const findOneMock = vi.fn().mockResolvedValue(overrides?.findOneResult ?? null);
  const sortMock = vi.fn().mockReturnThis();
  const toArrayMock = vi.fn().mockResolvedValue(overrides?.findResults ?? []);
  return {
    collection: vi.fn().mockReturnValue({
      insertOne: insertOneMock,
      findOne: findOneMock,
      find: vi.fn().mockReturnValue({ sort: sortMock, toArray: toArrayMock }),
    }),
    _insertOne: insertOneMock,
    _findOne: findOneMock,
  } as any;
}

beforeEach(() => {
  process.env.FRAUD_AMOUNT_THRESHOLD = '500';
  process.env.RISK_MCC_LIST = '5812,6011,7995';
});

const baseInput = {
  cardToken: 'tok_abc123',
  accountReference: 'ACC-001',
  amount: 100,
  currency: 'USD',
  cardTransactionMerchantName: 'Safe Store',
  cardTransactionMerchantCategoryCode: '5411',
  cardTransactionChannel: 'online',
  cardTransactionMaskedPanDisplay: '****-****-****-1234',
  gatewayPayload: { source: 'test' },
};

describe('createTransaction', () => {
  it('inserts into both QE collections (control + sensitive)', async () => {
    const db = makeDb();
    await createTransaction(db, baseInput);
    expect(db.collection().insertOne).toHaveBeenCalledTimes(2);
  });

  it('returns UUID-format transaction reference', async () => {
    const db = makeDb();
    const result = await createTransaction(db, baseInput);
    expect(result.cardTransactionInstanceReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('returns cardTransactionStatus = authorized', async () => {
    const db = makeDb();
    const result = await createTransaction(db, baseInput);
    expect(result.cardTransactionStatus).toBe('authorized');
  });

  it('fraudCaseCreated is false for amount ≤ threshold + safe MCC', async () => {
    const db = makeDb();
    const result = await createTransaction(db, { ...baseInput, amount: 100, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(false);
    expect(result.fraudDiagnosisInstanceReference).toBeUndefined();
  });

  it('fraudCaseCreated is false when amount equals threshold exactly', async () => {
    const db = makeDb();
    const result = await createTransaction(db, { ...baseInput, amount: 500, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(false);
  });

  it('fraudCaseCreated is true when amount > threshold', async () => {
    const db = makeDb();
    const result = await createTransaction(db, { ...baseInput, amount: 850, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(true);
    expect(result.fraudDiagnosisInstanceReference).toBeTruthy();
  });

  it('fraudCaseCreated is true when MCC is in RISK_MCC_LIST (below threshold)', async () => {
    const db = makeDb();
    const result = await createTransaction(db, { ...baseInput, amount: 50, cardTransactionMerchantCategoryCode: '7995' });
    expect(result.fraudCaseCreated).toBe(true);
  });

  it('respects custom FRAUD_AMOUNT_THRESHOLD env var', async () => {
    process.env.FRAUD_AMOUNT_THRESHOLD = '1000';
    const db = makeDb();
    const result = await createTransaction(db, { ...baseInput, amount: 850, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(false);
  });

  it('respects custom RISK_MCC_LIST env var', async () => {
    process.env.RISK_MCC_LIST = '1234';
    const db = makeDb();
    const result = await createTransaction(db, { ...baseInput, amount: 50, cardTransactionMerchantCategoryCode: '7995' });
    expect(result.fraudCaseCreated).toBe(false);
  });
});

describe('getTransactionById', () => {
  it('returns projected transaction (no accountReference — Level 1 response)', async () => {
    const doc = {
      cardTransactionInstanceReference: 'txn-001',
      cardTransactionAmount: { amount: 100, currency: 'USD' },
      cardTransactionDateTime: new Date(),
      cardTransactionStatus: 'authorized',
      cardTransactionMerchantName: 'Safe Store',
      cardTransactionMerchantCategoryCode: '5411',
      cardTransactionMaskedPanDisplay: '****-****-****-1234',
      cardTransactionChannel: 'online',
      paymentCardReference: 'tok_abc',
      cardTransactionAccountReference: 'ACC-SECRET',
    };
    const db = { collection: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(doc) }) } as any;
    const result = await getTransactionById(db, 'txn-001');
    expect(result).not.toBeNull();
    expect(result!.cardTransactionInstanceReference).toBe('txn-001');
    expect((result as Record<string, unknown>).cardTransactionAccountReference).toBeUndefined();
  });

  it('returns null when not found', async () => {
    const db = { collection: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) }) } as any;
    expect(await getTransactionById(db, 'nonexistent')).toBeNull();
  });
});

describe('getTransactionsByCardToken', () => {
  it('returns all transactions for a card token with count', async () => {
    const docs = [{ cardTransactionInstanceReference: 'txn-001' }, { cardTransactionInstanceReference: 'txn-002' }];
    const db = makeDb({ findResults: docs });
    const result = await getTransactionsByCardToken(db, 'tok_abc');
    expect(result.results).toHaveLength(2);
    expect(result.count).toBe(2);
  });

  it('returns empty results for unknown token', async () => {
    const db = makeDb({ findResults: [] });
    const result = await getTransactionsByCardToken(db, 'tok_unknown');
    expect(result.results).toHaveLength(0);
    expect(result.count).toBe(0);
  });
});
