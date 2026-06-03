// BIAN SD-89: Merchant Relations — REST controller
// Routes mounted at /merchants → /api/v1/merchants

import { FastifyInstance } from 'fastify';
import { getMerchants, getMerchantById, createMerchant, updateMerchant, registerWebhook } from '../services/merchant.service';

export async function merchantController(fastify: FastifyInstance) {

  // GET /api/v1/merchants
  fastify.get('/', {
    schema: {
      tags: ['merchants'],
      summary: 'List merchant agreements (SD-89)',
      description: `Returns paginated list of \`merchantAgreement\` documents (BIAN SD-89).

**Filters:** \`status\` (active|suspended|closed), \`mcc\` (ISO 18245 code).

The \`merchantApiKeyHash\` field is **never** included in any GET response (PCI DSS Req 3 — protect stored account data equivalent for gateway credentials).`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'suspended', 'closed'], description: 'Filter by agreement status.' },
          mcc: { type: 'string', description: 'Filter by Merchant Category Code (ISO 18245).' },
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
                  merchantAgreementInstanceReference: { type: 'string' },
                  merchantName: { type: 'string' },
                  merchantCategoryCode: { type: 'string' },
                  merchantCountryCode: { type: 'string' },
                  merchantAgreementStatus: { type: 'string', enum: ['active', 'suspended', 'closed'] },
                  merchantRiskCategory: { type: 'string', enum: ['low', 'medium', 'high'] },
                  merchantTransactionLimitAmount: { type: 'number' },
                  merchantAverageTransactionAmount: { type: 'number' },
                  merchantTransactionCount30d: { type: 'number' },
                  merchantSettlementSchedule: { type: 'string', enum: ['T+1', 'T+2', 'T+3'] },
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
    const { status, mcc } = request.query as { status?: string; mcc?: string };
    const result = await getMerchants({ status: status as never, mcc });
    return reply.send(result);
  });

  // POST /api/v1/merchants
  fastify.post('/', {
    schema: {
      tags: ['merchants'],
      summary: 'Onboard a new merchant (SD-89)',
      description: `Creates a \`merchantAgreement\` document (BIAN SD-89).

**Security:** The \`merchantApiKey\` is returned **once** in this response and never stored in plaintext thereafter. The hash is stored as \`merchantApiKeyHash\` with QE:none (encrypted at rest, not searchable).

**PCI DSS:** The API key hash qualifies as operationally sensitive credential. QE:none ensures Atlas never sees the plaintext hash.

**v5 note:** This prototype returns a stub response. Full v5 implementation persists to MongoDB with QE:none on \`merchantApiKeyHash\`.`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['merchantName', 'merchantLegalEntityReference', 'merchantCategoryCode', 'merchantCountryCode'],
        properties: {
          merchantName: { type: 'string', description: 'Legal trading name of the merchant.' },
          merchantLegalEntityReference: { type: 'string', description: 'Tax ID / company registration number.' },
          merchantCategoryCode: { type: 'string', description: 'ISO 18245 MCC code (4 digits). Determines risk category.' },
          merchantCountryCode: { type: 'string', description: 'ISO 3166-1 alpha-2 country code.' },
          merchantTier: { type: 'string', enum: ['standard', 'enterprise'], default: 'standard' },
          merchantAllowedCurrencies: { type: 'array', items: { type: 'string' }, description: 'ISO 4217 currency codes the merchant may accept.' },
          merchantTransactionLimitAmount: { type: 'number', description: 'Maximum per-transaction amount in the settlement currency.' },
          merchantWebhookEndpoint: { type: 'string', format: 'uri', description: 'HTTPS URL for payment event callbacks.' },
          merchantSettlementSchedule: { type: 'string', enum: ['T+1', 'T+2', 'T+3'], default: 'T+2' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            merchantAgreementInstanceReference: { type: 'string', description: 'UUID of the created merchant agreement. Use in /gateway/payments.' },
            merchantName: { type: 'string' },
            merchantAgreementStatus: { type: 'string', enum: ['active'] },
            merchantApiKey: { type: 'string', description: '⚠️ Shown once. Store securely. Subsequent requests require this key in the X-Merchant-Api-Key header.' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as Parameters<typeof createMerchant>[0];
    if (!body.merchantName || !body.merchantCategoryCode) {
      return reply.status(400).send({ error: 'merchantName and merchantCategoryCode are required' });
    }
    const result = await createMerchant(body);
    return reply.status(201).send(result);
  });

  // GET /api/v1/merchants/:id
  fastify.get('/:id', {
    schema: {
      tags: ['merchants'],
      summary: 'Get merchant agreement by ID (SD-89)',
      description: `Returns a \`merchantAgreement\` document by UUID. The \`merchantApiKeyHash\` is **never** returned.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: '`merchantAgreementInstanceReference` UUID.' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            merchantAgreementInstanceReference: { type: 'string' },
            merchantName: { type: 'string' },
            merchantCategoryCode: { type: 'string' },
            merchantCountryCode: { type: 'string' },
            merchantAgreementStatus: { type: 'string', enum: ['active', 'suspended', 'closed'] },
            merchantRiskCategory: { type: 'string', enum: ['low', 'medium', 'high'] },
            merchantTransactionLimitAmount: { type: 'number' },
            merchantAverageTransactionAmount: { type: 'number' },
            merchantTransactionCount30d: { type: 'number' },
            merchantAllowedCurrencies: { type: 'array', items: { type: 'string' } },
            merchantWebhookEndpoint: { type: 'string' },
            merchantSettlementSchedule: { type: 'string', enum: ['T+1', 'T+2', 'T+3'] },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const merchant = await getMerchantById(id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    return reply.send(merchant);
  });

  // PATCH /api/v1/merchants/:id
  fastify.patch('/:id', {
    schema: {
      tags: ['merchants'],
      summary: 'Update merchant configuration (SD-89)',
      description: `Partial update of a \`merchantAgreement\`. Only the provided fields are updated.
Allowed fields: \`merchantTransactionLimitAmount\`, \`merchantWebhookEndpoint\`, \`merchantSettlementSchedule\`, \`merchantAgreementStatus\`, \`merchantAllowedCurrencies\`.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          merchantTransactionLimitAmount: { type: 'number' },
          merchantWebhookEndpoint: { type: 'string', format: 'uri' },
          merchantSettlementSchedule: { type: 'string', enum: ['T+1', 'T+2', 'T+3'] },
          merchantAgreementStatus: { type: 'string', enum: ['active', 'suspended', 'closed'] },
          merchantAllowedCurrencies: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Updated merchant agreement (partial).' },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    const result = await updateMerchant(id, patch as never);
    if (!result) return reply.status(404).send({ error: 'Merchant not found' });
    return reply.send(result);
  });

  // POST /api/v1/merchants/:id/webhooks
  fastify.post('/:id/webhooks', {
    schema: {
      tags: ['merchants'],
      summary: 'Register a webhook endpoint for a merchant (SD-89)',
      description: `Registers or updates the HTTPS webhook URL for payment event notifications.
The gateway delivers \`POST\` callbacks on: \`payment.authorized\`, \`payment.captured\`, \`payment.refunded\`, \`payment.voided\`.
Delivery includes up to 3 retry attempts with exponential backoff.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: '`merchantAgreementInstanceReference`' } } },
      body: {
        type: 'object',
        required: ['webhookEndpoint'],
        properties: {
          webhookEndpoint: { type: 'string', format: 'uri', description: 'HTTPS URL to receive payment event callbacks.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            merchantAgreementInstanceReference: { type: 'string' },
            merchantWebhookEndpoint: { type: 'string' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { webhookEndpoint } = request.body as { webhookEndpoint: string };
    if (!webhookEndpoint) return reply.status(400).send({ error: 'webhookEndpoint is required' });
    const result = await registerWebhook(id, webhookEndpoint);
    if (!result) return reply.status(404).send({ error: 'Merchant not found' });
    return reply.send(result);
  });
}
