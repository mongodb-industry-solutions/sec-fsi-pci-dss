/**
 * Unit tests: cardTransaction.service (FR-v1-03)
 * Source: backend/src/modules/transaction/services/cardTransaction.service.ts
 *
 * createTransaction now writes through a role-aware QE client (getDbForRole) and
 * delegates fraud-case creation to fraudDiagnosis.service. Both are mocked so the
 * test exercises the transaction/fraud-trigger logic in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'mock-id' });
  const findOne = vi.fn().mockResolvedValue(null);
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const qeDb = { collection: vi.fn(() => ({ insertOne, findOne, updateOne })) };
  return {
    insertOne,
    findOne,
    updateOne,
    qeDb,
    getDbForRole: vi.fn().mockResolvedValue(qeDb),
    validateToken: vi.fn().mockReturnValue({ valid: false }),
    createFraudCase: vi.fn().mockResolvedValue({ fraudDiagnosisInstanceReference: 'fraud-uuid' }),
  };
});

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
}));
vi.mock('../../../../backend/src/vendors/security/escalationTokens', () => ({
  validateToken: h.validateToken,
}));
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({
  createFraudCase: h.createFraudCase,
}));
// createTransaction now also: validates the card-on-file, dispatches card_issuer validation, emits
// process/compliance events, upserts the card registry, and fires the merchant callback. Mock these
// so the test exercises the transaction + fraud-trigger logic in isolation.
vi.mock('../../../../backend/src/modules/customer/services/paymentCard.service', () => ({
  getCardByToken: vi.fn().mockResolvedValue(null),       // no card-on-file → passes through
  upsertCardByToken: vi.fn().mockResolvedValue({ paymentCardInstanceReference: 'card-x', created: false }),
}));
vi.mock('../../../../backend/src/modules/provider/services/integrationDispatch.service', () => ({
  dispatchProvider: vi.fn().mockResolvedValue({ provider: 'internal', status: 'received' }),
}));
vi.mock('../../../../backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: vi.fn().mockResolvedValue(undefined),
  emitComplianceEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../backend/src/modules/gateway/services/merchantCallback.service', () => ({
  sendMerchantPaymentCallback: vi.fn().mockResolvedValue(undefined),
}));

import { createTransaction, getTransactionById, getTransactionsByCardToken } from '../../../../backend/src/modules/transaction/services/cardTransaction.service';
import { dispatchProvider } from '../../../../backend/src/modules/provider/services/integrationDispatch.service';
import { EventBusInProcess } from '../../../../backend/src/vendors/eventbus/EventBusInProcess';
import { setEventBus, getEventBus } from '../../../../backend/src/vendors/eventbus';
import { PaymentAuthorizationSaga } from '../../../../backend/src/modules/transaction/services/paymentAuthorization.saga';
import { ProviderGroups } from '../../../../backend/src/providers/_groups/providerGroups';

// createTransaction uses the passed db only for resolveCustomerAgreement (a local helper that does
// findOne on the customer/party collections); everything else is mocked. A findOne→null db makes
// it fall back to the raw account reference, which is all these tests need.
function txDb() {
  return { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) } as any;
}

// Local mock DB used only by getTransactionsByCardToken (which queries the passed db directly).
function makeDb(overrides?: { findResults?: unknown[] }) {
  const toArrayMock = vi.fn().mockResolvedValue(overrides?.findResults ?? []);
  const sortMock = vi.fn().mockReturnValue({ toArray: toArrayMock });
  return {
    collection: vi.fn().mockReturnValue({
      find: vi.fn().mockReturnValue({ sort: sortMock }),
    }),
  } as any;
}

beforeEach(() => {
  h.insertOne.mockClear();
  h.findOne.mockReset().mockResolvedValue(null);
  h.updateOne.mockClear();
  h.createFraudCase.mockClear();
  h.getDbForRole.mockClear();
  process.env.FRAUD_AMOUNT_THRESHOLD = '500';
  process.env.RISK_MCC_LIST = '5812,6011,7995';
  // dev.v8 F3: authorization is event-driven. A fresh in-process bus + the saga drive it; the issuer
  // dispatch is mocked (no decline) so the journey reaches `authorized`, and createTransaction (the
  // sync wrapper) resolves to the final outcome.
  setEventBus(new EventBusInProcess());
  new ProviderGroups(txDb(), getEventBus()).register();
  new PaymentAuthorizationSaga(txDb(), getEventBus()).register();
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
  cardTransactionType: 'purchase' as const,
  cardTransactionDescription: 'SAFE STORE',
  gatewayPayload: { source: 'test' },
};

describe('createTransaction', () => {
  it('inserts one transaction document through the QE write client', async () => {
    await createTransaction(txDb(), baseInput);
    expect(h.insertOne).toHaveBeenCalledTimes(1);
  });

  it('returns UUID-format transaction reference', async () => {
    const result = await createTransaction(txDb(), baseInput);
    expect(result.cardTransactionInstanceReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('returns cardTransactionStatus = authorized', async () => {
    const result = await createTransaction(txDb(), baseInput);
    expect(result.cardTransactionStatus).toBe('authorized');
  });

  it('fraudCaseCreated is false for amount ≤ threshold + safe MCC', async () => {
    const result = await createTransaction(txDb(), { ...baseInput, amount: 100, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(false);
    expect(result.fraudDiagnosisInstanceReference).toBeUndefined();
    expect(h.createFraudCase).not.toHaveBeenCalled();
  });

  it('fraudCaseCreated is false when amount equals threshold exactly', async () => {
    const result = await createTransaction(txDb(), { ...baseInput, amount: 500, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(false);
  });

  it('fraudCaseCreated is true when amount > threshold', async () => {
    const result = await createTransaction(txDb(), { ...baseInput, amount: 850, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(true);
    expect(result.fraudDiagnosisInstanceReference).toBeTruthy();
    expect(h.createFraudCase).toHaveBeenCalledTimes(1);
  });

  it('fraudCaseCreated is true when MCC is in RISK_MCC_LIST (below threshold)', async () => {
    const result = await createTransaction(txDb(), { ...baseInput, amount: 50, cardTransactionMerchantCategoryCode: '7995' });
    expect(result.fraudCaseCreated).toBe(true);
  });

  it('respects custom FRAUD_AMOUNT_THRESHOLD env var', async () => {
    process.env.FRAUD_AMOUNT_THRESHOLD = '1000';
    const result = await createTransaction(txDb(), { ...baseInput, amount: 850, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(false);
  });

  it('respects custom RISK_MCC_LIST env var', async () => {
    process.env.RISK_MCC_LIST = '1234';
    const result = await createTransaction(txDb(), { ...baseInput, amount: 50, cardTransactionMerchantCategoryCode: '7995' });
    expect(result.fraudCaseCreated).toBe(false);
  });

  // P13.3 (D2): when the FDS gate returns a verdict, the fraud case is driven by it — the case score
  // and risk indicators are the FDS verdict, not the amount-count heuristic.
  it('opens the fraud case from the FDS verdict (score + rulesFired), not the amount heuristic', async () => {
    vi.mocked(dispatchProvider).mockImplementation(async (_db: any, group: string) => {
      if (group === 'fraud_detection') {
        return { provider: 'internal', status: 'received', responseBody: { riskScore: 75, recommendation: 'review', fraudFlag: true, rulesFired: ['HIGH_VALUE_TXN', 'RISKY_MCC'] } } as any;
      }
      return { provider: 'internal', status: 'received' } as any;
    });
    // A LOW amount that the PSP amount rule would NOT flag — proving the verdict (not the amount) decides.
    const result = await createTransaction(txDb(), { ...baseInput, amount: 50, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(true);
    expect(h.createFraudCase).toHaveBeenCalledTimes(1);
    const call = h.createFraudCase.mock.calls[0];
    expect(call[3]).toEqual(['HIGH_VALUE_TXN', 'RISKY_MCC']); // riskIndicators = rulesFired
    expect(call[4]).toBe('high');                              // severity from score 75
    expect(call[6]).toBe(75);                                  // fraudScore = FDS riskScore
    vi.mocked(dispatchProvider).mockResolvedValue({ provider: 'internal', status: 'received' } as any);
  });

  it('does NOT open a case when the FDS verdict is approve, even above the amount heuristic', async () => {
    vi.mocked(dispatchProvider).mockImplementation(async (_db: any, group: string) => {
      if (group === 'fraud_detection') {
        return { provider: 'internal', status: 'received', responseBody: { riskScore: 10, recommendation: 'approve', fraudFlag: false, rulesFired: [] } } as any;
      }
      return { provider: 'internal', status: 'received' } as any;
    });
    const result = await createTransaction(txDb(), { ...baseInput, amount: 850, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(false);
    expect(h.createFraudCase).not.toHaveBeenCalled();
    vi.mocked(dispatchProvider).mockResolvedValue({ provider: 'internal', status: 'received' } as any);
  });

  // U-01: cardTransactionDescription accepted and function returns successfully (BIAN SD-254)
  it('U-01: accepts cardTransactionDescription and returns authorized status', async () => {
    const result = await createTransaction(txDb(), { ...baseInput, cardTransactionDescription: 'AMAZON.COM*ELECTRONI' });
    expect(result.cardTransactionStatus).toBe('authorized');
    expect(result.cardTransactionInstanceReference).toBeTruthy();
  });

  // U-02: cardTransactionType accepted without error
  it('U-02: accepts all valid cardTransactionType values', async () => {
    const types = ['purchase', 'cash_advance', 'balance_transfer', 'refund', 'fee', 'adjustment'] as const;
    for (const txType of types) {
      const result = await createTransaction(txDb(), { ...baseInput, cardTransactionType: txType });
      expect(result.cardTransactionStatus).toBe('authorized');
    }
  });

  // U-03: optional cardTransactionNarrative accepted when provided
  it('U-03: accepts optional cardTransactionNarrative when provided', async () => {
    const result = await createTransaction(txDb(), {
      ...baseInput,
      cardTransactionNarrative: 'PURCHASE at Safe Store - ref AB12CD34',
    });
    expect(result.cardTransactionStatus).toBe('authorized');
  });

  // U-04: createTransaction works when cardTransactionNarrative is omitted
  it('U-04: completes successfully when cardTransactionNarrative is absent', async () => {
    const inputWithoutNarrative = { ...baseInput };
    expect('cardTransactionNarrative' in inputWithoutNarrative).toBe(false);
    const result = await createTransaction(txDb(), inputWithoutNarrative);
    expect(result.cardTransactionStatus).toBe('authorized');
  });
});

describe('getTransactionById', () => {
  it('returns the projected transaction with no decrypted sensitive block for L1', async () => {
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
      cardTransactionAccountReference: 'ACC-001',
    };
    h.findOne.mockResolvedValueOnce(doc);
    const result = await getTransactionById({} as any, 'txn-001');
    expect(result).not.toBeNull();
    expect(result!.cardTransactionInstanceReference).toBe('txn-001');
    // rawGatewayPayload absent → L1 client sees no auto-decrypted sensitive payload
    expect((result as Record<string, unknown>).sensitive).toBeUndefined();
  });

  it('returns null when not found', async () => {
    h.findOne.mockResolvedValueOnce(null);
    expect(await getTransactionById({} as any, 'nonexistent')).toBeNull();
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
