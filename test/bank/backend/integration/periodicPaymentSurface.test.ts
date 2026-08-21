// v37 P3.9: standing orders on the standard's own resource.
//
// The schedule arithmetic is unit-tested next door. What is worth an integration test is the surface: that the
// order is authorised by the same consent gate a single payment is, that nothing moves at creation, that the
// derived next execution date cannot be supplied by the caller, and that one third party cannot read another's.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../bank/backend/bin/server';
import { issueAccessToken } from '../../../../bank/backend/src/modules/tpp-trust/services/tppAccessToken.service';
import { PERIODIC_PAYMENT_COLLECTION } from '../../../../bank/backend/src/modules/pisp/models/periodicPayment.model';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../../../bank/backend/src/modules/aspsp/models/accountArrangement.model';
import { BANK_CONSENT_AGREEMENT_COLLECTION } from '../../../../bank/backend/src/modules/consent/models/bankConsent.model';

const PRODUCT = 'sepa-credit-transfers';
const token = (clientId = 'leafypay-psp') => issueAccessToken(
  { tppRegistrationClientId: clientId, tppRegistrationRoles: ['AISP', 'PISP', 'CBPII'] } as never,
  ['payments'] as never,
).accessToken;

describe('v37 P3.9: the standing order surface', () => {
  let app: FastifyInstance;
  let consentId = '';
  let debtorIban = '';
  let created: string | undefined;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    if (app.dbError) return;

    // A real consent that authorises payments, and the account it covers.
    const consent = await app.db.collection(BANK_CONSENT_AGREEMENT_COLLECTION).findOne({
      bankConsentStatus: 'valid',
      'bankConsentAccess.payments.0': { $exists: true },
    });
    consentId = (consent?.bankConsentAgreementInstanceReference as string) ?? '';
    const accountRef = (consent?.bankConsentAccess as { payments: string[] })?.payments?.[0];
    const account = await app.db.collection(ACCOUNT_ARRANGEMENT_COLLECTION)
      .findOne({ accountArrangementInstanceReference: accountRef });
    debtorIban = (account?.accountIban as string) ?? '';
  });

  afterAll(async () => {
    if (app?.db && !app.dbError) {
      await app.db.collection(PERIODIC_PAYMENT_COLLECTION)
        .deleteMany({ paymentRemittanceInformation: /^P3.9 / });
    }
    await app?.close();
  });

  function body(overrides: Record<string, unknown> = {}) {
    return {
      debtorAccount: { iban: debtorIban },
      creditorAccount: { iban: 'ES9121000418450200051332' },
      creditorName: 'Standing Order Recipient',
      instructedAmount: { currency: 'EUR', amount: '25.00' },
      remittanceInformationUnstructured: 'P3.9 monthly rent',
      startDate: '2026-09-01',
      frequency: 'Monthly',
      dayOfExecution: 15,
      ...overrides,
    };
  }

  const create = (payload: Record<string, unknown>, requestId: string, client = 'leafypay-psp') => app.inject({
    method: 'POST',
    url: `/v1/periodic-payments/${PRODUCT}`,
    headers: {
      authorization: `Bearer ${token(client)}`,
      'consent-id': consentId,
      'x-request-id': requestId,
    },
    payload,
  });

  it('creates a standing order, derives its first execution, and moves nothing', async () => {
    if (app.dbError || !debtorIban) return;
    const response = await create(body(), `p39-create-${Date.now()}`);
    expect(response.statusCode, response.body).toBe(201);
    const order = response.json();

    // Accepted, not executed. `ACSC` here would claim a collection that has not happened.
    expect(order.transactionStatus).toBe('ACTC');
    // Derived from the schedule: the 15th, not the start date.
    expect(order.nextExecutionDate).toBe('2026-09-15');
    expect(order.executionCount).toBe(0);
    expect(order.paymentId).toBeTruthy();
    created = order.paymentId;

    // And no execution record exists, because nothing ran.
    const stored = await app.db.collection(PERIODIC_PAYMENT_COLLECTION)
      .findOne({ periodicPaymentInstanceReference: created });
    expect((stored?.periodicExecutions as unknown[])?.length ?? 0).toBe(0);
  });

  it('ignores a caller-supplied next execution date', async () => {
    if (app.dbError || !debtorIban) return;
    // A caller who could set this could make the bank collect whenever it liked, so it is derived and the
    // field is not part of the contract.
    const response = await create(
      body({ nextExecutionDate: '2026-09-02', periodicNextExecutionDate: '2026-09-02' }),
      `p39-derived-${Date.now()}`,
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().nextExecutionDate).toBe('2026-09-15');
  });

  it('refuses a schedule that cannot run, naming what is wrong', async () => {
    if (app.dbError || !debtorIban) return;
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ startDate: '2026-02-31' }, 'startDate'],
      [{ endDate: '2026-08-01' }, 'endDate'],
      [{ startDate: '2026-09-20', dayOfExecution: 15, endDate: '2026-09-25' }, 'no execution date'],
    ];
    for (const [overrides, expected] of cases) {
      const response = await create(body(overrides), `p39-bad-${expected}-${Date.now()}`);
      expect(response.statusCode, JSON.stringify(overrides)).toBe(400);
      expect(response.json().tppMessages[0].text).toContain(expected);
    }
  });

  it('refuses a frequency outside the standard code set', async () => {
    if (app.dbError || !debtorIban) return;
    // Schema-level, so the answer names the field rather than reaching the engine.
    const response = await create(body({ frequency: 'Fortnightly' }), `p39-freq-${Date.now()}`);
    expect(response.statusCode).toBe(400);
  });

  it('requires a consent, and refuses one that does not authorise payments', async () => {
    if (app.dbError || !debtorIban) return;
    const noConsent = await app.inject({
      method: 'POST',
      url: `/v1/periodic-payments/${PRODUCT}`,
      headers: { authorization: `Bearer ${token()}`, 'x-request-id': `p39-noconsent-${Date.now()}` },
      payload: body(),
    });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().tppMessages[0].code).toBe('CONSENT_INVALID');

    const unknownConsent = await app.inject({
      method: 'POST',
      url: `/v1/periodic-payments/${PRODUCT}`,
      headers: {
        authorization: `Bearer ${token()}`,
        'consent-id': 'not-a-consent',
        'x-request-id': `p39-badconsent-${Date.now()}`,
      },
      payload: body(),
    });
    expect(unknownConsent.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('reads the order and its status back', async () => {
    if (app.dbError || !created) return;
    const resource = await app.inject({
      method: 'GET',
      url: `/v1/periodic-payments/${PRODUCT}/${created}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(resource.statusCode).toBe(200);
    expect(resource.json().frequency).toBe('Monthly');
    expect(resource.json().dayOfExecution).toBe(15);

    const status = await app.inject({
      method: 'GET',
      url: `/v1/periodic-payments/${PRODUCT}/${created}/status`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(status.statusCode).toBe(200);
    // The order's own status AND the transaction status: an active order can have had a failed collection,
    // and one field could not say both.
    expect(status.json().periodicPaymentStatus).toBe('active');
    expect(status.json().transactionStatus).toBe('ACTC');
  });

  it('does not find another third party\'s order, rather than refusing it', async () => {
    if (app.dbError || !created) return;
    // 404 not 403: refusing would confirm the reference exists.
    const response = await app.inject({
      method: 'GET',
      url: `/v1/periodic-payments/${PRODUCT}/${created}`,
      headers: { authorization: `Bearer ${token('someone-else')}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('cancels the order and stops it collecting', async () => {
    if (app.dbError || !created) return;
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/periodic-payments/${PRODUCT}/${created}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().transactionStatus).toBe('CANC');

    const stored = await app.db.collection(PERIODIC_PAYMENT_COLLECTION)
      .findOne({ periodicPaymentInstanceReference: created });
    expect(stored?.periodicPaymentStatus).toBe('cancelled');
    // Nothing left to collect on.
    expect(stored?.periodicNextExecutionDate).toBeUndefined();
  });

  it('refuses to cancel an order twice', async () => {
    if (app.dbError || !created) return;
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/periodic-payments/${PRODUCT}/${created}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(response.statusCode).toBe(409);
  });

  it('replays a retried creation instead of creating a second order', async () => {
    if (app.dbError || !debtorIban) return;
    // Two standing orders collecting the same money is the worst outcome of a retry, so the request id keys
    // it the same way a single payment is keyed.
    const requestId = `p39-idem-${Date.now()}`;
    const first = await create(body(), requestId);
    const second = await create(body(), requestId);
    expect(first.statusCode).toBe(201);
    expect(second.json().paymentId).toBe(first.json().paymentId);

    const count = await app.db.collection(PERIODIC_PAYMENT_COLLECTION)
      .countDocuments({ periodicPaymentInstanceReference: first.json().paymentId });
    expect(count).toBe(1);
  });
});
