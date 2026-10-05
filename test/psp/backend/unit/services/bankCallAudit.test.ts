/**
 * A direct call to the bank (a payment, a card hold) leaves the same outbound record in the provider's event
 * log as a dispatched one, so the provider section shows the whole conversation and not only the callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  logEvent: vi.fn(async () => undefined),
  getActiveProviderForType: vi.fn(async (_db: unknown, type: string) => ({ externalProviderArrangementInstanceReference: `arr-${type}` })),
}));
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationDispatch.service', () => ({ logEvent: h.logEvent }));
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationRegistry.service', () => ({ getActiveProviderForType: h.getActiveProviderForType }));

import type { Db } from 'mongodb';
import { recordBankCall } from '../../../../../psp/backend/src/modules/provider/services/bankCallAudit.service';

const db = {} as Db;
const audit = { db, triggeredBy: 'provider.payment_initiation.transfer.requested', businessContext: { entityType: 'execution' as const, entityId: 'exec-1', processType: 'payment_processing' as const } };
const call = { method: 'POST', url: 'http://bank/v1/payments/sepa-credit-transfers', headers: { Authorization: 'Bearer secret', 'Consent-ID': 'c1' }, body: { amount: '1.00' }, latencyMs: 40 };

describe('outbound bank call audit', () => {
  beforeEach(() => { h.logEvent.mockClear(); });

  it('records an accepted call as received, under the provider of the capability, without the bearer token', async () => {
    await recordBankCall(audit, 'payment_initiation', { ...call, status: 201, responseBody: { paymentId: 'pmt-1' } });
    expect(h.logEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      arrangementId: 'arr-payment_initiation', type: 'dispatch', status: 'received', responseCode: 201,
      triggeredBy: 'provider.payment_initiation.transfer.requested',
      request: expect.objectContaining({ method: 'POST', headers: { 'Consent-ID': 'c1' } }),
      response: { status: 201, body: { paymentId: 'pmt-1' } },
    }));
  });

  it('records a refusal as an error and an unreachable bank as a timeout', async () => {
    await recordBankCall(audit, 'card_authorization', { ...call, status: 403, responseBody: { tppMessages: [] } });
    expect(h.logEvent).toHaveBeenLastCalledWith(db, expect.objectContaining({ arrangementId: 'arr-card_authorization', status: 'error' }));
    await recordBankCall(audit, 'card_authorization', { ...call, error: 'timed out' });
    expect(h.logEvent).toHaveBeenLastCalledWith(db, expect.objectContaining({ status: 'timeout', error: 'timed out' }));
  });

  it('does nothing when the caller supplied no audit, and never throws', async () => {
    await recordBankCall(undefined, 'payment_initiation', call);
    expect(h.logEvent).not.toHaveBeenCalled();
    h.logEvent.mockRejectedValueOnce(new Error('db down'));
    await expect(recordBankCall(audit, 'payment_initiation', { ...call, status: 200 })).resolves.toBeUndefined();
  });
});
