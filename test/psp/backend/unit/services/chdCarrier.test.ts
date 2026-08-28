/**
 * Unit tests (dev.v8 P7, §7.8): the CHD carrier. When raw card verification is present, the issuer
 * gate publishes card.issuer.validation.requested carrying ONLY the encrypted `chd` envelope, never
 * raw PAN/CVV, and the issuer adapter can decrypt it just-in-time. The injected crypto is local.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';

const h = vi.hoisted(() => {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'm' });
  const findOne = vi.fn().mockResolvedValue(null);
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const qeDb = { collection: vi.fn(() => ({ insertOne, findOne, updateOne })) };
  return { qeDb, getDbForRole: vi.fn().mockResolvedValue(qeDb), dispatchProvider: vi.fn().mockResolvedValue({ provider: 'internal', status: 'received', responseBody: { actionConfirmed: true } }) };
});
vi.mock('../../../../../psp/backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
  // v32 C6: the sensitive-tier / encryption-write clients are the same double here.
  getSensitiveTierDb: h.getDbForRole,
  getEncryptionWriteDb: h.getDbForRole,
}));
vi.mock('../../../../../psp/backend/src/vendors/security/escalationTokens', () => ({ validateToken: vi.fn().mockReturnValue({ valid: false }) }));
vi.mock('../../../../../psp/backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({ createFraudCase: vi.fn().mockResolvedValue({ fraudDiagnosisInstanceReference: 'f' }) }));
vi.mock('../../../../../psp/backend/src/modules/customer/services/paymentCard.service', () => ({
  getCardByToken: vi.fn().mockResolvedValue(null), upsertCardByToken: vi.fn().mockResolvedValue({ paymentCardInstanceReference: 'c', created: false }),
}));
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationDispatch.service', () => ({ dispatchProvider: h.dispatchProvider }));
vi.mock('../../../../../psp/backend/src/modules/provider/services/businessProcessEvent.service', () => ({ emitProcessEvent: vi.fn(), emitComplianceEvent: vi.fn() }));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/merchantCallback.service', () => ({ sendMerchantPaymentCallback: vi.fn().mockResolvedValue(undefined) }));

import { createTransaction } from '../../../../../psp/backend/src/modules/transaction/services/cardTransaction.service';
import { EventBusInProcess } from '@leafypay/eventbus';
import type { EventStore } from '@leafypay/eventbus';
import { setEventBus, getEventBus } from '../../../../../psp/backend/src/vendors/eventbus';
import type { DomainEvent } from '@leafypay/eventbus';
import { PaymentAuthorizationSaga } from '../../../../../psp/backend/src/modules/transaction/services/paymentAuthorization.saga';
import { ProviderGroups } from '../../../../../psp/backend/src/providers/groups/providerGroups';
import { EnvelopeChdCrypto, LocalKmsKeyProvider, setChdCrypto } from '../../../../../psp/backend/src/vendors/encryption/chdCrypto';

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

describe('P7: encrypted CHD carrier (§7.8)', () => {
  let store: FakeStore;
  let crypto: EnvelopeChdCrypto;
  beforeEach(() => {
    crypto = new EnvelopeChdCrypto(new LocalKmsKeyProvider(randomBytes(96).toString('base64')));
    setChdCrypto(crypto);
    store = new FakeStore();
    setEventBus(new EventBusInProcess(store));
    new ProviderGroups(txDb(), getEventBus()).register();
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
