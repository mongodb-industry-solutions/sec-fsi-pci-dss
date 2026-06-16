// BIAN SD-64: Payment Order - Payment Link REST controller
// Routes mounted at /payment/links → /api/v1/payment/links

import { FastifyInstance } from 'fastify';
import {
  createPaymentLink,
  resolvePaymentLink,
  processLinkPayment,
  deactivatePaymentLink,
  listPaymentLinks,
} from '../services/paymentLink.service';
import { getMerchantById } from '../services/merchant.service';
import { deliverWebhook } from '../services/webhook.service';

const LINK_STATUS_ENUM = ['active', 'completed', 'expired', 'deactivated'];
const USAGE_TYPE_ENUM = ['single_use', 'multi_use'];

export async function paymentLinkController(fastify: FastifyInstance) {

  // POST /api/v1/payment-links
  fastify.post('/', {
    schema: {
      tags: ['payment:links'],
      summary: 'Create a payment link',
      description: `Creates a shareable payment link. The returned \`paymentUrl\` (/pay/{code}) can be shared via email, QR code, or embedded in a web page.

**Integration flow:**
1. Merchant calls this endpoint with payment details
2. Receives \`paymentUrl\` - share this however needed
3. Buyer opens the URL and completes payment on the PSP-hosted payment page
4. Merchant is notified via webhook (if configured)

**Usage types:**
- \`single_use\`: Link becomes inactive after first successful payment (invoice-style)
- \`multi_use\`: Link stays active for multiple payments (store button style)

**PCI DSS:** SAQ A - buyer enters card details on the PSP domain, not the merchant's.`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['merchantAgreementInstanceReference', 'amount', 'currency', 'description', 'usageType'],
        properties: {
          merchantAgreementInstanceReference: { type: 'string', description: 'Merchant UUID from SD-89.' },
          amount: { type: 'number', minimum: 0.01 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          description: { type: 'string', maxLength: 255 },
          customerMessage: { type: 'string', maxLength: 500, description: 'Optional message shown to the buyer on the payment page.' },
          usageType: { type: 'string', enum: USAGE_TYPE_ENUM },
          maxUses: { type: 'number', minimum: 1, description: 'Maximum number of uses (multi_use only).' },
          expiresAt: { type: 'string', format: 'date-time', description: 'Optional ISO 8601 expiry date.' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            paymentLinkInstanceReference: { type: 'string', description: 'UUID for management operations.' },
            paymentLinkCode: { type: 'string', description: 'Short code for the URL.' },
            paymentUrl: { type: 'string', description: 'Share this URL with buyers.' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      merchantAgreementInstanceReference: string;
      amount: number;
      currency: string;
      description: string;
      customerMessage?: string;
      usageType: 'single_use' | 'multi_use';
      maxUses?: number;
      expiresAt?: string;
    };

    const merchant = await getMerchantById(fastify.db, body.merchantAgreementInstanceReference);
    if (!merchant) {
      return reply.status(404).send({ error: 'Merchant not found' });
    }

    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    const result = await createPaymentLink(fastify.db, {
      merchantAgreementInstanceReference: body.merchantAgreementInstanceReference,
      merchantName: (merchant as Record<string, unknown>).merchantName as string,
      merchantCategoryCode: (merchant as Record<string, unknown>).merchantCategoryCode as string,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      customerMessage: body.customerMessage,
      usageType: body.usageType,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    }, baseUrl);

    return reply.status(201).send(result);
  });

  // GET /api/v1/payment-links
  fastify.get('/', {
    schema: {
      tags: ['payment:links'],
      summary: 'List payment links',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          merchantId: { type: 'string', description: 'Filter by merchant UUID.' },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  paymentLinkInstanceReference: { type: 'string' },
                  paymentLinkCode: { type: 'string' },
                  paymentLinkAmount: { type: 'number' },
                  paymentLinkCurrency: { type: 'string' },
                  paymentLinkDescription: { type: 'string' },
                  paymentLinkStatus: { type: 'string', enum: LINK_STATUS_ENUM },
                  paymentLinkUsageType: { type: 'string', enum: USAGE_TYPE_ENUM },
                  paymentLinkCurrentUses: { type: 'number' },
                  paymentLinkCreatedDateTime: { type: 'string', format: 'date-time' },
                  paymentLinkExpiresAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
            total: { type: 'number' },
          },
        },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const query = request.query as { merchantId?: string; page?: number; limit?: number };
    const merchantId = query.merchantId ?? '';
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);

    const { results, total } = await listPaymentLinks(fastify.db, merchantId, page, limit);
    return reply.send({ results, total });
  });

  // GET /api/v1/payment-links/:code  (public - no auth)
  fastify.get('/:code', {
    schema: {
      tags: ['payment:links'],
      summary: 'Resolve a payment link by code (public)',
      description: 'Returns payment display data for the payment page. Never exposes internal merchant IDs or hashes.',
      params: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', description: '8-char payment link code.' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentLinkCode: { type: 'string' },
            paymentLinkAmount: { type: 'number' },
            paymentLinkCurrency: { type: 'string' },
            paymentLinkDescription: { type: 'string' },
            merchantName: { type: 'string' },
            paymentLinkCustomerMessage: { type: 'string', nullable: true },
            paymentLinkStatus: { type: 'string', enum: LINK_STATUS_ENUM },
            paymentLinkExpiresAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const link = await resolvePaymentLink(fastify.db, code);
    if (!link) return reply.status(404).send({ error: 'Payment link not found' });
    return reply.send(link);
  });

  // POST /api/v1/payment-links/:code/pay  (public)
  fastify.post('/:code/pay', {
    schema: {
      tags: ['payment:links'],
      summary: 'Process payment via payment link (public)',
      description: 'Called by the payment link page after buyer submits card form. Card data is tokenized client-side before this call.',
      params: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['cardToken', 'cardholderName', 'cardExpiryMonth', 'cardExpiryYear'],
        properties: {
          cardToken: { type: 'string' },
          cardholderName: { type: 'string', minLength: 1, maxLength: 100 },
          cardExpiryMonth: { type: 'string', pattern: '^(0[1-9]|1[0-2])$' },
          cardExpiryYear: { type: 'string', pattern: '^20[2-9][0-9]$' },
          customerEmail: { type: 'string', format: 'email', description: 'Optional: link payment to customer record.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cardTransactionInstanceReference: { type: 'string' },
            fraudDiagnosisInstanceReference: { type: 'string', nullable: true },
          },
        },
        404: { $ref: 'Error#' },
        402: { description: 'Card authorization declined.', $ref: 'Error#' },
        410: { description: 'Link expired, completed, or deactivated.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const body = request.body as {
      cardToken: string;
      cardholderName: string;
      cardExpiryMonth: string;
      cardExpiryYear: string;
      customerEmail?: string;
      cardAuthOutcome?: 'approved' | 'declined' | 'challenge';
    };

    const { result, cardTransactionInstanceReference, fraudDiagnosisInstanceReference } = await processLinkPayment(fastify.db, {
      linkCode: code,
      cardToken: body.cardToken,
      cardholderName: body.cardholderName,
      cardExpiryMonth: body.cardExpiryMonth,
      cardExpiryYear: body.cardExpiryYear,
      customerEmail: body.customerEmail,
      cardAuthOutcome: body.cardAuthOutcome,
    });

    if (result === 'not_found') return reply.status(404).send({ error: 'Payment link not found' });
    if (result === 'expired') return reply.status(410).send({ error: 'Payment link has expired' });
    if (result === 'deactivated') return reply.status(410).send({ error: 'Payment link is no longer active' });
    if (result === 'completed') return reply.status(410).send({ error: 'This payment link has already been used' });
    if (result === 'declined') return reply.status(402).send({ error: 'Card authorization declined', code: '0190' });

    // Fire webhook asynchronously
    if (result === 'ok') {
      const link = await resolvePaymentLink(fastify.db, code);
      if (link) {
        const merchantDoc = await fastify.db
          .collection('merchantAgreementProcedure')
          .findOne({ merchantName: link.merchantName }) as Record<string, unknown> | null;
        if (merchantDoc?.merchantWebhookEndpoint && merchantDoc?.merchantWebhookSecret) {
          const maskedPan = `****-****-****-${body.cardToken.slice(-4).padStart(4, '0')}`;
          deliverWebhook(
            merchantDoc.merchantWebhookEndpoint as string,
            {
              event: 'payment_link.completed',
              timestamp: new Date().toISOString(),
              data: {
                paymentLinkCode: code,
                cardTransactionInstanceReference,
                fraudDiagnosisInstanceReference: fraudDiagnosisInstanceReference ?? null,
                fraudCaseCreated: !!fraudDiagnosisInstanceReference,
                cardToken: body.cardToken,
                maskedPan,
                amount: link.paymentLinkAmount,
                currency: link.paymentLinkCurrency,
              },
            },
            merchantDoc.merchantWebhookSecret as string
          ).catch(() => {});
        }
      }
    }

    return reply.send({ success: true, cardTransactionInstanceReference, fraudDiagnosisInstanceReference: fraudDiagnosisInstanceReference ?? null });
  });

  // PATCH /api/v1/payment-links/:id
  fastify.patch('/:id', {
    schema: {
      tags: ['payment:links'],
      summary: 'Update or deactivate a payment link',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'paymentLinkInstanceReference UUID.' } },
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['deactivate'], description: 'Action to perform on the link.' },
          merchantAgreementInstanceReference: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentLinkInstanceReference: { type: 'string' },
            paymentLinkStatus: { type: 'string', enum: LINK_STATUS_ENUM },
          },
        },
        400: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { action: string; merchantAgreementInstanceReference?: string };
    const merchantId = body.merchantAgreementInstanceReference ?? '';

    if (body.action === 'deactivate') {
      const result = await deactivatePaymentLink(fastify.db, id, merchantId);
      if (result === 'not_found') return reply.status(404).send({ error: 'Payment link not found' });
      if (result === 'wrong_merchant') return reply.status(403).send({ error: 'Merchant does not own this link' });
      return reply.send({ paymentLinkInstanceReference: id, paymentLinkStatus: 'deactivated' });
    }

    return reply.status(400).send({ error: 'Unknown action' });
  });
}
