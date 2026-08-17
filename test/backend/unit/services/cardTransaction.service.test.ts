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
    getCardByToken: vi.fn(async () => null as unknown),
  createFraudCase: vi.fn().mockResolvedValue({ fraudDiagnosisInstanceReference: 'fraud-uuid' }),
  };
});

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
  // v32 C6: the sensitive-tier / encryption-write clients are the same double here.
  getSensitiveTierDb: h.getDbForRole,
  getEncryptionWriteDb: h.getDbForRole,
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
  getCardByToken: h.getCardByToken,                     // default: no card-on-file → passes through
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

import { createTransaction, getTransactionById, getAllTransactions } from '../../../../backend/src/modules/transaction/services/cardTransaction.service';
import { dispatchProvider } from '../../../../backend/src/modules/provider/services/integrationDispatch.service';
import { EventBusInProcess } from '@leafypay/eventbus';
import { setEventBus, getEventBus } from '../../../../backend/src/vendors/eventbus';
import { PaymentAuthorizationSaga } from '../../../../backend/src/modules/transaction/services/paymentAuthorization.saga';
import { ProviderGroups } from '../../../../backend/src/providers/groups/providerGroups';

// createTransaction uses the passed db only for resolveCustomerAgreement (a local helper that does
// findOne on the customer/party collections); everything else is mocked. A findOne→null db makes
// it fall back to the raw account reference, which is all these tests need.
function txDb() {
  return { collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) } as any;
}

// Local mock DB used by the collection queries, which run against the passed db directly.
// `_find` exposes the spy so a test can assert WHICH field a filter queried.
function makeDb(overrides?: { findResults?: unknown[] }) {
  const rows = overrides?.findResults ?? [];
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
  const find = vi.fn().mockReturnValue(cursor);
  const db: any = {
    collection: vi.fn().mockReturnValue({
      find,
      countDocuments: vi.fn().mockResolvedValue(rows.length),
    }),
  };
  db._find = find;
  return db;
}

beforeEach(() => {
  h.insertOne.mockClear();
  h.findOne.mockReset().mockResolvedValue(null);
  h.updateOne.mockClear();
  h.createFraudCase.mockClear();
  h.getDbForRole.mockClear();
  process.env.PSP_FRAUD_AMOUNT_THRESHOLD = '500';
  process.env.PSP_RISK_MCC_LIST = '5812,6011,7995';
  // dev.v8 F3: authorization is event-driven. A fresh in-process bus + the saga drive it; the issuer
  // dispatch is mocked (no decline) so the journey reaches `authorized`, and createTransaction (the
  // sync wrapper) resolves to the final outcome.
  setEventBus(new EventBusInProcess());
  new ProviderGroups(txDb(), getEventBus()).register();
  new PaymentAuthorizationSaga(txDb(), getEventBus()).register();
});

