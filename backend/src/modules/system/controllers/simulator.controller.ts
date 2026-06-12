// Simulator endpoints — non-production only, no JWT required
// Routes mounted at /system/simulator → /api/v1/system/simulator

import { FastifyInstance } from 'fastify';
import { createCheckoutSession } from '../../gateway/services/checkout.service';
import { createPaymentLink } from '../../gateway/services/paymentLink.service';
import { getMerchantById } from '../../gateway/services/merchant.service';
import { CARD_TRANSACTION_COLLECTION } from '../../transactions/models/cardTransaction.model';
import { resolveCustomerAgreement } from '../../transactions/services/cardTransaction.service';
import { getDbForRole } from '../../../vendors/encryption/roleClients';

export async function simulatorController(fastify: FastifyInstance) {

  // Guard: all simulator routes are blocked in production
  fastify.addHook('onRequest', async (_req, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Not available in production' });
    }
  });

  const getSimulatorMerchant = async (merchantId: string) => {
    const merchant = await getMerchantById(fastify.db, merchantId);
    if (!merchant) throw Object.assign(new Error('Simulator merchant not configured'), { code: 500 });
    return { merchantId, merchant: merchant as Record<string, unknown> };
  };

  // POST /api/v1/system/simulator/checkout-session
  fastify.post('/checkout-session', {
    schema: {
      tags: ['system'],
      summary: 'Create a simulator checkout session (non-production)',
      description: 'Creates a checkout session pre-filled with the simulator merchant. No JWT required. Blocked in production.',
      body: {
        type: 'object',
        required: ['merchantId', 'amount', 'currency', 'description', 'returnUrl', 'cancelUrl', 'merchantReference'],
        properties: {
          merchantId: { type: 'string', description: 'Simulator merchant UUID (from frontend simulator.json)' },
          amount: { type: 'number', minimum: 0.01 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          description: { type: 'string', maxLength: 255 },
          returnUrl: { type: 'string' },
          cancelUrl: { type: 'string' },
          merchantReference: { type: 'string', maxLength: 100 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            checkoutSessionInstanceReference: { type: 'string' },
            paymentPageUrl: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
        500: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      merchantId: string;
      amount: number;
      currency: string;
      description: string;
      returnUrl: string;
      cancelUrl: string;
      merchantReference: string;
    };

    const { merchantId, merchant } = await getSimulatorMerchant(body.merchantId);
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    const result = await createCheckoutSession(fastify.db, {
      merchantAgreementInstanceReference: merchantId,
      merchantName: merchant.merchantName as string,
      merchantCategoryCode: merchant.merchantCategoryCode as string,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      returnUrl: body.returnUrl,
      cancelUrl: body.cancelUrl,
      merchantReference: body.merchantReference,
    }, baseUrl);

    return reply.status(201).send({
      checkoutSessionInstanceReference: result.checkoutSessionInstanceReference,
      paymentPageUrl: result.paymentPageUrl,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  // POST /api/v1/system/simulator/payment-link
  fastify.post('/payment-link', {
    schema: {
      tags: ['system'],
      summary: 'Create a simulator payment link (non-production)',
      description: 'Creates a payment link pre-filled with the simulator merchant. No JWT required. Blocked in production.',
      body: {
        type: 'object',
        required: ['merchantId', 'amount', 'currency', 'description', 'usageType'],
        properties: {
          merchantId: { type: 'string', description: 'Simulator merchant UUID (from frontend simulator.json)' },
          amount: { type: 'number', minimum: 0.01 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          description: { type: 'string', maxLength: 255 },
          customerMessage: { type: 'string', maxLength: 500 },
          usageType: { type: 'string', enum: ['single_use', 'multi_use'] },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            paymentLinkInstanceReference: { type: 'string' },
            paymentLinkCode: { type: 'string' },
            paymentUrl: { type: 'string' },
          },
        },
        500: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      merchantId: string;
      amount: number;
      currency: string;
      description: string;
      customerMessage?: string;
      usageType: 'single_use' | 'multi_use';
    };

    const { merchantId, merchant } = await getSimulatorMerchant(body.merchantId);
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    const result = await createPaymentLink(fastify.db, {
      merchantAgreementInstanceReference: merchantId,
      merchantName: merchant.merchantName as string,
      merchantCategoryCode: merchant.merchantCategoryCode as string,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      customerMessage: body.customerMessage,
      usageType: body.usageType,
    }, baseUrl);

    return reply.status(201).send(result);
  });

  // GET /api/v1/system/simulator/transactions/:email
  fastify.get('/transactions/:email', {
    schema: {
      tags: ['system'],
      summary: 'List transactions for a customer email (non-production)',
      description: 'Returns recent transactions linked to the given email (accountReference). Used by the simulator to show payment history.',
      params: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', description: 'Customer email (URL-encoded).' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20, maximum: 50 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            transactions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cardTransactionInstanceReference: { type: 'string' },
                  cardTransactionDateTime: { type: 'string', format: 'date-time' },
                  cardTransactionMerchantName: { type: 'string' },
                  cardTransactionAmount: {
                    type: 'object',
                    properties: {
                      amount: { type: 'number' },
                      currency: { type: 'string' },
                    },
                  },
                  cardTransactionStatus: { type: 'string' },
                  cardTransactionMaskedPanDisplay: { type: 'string' },
                  fraudDiagnosisInstanceReference: { type: 'string', nullable: true },
                },
              },
            },
            total: { type: 'number' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { email } = request.params as { email: string };
    const { limit = 20 } = request.query as { limit?: number };

    // Transactions store the canonical account reference (ACC-xxx). Resolve the
    // payer email to that reference, then match cardTransactionAccountReference
    // (QE:equality) — must use a QE-capable client to build the equality token.
    const l1Db = await getDbForRole('level1_analyst', false);
    const resolved = await resolveCustomerAgreement(fastify.db, email);
    const accRef = resolved.reference ?? email;
    const transactions = await l1Db
      .collection(CARD_TRANSACTION_COLLECTION)
      .find({ cardTransactionAccountReference: accRef })
      .sort({ cardTransactionDateTime: -1 })
      .limit(Math.min(limit, 50))
      .toArray();

    return reply.send({
      transactions: transactions.map(t => ({
        cardTransactionInstanceReference: t.cardTransactionInstanceReference,
        cardTransactionDateTime: t.cardTransactionDateTime,
        cardTransactionMerchantName: t.cardTransactionMerchantName,
        cardTransactionAmount: t.cardTransactionAmount,
        cardTransactionStatus: t.cardTransactionStatus,
        cardTransactionMaskedPanDisplay: t.cardTransactionMaskedPanDisplay,
        fraudDiagnosisInstanceReference: t.fraudDiagnosisInstanceReference ?? null,
      })),
      total: transactions.length,
    });
  });
}
