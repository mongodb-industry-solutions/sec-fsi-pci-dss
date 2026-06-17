/**
 * Unit tests (dev.v8 P7, §7.8): the CHD carrier. When raw card verification is present, the issuer
 * gate publishes card.issuer.validation.requested carrying ONLY the encrypted `chd` envelope — never
 * raw PAN/CVV — and the issuer adapter can decrypt it just-in-time. The injected crypto is local.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';

const h = vi.hoisted(() => {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'm' });
  const findOne = vi.fn().mockResolvedValue(null);
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const qeDb = { collection: vi.fn(() => ({ insertOne, findOne, updateOne })) };
  return { qeDb, getDbForRole: vi.fn().mockResolvedValue(qeDb), dispatchProvider: vi.fn().mockResolvedValue({ provider: 'internal', status: 'received' }) };
});
vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({ getDbForRole: h.getDbForRole }));
vi.mock('../../../../backend/src/vendors/security/escalationTokens', () => ({ validateToken: vi.fn().mockReturnValue({ valid: false }) }));
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({ createFraudCase: vi.fn().mockResolvedValue({ fraudDiagnosisInstanceReference: 'f' }) }));
vi.mock('../../../../backend/src/modules/customer/services/paymentCard.service', () => ({
  getCardByToken: vi.fn().mockResolvedValue(null), upsertCardByToken: vi.fn().mockResolvedValue({ paymentCardInstanceReference: 'c', created: false }),
}));
vi.mock('../../../../backend/src/modules/providers/services/integrationDispatch.service', () => ({ dispatchProvider: h.dispatchProvider }));
vi.mock('../../../../backend/src/modules/providers/services/businessProcessEvent.service', () => ({ emitProcessEvent: vi.fn(), emitComplianceEvent: vi.fn() }));
vi.mock('../../../../backend/src/modules/gateway/services/merchantCallback.service', () => ({ sendMerchantPaymentCallback: vi.fn().mockResolvedValue(undefined) }));

import { createTransaction } from '../../../../backend/src/modules/transactions/services/cardTransaction.service';
import { EventBusInProcess } from '../../../../backend/src/vendors/eventbus/EventBusInProcess';
import type { EventStore } from '../../../../backend/src/vendors/eventbus/EventStore';
import { setEventBus, getEventBus } from '../../../../backend/src/vendors/eventbus';
import type { DomainEvent } from '../../../../backend/src/vendors/eventbus/types';
import { PaymentAuthorizationSaga } from '../../../../backend/src/modules/transactions/services/paymentAuthorization.saga';
import { EnvelopeChdCrypto, LocalKmsKeyProvider, setChdCrypto } from '../../../../backend/src/vendors/encryption/chdCrypto';

class FakeStore implements EventStore {
  events: DomainEvent[] = [];
  async append(e: DomainEvent) { this.events.push(e); }
  async trail(c: string) { return this.events.filter((e) => e.correlationId === c); }
  async byProcess(bp: DomainEvent['businessProcess']) { return this.events.filter((e) => e.businessProcess === bp); }
}

const txDb = () => ({ collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) }) as never;
const PAN = '4111111111111111';
const input = {
  cardToken: 'tok', accountReference: 'ACC-1', amount: 100, currency: 'USD',
  cardTransactionMerchantName: 'Shop', cardTransactionMerchantCategoryCode: '5411', cardTransactionChannel: 'online',
  cardTransactionMaskedPanDisplay: '****1111', cardTransactionType: 'purchase' as const, cardTransactionDescription: 'SHOP',
  gatewayPayload: { source: 'test' }, cardVerification: { cardNumber: PAN, cvv: '123', expiry: '12/30' },
};

describe('P7 — encrypted CHD carrier (§7.8)', () => {
  let store: FakeStore;
  let crypto: EnvelopeChdCrypto;
  beforeEach(() => {
    crypto = new EnvelopeChdCrypto(new LocalKmsKeyProvider(randomBytes(96).toString('base64')));
    setChdCrypto(crypto);
    store = new FakeStore();
    setEventBus(new EventBusInProcess(store));
    new PaymentAuthorizationSaga(txDb(), getEventBus()).register();
  });

  it('carries chd as an opaque, decryptable token and never raw CHD on the bus', async () => {
    await createTransaction(txDb(), input);
    const issuerReq = store.events.find((e) => e.eventType === 'card.issuer.validation.requested')!;
    const p = issuerReq.payload as Record<string, unknown>;
    expect(typeof p.chd).toBe('string');
    expect((p.chd as string).startsWith('v1.')).toBe(true);
    // raw card keys must be absent from the bus payload
    for (const k of ['cardNumber', 'cvv', 'expiry']) expect(p).not.toHaveProperty(k);
    // and the raw PAN must not appear anywhere in the persisted event
    expect(JSON.stringify(issuerReq)).not.toContain(PAN);
    // the issuer adapter can recover the CHD just-in-time
    const back = await crypto.decrypt(p.chd as string, { correlationId: issuerReq.correlationId, eventType: 'card.issuer.validation.requested' });
    expect(back).toEqual({ cardNumber: PAN, cvv: '123', expiry: '12/30' });
  });

  it('the whole journey trail is free of the raw PAN', async () => {
    await createTransaction(txDb(), input);
    expect(JSON.stringify(store.events)).not.toContain(PAN);
  });
});
