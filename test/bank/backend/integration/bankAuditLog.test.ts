// v37 P3.8: the bank's own audit trail.
//
// The consent access log already existed and records consent DECISIONS. That is narrower than
// non-repudiation: a call needing no consent (a token request, a card validation, an administrative change)
// never appears in it, so "what did this third party do here" had no answer. This records every request.
//
// Two properties are worth more than the rest, and both are asserted here: a REFUSED attempt is recorded (a
// trail that only holds successes is the one an intruder would design), and no request body is recorded (a
// trail that copies the payload becomes a second place the sensitive data lives).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../../../bank/backend/bin/server';
import { config } from '../../../../bank/backend/src/config';
import { issueAccessToken } from '../../../../bank/backend/src/modules/tpp-trust/services/tppAccessToken.service';
import {
  BANK_AUDIT_LOG_COLLECTION, BankAuditLogRecord,
} from '../../../../bank/backend/src/modules/audit/models/bankAuditLog.model';

const ADMIN = () => jwt.sign({ role: 'admin', sub: 'p38-ops' }, config.app.adminSecret, { expiresIn: 300 });
const TPP = (scopes: string[]) => issueAccessToken(
  { tppRegistrationClientId: 'leafypay-psp', tppRegistrationRoles: ['AISP', 'PISP', 'CBPII'] } as never,
  scopes as never,
).accessToken;

// The hook records after the response, so a read has to let the write land.
const settle = () => new Promise((done) => setTimeout(done, 400));

describe('v37 P3.8: the bank records what it was asked', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app?.db && !app.dbError) {
      await app.db.collection(BANK_AUDIT_LOG_COLLECTION).deleteMany({ auditCorrelationId: /^p38-/ });
    }
    await app?.close();
  });

  async function rowsFor(correlationId: string): Promise<BankAuditLogRecord[]> {
    await settle();
    return app.db.collection<BankAuditLogRecord>(BANK_AUDIT_LOG_COLLECTION)
      .find({ auditCorrelationId: correlationId }, { projection: { _id: 0 } })
      .toArray();
  }

  it('records an authorised read with the actor, the route and the consent', async () => {
    if (app.dbError) return;
    const consentId = 'p38-consent-ref';
    const response = await app.inject({
      method: 'GET',
      url: '/v1/accounts',
      headers: {
        authorization: `Bearer ${TPP(['accounts'])}`,
        'consent-id': consentId,
        'x-request-id': 'p38-read',
      },
    });
    expect(response.statusCode).toBeLessThan(500);

    const rows = await rowsFor('p38-read');
    expect(rows.length, 'the read left no audit row').toBeGreaterThan(0);
    const row = rows[0];
    expect(row.auditActorReference).toBe('leafypay-psp');
    expect(row.auditRequestMethod).toBe('GET');
    expect(row.auditRequestRoute).toBe('/v1/accounts');
    expect(row.auditChannel).toBe('open_banking');
    // The consent travelled in a header, and it lands in the field a reviewer filters on.
    expect(row.auditConsentReference).toBe(consentId);
    expect(typeof row.auditDurationMs).toBe('number');
  });

  it('records a REFUSED attempt, which is the row a reviewer most wants', async () => {
    if (app.dbError) return;
    // A trail that holds only what succeeded is the trail an intruder would design.
    const response = await app.inject({
      method: 'POST',
      url: '/v1/cards/searches',
      headers: { authorization: `Bearer ${TPP(['accounts'])}`, 'x-request-id': 'p38-refused' },
      payload: { cardNumber: '4111111111111111' },
    });
    expect(response.statusCode).toBe(403);

    const rows = await rowsFor('p38-refused');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].auditOutcome).toBe('refused');
    expect(rows[0].auditResponseStatus).toBe(403);
  });

  it('records an unauthenticated attempt as anonymous rather than dropping it', async () => {
    if (app.dbError) return;
    await app.inject({ method: 'GET', url: '/v1/accounts', headers: { 'x-request-id': 'p38-anon' } });
    const rows = await rowsFor('p38-anon');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].auditActorReference).toBe('anonymous');
    expect(rows[0].auditResponseStatus).toBe(401);
  });

  it('never records a request body, a card number or a verification value', async () => {
    if (app.dbError) return;
    const pan = '4111111111111111';
    await app.inject({
      method: 'POST',
      url: '/v1/cards/validations',
      headers: {
        authorization: `Bearer ${TPP(['card-authorisations'])}`,
        'x-request-id': 'p38-nobody',
      },
      payload: { cardNumber: pan, cvv: '123', expiry: '12/34' },
    });
    const rows = await rowsFor('p38-nobody');
    expect(rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(rows[0]);
    // The row must not become a second copy of what was sent.
    expect(serialised).not.toContain(pan);
    expect(serialised).not.toContain('"123"');
    expect(rows[0]).not.toHaveProperty('auditRequestBody');
  });

  it('puts a path reference in the field that names its kind', async () => {
    if (app.dbError) return;
    await app.inject({
      method: 'GET',
      url: '/v1/cards/pm_p38_probe',
      headers: { authorization: `Bearer ${TPP(['card-data'])}`, 'x-request-id': 'p38-card' },
    });
    const rows = await rowsFor('p38-card');
    expect(rows.length).toBeGreaterThan(0);
    // The route is templated, and the concrete reference is a field rather than something to parse back out.
    expect(rows[0].auditRequestRoute).toBe('/v1/cards/:cardToken');
    expect(rows[0].auditCardReference).toBe('pm_p38_probe');
  });

  it('does not record health checks, which would bury the rows that matter', async () => {
    if (app.dbError) return;
    const before = await app.db.collection(BANK_AUDIT_LOG_COLLECTION).countDocuments({ auditRequestRoute: '/health' });
    await app.inject({ method: 'GET', url: '/health' });
    await settle();
    const after = await app.db.collection(BANK_AUDIT_LOG_COLLECTION).countDocuments({ auditRequestRoute: '/health' });
    expect(after).toBe(before);
  });

  it('serves the trail on the admin API, filterable by outcome and by any reference', async () => {
    if (app.dbError) return;
    const all = await app.inject({
      method: 'GET', url: '/api/v1/admin/audit?limit=5', headers: { authorization: `Bearer ${ADMIN()}` },
    });
    expect(all.statusCode).toBe(200);
    expect(Array.isArray(all.json().results)).toBe(true);

    const refused = await app.inject({
      method: 'GET', url: '/api/v1/admin/audit?outcome=refused&limit=5', headers: { authorization: `Bearer ${ADMIN()}` },
    });
    expect(refused.statusCode).toBe(200);
    for (const row of refused.json().results as BankAuditLogRecord[]) {
      expect(row.auditOutcome).toBe('refused');
    }

    // One reference, whichever kind it names: a reviewer holding an identifier should not have to know first.
    const byResource = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit?resource=pm_p38_probe',
      headers: { authorization: `Bearer ${ADMIN()}` },
    });
    expect(byResource.statusCode).toBe(200);
    expect((byResource.json().results as BankAuditLogRecord[]).length).toBeGreaterThan(0);
  });

  it('refuses the trail to a TPP token, however well scoped', async () => {
    if (app.dbError) return;
    // The trail says what every third party did. Handing it to one of them would be the disclosure the log
    // exists to prevent.
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: { authorization: `Bearer ${TPP(['accounts', 'card-data', 'credit-assessments'])}` },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(401);
    expect(response.statusCode).toBeLessThan(404);
  });
});
