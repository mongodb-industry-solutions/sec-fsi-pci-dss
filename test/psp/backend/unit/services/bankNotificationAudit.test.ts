/**
 * Every callback the bank sends is auditable from the provider's own event log: accepted, replayed and
 * refused alike, each with the signed token as received and what the PSP did with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  logEvent: vi.fn(async () => undefined),
  getActiveProviderForType: vi.fn(async (_db: unknown, type: string) => ({ externalProviderArrangementInstanceReference: `arr-${type}` })),
}));
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationDispatch.service', () => ({ logEvent: h.logEvent }));
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationRegistry.service', () => ({ getActiveProviderForType: h.getActiveProviderForType }));

import type { Db } from 'mongodb';
import { recordBankNotification } from '../../../../../psp/backend/src/modules/provider/services/bankcoreNotification.service';

const db = {} as Db;
const payment = {
  eventId: 'jti-1', eventType: 'payment.status.changed', subjectReference: 'pmt-1', status: 'ACSC',
  detail: { endToEndIdentification: 'exec-1' }, correlationId: 'exec-1',
};

describe('bank notification audit', () => {
  beforeEach(() => { h.logEvent.mockClear(); });

  it('files an applied payment notification under payment initiation, with the token and the outcome', async () => {
    await recordBankNotification(db, { token: 'jws.token.sig', notification: payment, outcome: 'applied', detail: 'settled', responseCode: 200, latencyMs: 12, busEvent: 'bank.transfer.settled' });
    expect(h.logEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      arrangementId: 'arr-payment_initiation', type: 'callback', status: 'received',
      triggeredBy: 'bankcore.payment.status.changed',
      request: expect.objectContaining({ body: 'jws.token.sig' }),
      meta: expect.objectContaining({ outcome: 'applied', reEmittedAs: 'bank.transfer.settled' }),
    }));
  });

  it('files a consent notification under account information', async () => {
    await recordBankNotification(db, { token: 't', notification: { ...payment, eventType: 'consent.status.changed' }, outcome: 'applied', detail: 'ok', responseCode: 200, latencyMs: 1 });
    expect(h.logEvent).toHaveBeenCalledWith(db, expect.objectContaining({ arrangementId: 'arr-account_information' }));
  });

  it('records a refused token as an error, so the notification that never verified is still visible', async () => {
    await recordBankNotification(db, { token: 'forged', outcome: 'refused', detail: 'signature invalid', responseCode: 401, latencyMs: 3 });
    expect(h.logEvent).toHaveBeenCalledWith(db, expect.objectContaining({ status: 'error', error: 'signature invalid', responseCode: 401 }));
  });

  it('never throws, so auditing cannot fail the acknowledgement', async () => {
    h.logEvent.mockRejectedValueOnce(new Error('db down'));
    await expect(recordBankNotification(db, { token: 't', notification: payment, outcome: 'applied', detail: 'x', responseCode: 200, latencyMs: 1 })).resolves.toBeUndefined();
  });
});
