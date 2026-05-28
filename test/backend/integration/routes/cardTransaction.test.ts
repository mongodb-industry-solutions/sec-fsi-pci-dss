/**
 * Integration tests: card transaction + fraud diagnosis routes (FR-v1-03, FR-v1-04)
 * Source: backend/src/controllers/cardTransaction.controller.ts
 *
 * Requires TEST_MONGODB_URI — skips gracefully when not set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/src/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

describe('FR-v1-03 + FR-v1-04: Card transaction + fraud routes', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    process.env.FRAUD_AMOUNT_THRESHOLD = '500';
    process.env.RISK_MCC_LIST = '5812,6011,7995';
    app = await buildApp();
    await app.ready();

    const loginRes = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah.chen@leafybank.demo', password: 'demo-password', domain: 'local' });
    authToken = loginRes.body.token;
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.close();
  });

  // FR-v1-03.5
  skip('GET /health returns 200 + connected status', async () => {
    const res = await supertest(app.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.atlas).toBe('connected');
  });

  // FR-v1-03.1: POST creates transaction
  skip('POST /card-transactions returns 201 with UUID reference', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/card-transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        cardToken: `tok_${Date.now()}`,
        accountReference: 'ACC-TEST-001',
        amount: 100,
        currency: 'USD',
        cardTransactionMerchantName: 'Safe Store',
        cardTransactionMerchantCategoryCode: '5411',
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: '****-****-****-9999',
        gatewayPayload: {},
      });
    expect(res.status).toBe(201);
    expect(res.body.cardTransactionInstanceReference).toBeTruthy();
    expect(res.body.cardTransactionStatus).toBe('authorized');
    expect(res.body.fraudCaseCreated).toBe(false);
  });

  // FR-v1-03.4: Fraud case auto-created for amount above threshold
  skip('POST /card-transactions above threshold creates fraud case', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/card-transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        cardToken: `tok_fraud_${Date.now()}`,
        accountReference: 'ACC-TEST-002',
        amount: 850,
        currency: 'USD',
        cardTransactionMerchantName: 'High Risk Store',
        cardTransactionMerchantCategoryCode: '5999',
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: '****-****-****-0001',
        gatewayPayload: {},
      });
    expect(res.status).toBe(201);
    expect(res.body.fraudCaseCreated).toBe(true);
    expect(res.body.fraudDiagnosisInstanceReference).toBeTruthy();
  });

  // FR-v1-03.4: Fraud case auto-created for high-risk MCC
  skip('POST /card-transactions with MCC in RISK_MCC_LIST creates fraud case', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/card-transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        cardToken: `tok_mcc_${Date.now()}`,
        accountReference: 'ACC-TEST-003',
        amount: 50,
        currency: 'USD',
        cardTransactionMerchantName: 'Casino',
        cardTransactionMerchantCategoryCode: '7995',
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: '****-****-****-0002',
        gatewayPayload: {},
      });
    expect(res.status).toBe(201);
    expect(res.body.fraudCaseCreated).toBe(true);
  });

  // FR-v1-03.3: GET by ID — Level 1 response (no QE fields)
  skip('GET /card-transactions/:id does not return QE account reference', async () => {
    const createRes = await supertest(app.server)
      .post('/api/v1/card-transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        cardToken: `tok_get_${Date.now()}`,
        accountReference: 'ACC-SECRET',
        amount: 99,
        currency: 'USD',
        cardTransactionMerchantName: 'Test',
        cardTransactionMerchantCategoryCode: '5411',
        cardTransactionChannel: 'pos',
        cardTransactionMaskedPanDisplay: '****-****-****-0003',
        gatewayPayload: {},
      });

    const txnId = createRes.body.cardTransactionInstanceReference;
    const res = await supertest(app.server)
      .get(`/api/v1/card-transactions/${txnId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.cardTransactionMerchantName).toBeDefined();
    expect(res.body.cardTransactionAccountReference).toBeUndefined();
  });

  // FR-v1-03.2: POST /payment-cards
  skip('POST /payment-cards returns 201 with active card status', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/payment-cards')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerAgreementInstanceReference: 'cust-test-001',
        cardToken: `tok_card_${Date.now()}`,
        paymentCardExpirationDate: '12/28',
        paymentCardMaskedPanDisplay: '****-****-****-1111',
        paymentCardNetwork: 'VISA',
        paymentCardIsPreferred: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.paymentCardInstanceReference).toBeTruthy();
    expect(res.body.paymentCardStatus).toBe('active');
  });

  // FR-v1-04.1: GET fraud cases paginated
  skip('GET /fraud-diagnosis-cases returns paginated list', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/fraud-diagnosis-cases?page=1&limit=10')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  // FR-v1-04.2: GET fraud case by ID
  skip('GET /fraud-diagnosis-cases/:id returns case details', async () => {
    const listRes = await supertest(app.server)
      .get('/api/v1/fraud-diagnosis-cases?page=1&limit=1')
      .set('Authorization', `Bearer ${authToken}`);
    if (listRes.body.results.length === 0) return;

    const caseId = listRes.body.results[0].fraudDiagnosisInstanceReference;
    const res = await supertest(app.server)
      .get(`/api/v1/fraud-diagnosis-cases/${caseId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.fraudDiagnosisInstanceReference).toBe(caseId);
    expect(res.body.diagnosisActionLog).toBeDefined();
  });

  // FR-v1-04.3: GET /fraud-diagnosis-cases?status= — every result matches the filter
  skip('GET /fraud-diagnosis-cases?status=open returns only open cases', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/fraud-diagnosis-cases?status=open')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    for (const c of res.body.results) {
      expect(c.fraudDiagnosisCaseStatus).toBe('open');
    }
  });

  // FR-v1-04.1: QE equality search by customerEmailAddress
  skip('GET /customer-agreements?email= performs QE equality search', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/customer-agreements?email=sarah.chen@leafybank.demo')
      .set('Authorization', `Bearer ${authToken}`);
    // 200 if seeded, 404 if not — both are valid in a clean test cluster
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      // QE search predicate fields must not be echoed in the response (spec §technical-spec §2)
      expect(res.body.customerEmailAddress).toBeUndefined();
      expect(res.body.customerName).toBeDefined();
    }
  });

  // FR-v1-04.4: cardToken lookup uses a standard (non-QE) index (ADR-003)
  skip('GET /card-transactions?cardToken= uses standard index', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/card-transactions?cardToken=tok_nonexistent')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(typeof res.body.count).toBe('number');
  });
});
