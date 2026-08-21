/**
 * Unit tests: paymentCard.service (FR-v1-03.2)
 * Source: backend/src/modules/customer/services/paymentCard.service.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { createCard, getCardsByCustomer } from '../../../../../psp/backend/src/modules/customer/services/paymentCard.service';

function makeDb(overrides?: { findResults?: unknown[] }) {
  const insertOneMock = vi.fn().mockResolvedValue({ insertedId: 'mock' });
  return {
    collection: vi.fn().mockReturnValue({
      insertOne: insertOneMock,
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(overrides?.findResults ?? []),
      }),
    }),
    _insertOne: insertOneMock,
  } as any;
}

const baseInput = {
  customerAgreementInstanceReference: 'cust-001',
  cardToken: 'pm_abcdef1234567890',
  paymentCardExpirationDate: '12/28',
  paymentCardMaskedPanDisplay: '****-****-****-4242',
  paymentCardNetwork: 'VISA' as const,
  paymentCardIsPreferred: false,
};

describe('createCard', () => {
  it('returns a UUID paymentCardInstanceReference', async () => {
    const result = await createCard(makeDb(), baseInput);
    expect(result.paymentCardInstanceReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('returns paymentCardStatus = active', async () => {
    const result = await createCard(makeDb(), baseInput);
    expect(result.paymentCardStatus).toBe('active');
  });

  it('inserts exactly one document', async () => {
    const db = makeDb();
    await createCard(db, baseInput);
    expect(db._insertOne).toHaveBeenCalledTimes(1);
  });

  it('stored document uses card token as paymentCardReference (ADR-003: token ≠ CHD)', async () => {
    const db = makeDb();
    await createCard(db, baseInput);
    const doc = db._insertOne.mock.calls[0][0];
    expect(doc.paymentCardReference).toBe('pm_abcdef1234567890');
    expect(doc.cardNumber).toBeUndefined();
  });

  it.each(['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'] as const)(
    'accepts network %s',
    async (network) => {
      const result = await createCard(makeDb(), { ...baseInput, paymentCardNetwork: network });
      expect(result.paymentCardStatus).toBe('active');
    }
  );
});

describe('getCardsByCustomer', () => {
  it('returns projected card list', async () => {
    const cards = [
      { paymentCardInstanceReference: 'card-001', paymentCardMaskedPanDisplay: '****-4242', paymentCardNetwork: 'VISA', paymentCardStatus: 'active', paymentCardIsPreferred: true },
      { paymentCardInstanceReference: 'card-002', paymentCardMaskedPanDisplay: '****-1111', paymentCardNetwork: 'MC', paymentCardStatus: 'active', paymentCardIsPreferred: false },
    ];
    const result = await getCardsByCustomer(makeDb({ findResults: cards }), 'cust-001');
    expect(result.results).toHaveLength(2);
    expect(result.results[0].paymentCardMaskedPanDisplay).toBe('****-4242');
  });

  it('returns empty list when no cards found', async () => {
    const result = await getCardsByCustomer(makeDb({ findResults: [] }), 'cust-unknown');
    expect(result.results).toHaveLength(0);
  });
});
