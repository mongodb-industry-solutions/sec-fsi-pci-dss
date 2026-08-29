// v37 P8: the credit bureau surface, against the running app.
//
// Worth an integration test rather than a unit test: the scope separation, and that the assessment is made
// from the bank's REAL seeded accounts. A scoring function can be unit-tested; "it actually reads the
// accounts this bank holds" cannot.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../bank/backend/bin/server';
import { tppToken, stopTppAuthority } from '../support/tppToken';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../../../bank/backend/src/modules/aspsp/models/accountArrangement.model';

const REGISTRATION = { tppRegistrationClientId: 'leafypay-psp', tppRegistrationRoles: ['AISP', 'PISP', 'CBPII'] } as never;
const withScopes = (scopes: string[]) => tppToken(scopes);

const BUREAU = () => withScopes(['credit-assessments', 'accounts']);
// Deliberately without credit-assessments: reading someone's creditworthiness is a different permission
// from reading their accounts.
const ACCOUNTS_ONLY = () => withScopes(['accounts', 'balances']);

describe('v37 P8: the credit bureau surface', () => {
  let app: FastifyInstance;
  let holder: string | undefined;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    if (!app.dbError) {
      const account = await app.db.collection(ACCOUNT_ARRANGEMENT_COLLECTION)
        .findOne({}, { projection: { _id: 0, accountHolderInstanceReference: 1 } });
      holder = account?.accountHolderInstanceReference as string | undefined;
    }
  });

  afterAll(async () => {
    await stopTppAuthority();
    await app?.close();
  });

  it('refuses an assessment to a token that can only read accounts', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/credit-assessments',
      headers: { authorization: `Bearer ${await ACCOUNTS_ONLY()}` },
      payload: { accountHolderReference: holder ?? 'anyone' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a caller with no token, and says how to authenticate', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/credit-assessments',
      payload: { accountHolderReference: 'anyone' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBeTruthy();
  });

  it('assesses a party this bank actually banks, and explains the score', async () => {
    if (!holder) return; // no database in this environment
    const response = await app.inject({
      method: 'POST',
      url: '/v1/credit-assessments',
      headers: { authorization: `Bearer ${await BUREAU()}` },
      payload: { accountHolderReference: holder },
    });
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.creditScore).toBeGreaterThanOrEqual(300);
    expect(result.creditScore).toBeLessThanOrEqual(850);
    expect(['A', 'B', 'C', 'D', 'E']).toContain(result.creditRating);
    // The reasoning has to reconstruct the number, or it is decoration.
    expect(result.assessmentFactors).toHaveLength(3);
    const total = result.assessmentFactors
      .reduce((sum: number, factor: { assessmentFactorPoints: number }) => sum + factor.assessmentFactorPoints, 0);
    expect(600 + total).toBe(result.creditScore);
  });

  it('records the assessment, so the version a decision was made against can be read back', async () => {
    if (!holder) return;
    const response = await app.inject({
      method: 'GET',
      url: `/v1/credit-assessments/${encodeURIComponent(holder)}`,
      headers: { authorization: `Bearer ${await BUREAU()}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().creditScore).toBeGreaterThanOrEqual(300);
  });

  it('reassesses the same party in place rather than accumulating rows', async () => {
    if (!holder) return;
    const assess = async () => app.inject({
      method: 'POST',
      url: '/v1/credit-assessments',
      headers: { authorization: `Bearer ${await BUREAU()}` },
      payload: { accountHolderReference: holder },
    });
    await assess();
    await assess();
    const count = await app.db.collection('creditAssessmentState')
      .countDocuments({ accountHolderInstanceReference: holder });
    expect(count).toBe(1);
  });

  it('refuses a party it does not bank rather than scoring on no evidence', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/credit-assessments',
      headers: { authorization: `Bearer ${await BUREAU()}` },
      payload: { accountHolderReference: 'nobody-this-bank-has-ever-heard-of' },
    });
    if (response.statusCode === 503) return;
    expect(response.statusCode).toBe(404);
    expect(response.json().tppMessages?.[0]?.code).toBe('RESOURCE_UNKNOWN');
  });

  it('answers 404 for an assessment never made, rather than making one on a read', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/credit-assessments/nobody-this-bank-has-ever-heard-of',
      headers: { authorization: `Bearer ${await BUREAU()}` },
    });
    if (response.statusCode === 503) return;
    expect(response.statusCode).toBe(404);
  });
});