const baseInput = {
  cardToken: 'pm_abc123',
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

  it('fraudCaseCreated is true when MCC is in PSP_RISK_MCC_LIST (below threshold)', async () => {
    const result = await createTransaction(txDb(), { ...baseInput, amount: 50, cardTransactionMerchantCategoryCode: '7995' });
    expect(result.fraudCaseCreated).toBe(true);
  });

  it('respects custom PSP_FRAUD_AMOUNT_THRESHOLD env var', async () => {
    process.env.PSP_FRAUD_AMOUNT_THRESHOLD = '1000';
    const result = await createTransaction(txDb(), { ...baseInput, amount: 850, cardTransactionMerchantCategoryCode: '5411' });
    expect(result.fraudCaseCreated).toBe(false);
  });

  it('respects custom PSP_RISK_MCC_LIST env var', async () => {
    process.env.PSP_RISK_MCC_LIST = '1234';
    const result = await createTransaction(txDb(), { ...baseInput, amount: 50, cardTransactionMerchantCategoryCode: '7995' });
    expect(result.fraudCaseCreated).toBe(false);
  });

  // P13.3 (D2): when the FDS gate returns a verdict, the fraud case is driven by it, the case score
  // and risk indicators are the FDS verdict, not the amount-count heuristic.
  it('opens the fraud case from the FDS verdict (score + rulesFired), not the amount heuristic', async () => {
    vi.mocked(dispatchProvider).mockImplementation(async (_db: any, group: string) => {
      if (group === 'fraud_detection') {
        return { provider: 'internal', status: 'received', responseBody: { riskScore: 75, recommendation: 'review', fraudFlag: true, rulesFired: ['HIGH_VALUE_TXN', 'RISKY_MCC'] } } as any;
      }
      return { provider: 'internal', status: 'received' } as any;
    });
    // A LOW amount that the PSP amount rule would NOT flag: proving the verdict (not the amount) decides.
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

  // U-01: cardTransactionDescription accepted and function returns successfully 
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
      paymentCardReference: 'pm_abc',
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

// v36 (ADR-063): the card-token lookup is a filter on the canonical collection, and the masked PAN is
// its OWN filter. It used to be inferred from the shape of the `cardToken` value, so a token that
// happened to look like a masked PAN queried the wrong field.
describe('getAllTransactions: explicit card filters', () => {
  it('matches the card token on paymentCardReference', async () => {
    const db = makeDb({ findResults: [{ cardTransactionInstanceReference: 'txn-001' }] });
    const result = await getAllTransactions(db, { cardToken: 'pm_abc' }, 1, 20);
    expect(db._find).toHaveBeenCalledWith(expect.objectContaining({ paymentCardReference: 'pm_abc' }));
    expect(result.results).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('matches a masked PAN on its own field, never on the token', async () => {
    const db = makeDb({ findResults: [] });
    await getAllTransactions(db, { maskedPan: '****-****-****-4242' }, 1, 20);
    const query = db._find.mock.calls[0][0];
    expect(query).toEqual({ cardTransactionMaskedPanDisplay: '****-****-****-4242' });
    expect(query).not.toHaveProperty('paymentCardReference');
  });

  it('returns an empty page for an unknown token', async () => {
    const db = makeDb({ findResults: [] });
    const result = await getAllTransactions(db, { cardToken: 'pm_unknown' }, 1, 20);
    expect(result.results).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

/**
 * A hosted flow (payment link / checkout) may not know the payer: it passes the typed email, else the
 * CARD TOKEN. A token resolves to no agreement, so the transaction used to be stamped with the token as
 * its account reference, which made the payment belong to nobody and kept it out of every history
 * (customer and merchant alike). The card-on-file owner is the fallback.
 */
describe('a hosted payment resolves its payer through the card on file', () => {
  // The agreement lookup runs on the ROLE client (QE), not on the db handed to createTransaction, so
  // drive that double: answer only for the instance reference the card names.
  function agreementLookup() {
    h.findOne.mockImplementation(async (filter: Record<string, unknown>) => (
      filter?.customerAgreementInstanceReference === 'agr-1'
        ? { customerAgreementInstanceReference: 'agr-1', customerAgreementReference: 'ACC-LF-20240115' }
        : null
    ));
  }

  beforeEach(() => {
    h.insertOne.mockClear();
    h.findOne.mockReset();
    h.findOne.mockResolvedValue(null);
    h.getCardByToken.mockResolvedValue(null);
  });

  afterAll(() => { h.findOne.mockReset(); h.findOne.mockResolvedValue(null); });

  it('stamps the owner account reference instead of the card token', async () => {
    h.getCardByToken.mockResolvedValue({
      paymentCardStatus: 'active', customerAgreementInstanceReference: 'agr-1',
    });
    // What processLinkPayment sends when the payer typed no email.
    agreementLookup();
    await createTransaction(txDb(), { ...baseInput, accountReference: 'pm_abc123' });
    const doc = h.insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.cardTransactionAccountReference).toBe('ACC-LF-20240115');
  });

  it('keeps the token when the card is not registered to anyone', async () => {
    h.getCardByToken.mockResolvedValue(null);
    await createTransaction(txDb(), { ...baseInput, accountReference: 'pm_abc123' });
    const doc = h.insertOne.mock.calls[0][0] as Record<string, unknown>;
    // Nothing to resolve: the previous behaviour is preserved rather than inventing an owner.
    expect(doc.cardTransactionAccountReference).toBe('pm_abc123');
  });

  it('an explicit account reference still wins over the card', async () => {
    h.getCardByToken.mockResolvedValue({
      paymentCardStatus: 'active', customerAgreementInstanceReference: 'agr-1',
    });
    h.findOne.mockImplementation(async (filter: Record<string, unknown>) => (
      filter?.customerAgreementReference === 'ACC-OTHER'
        ? { customerAgreementInstanceReference: 'agr-9', customerAgreementReference: 'ACC-OTHER' }
        : null
    ));
    await createTransaction(txDb(), { ...baseInput, accountReference: 'ACC-OTHER' });
    const doc = h.insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.cardTransactionAccountReference).toBe('ACC-OTHER');
  });
});
