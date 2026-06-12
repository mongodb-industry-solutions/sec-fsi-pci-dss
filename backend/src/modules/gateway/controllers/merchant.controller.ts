// BIAN SD-89: Merchant Relations  -  REST controller
// Routes mounted at /merchants → /api/v1/merchants

import { FastifyInstance } from 'fastify';
import type { JwtDemoPayload } from '../../../shared/models/identity.model';
import { getMerchants, getMerchantPicker, getMerchantById, getMerchantByOwnerPartyRef, createMerchant, updateMerchant, registerWebhook, generateApiKey, revokeApiKey, reviewMerchantApplication } from '../services/merchant.service';
import { getMerchantTransactions, getMerchantStats } from '../../transactions/services/cardTransaction.service';
import { dispatchIntegration } from '../../integrations/services/integrationDispatch.service';

export async function merchantController(fastify: FastifyInstance) {

  // GET /api/v1/merchants
  fastify.get('/', {
    schema: {
      tags: ['merchants'],
      summary: 'List merchant agreements (SD-89)',
      description: `Returns paginated list of \`merchantAgreement\` documents (BIAN SD-89).

**Filters:** \`status\` (active|suspended|closed), \`mcc\` (ISO 18245 code).

The \`merchantApiKeyHash\` field is **never** included in any GET response (PCI DSS Req 3  -  protect stored account data equivalent for gateway credentials).`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['initiated', 'under_review', 'agreed', 'active', 'amended', 'suspended', 'rejected', 'closed'], description: 'Filter by agreement status.' },
          mcc: { type: 'string', description: 'Filter by Merchant Category Code (ISO 18245).' },
          name: { type: 'string', description: 'Case-insensitive partial match on merchant name.' },
          risk: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Filter by risk category.' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
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
                  merchantAgreementStatus: { type: 'string', enum: ['initiated', 'under_review', 'agreed', 'active', 'amended', 'suspended', 'rejected', 'closed'] },
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
        403: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtDemoPayload }).user;
    // Ch-05: customers cannot list all merchants; they can only see their own via GET /:id
    if (user?.role === 'customer') {
      return reply.status(403).send({ error: 'Access denied: use GET /merchants/:id to view your own merchant.' });
    }
    const { status, mcc, name, risk, page, limit } = request.query as { status?: string; mcc?: string; name?: string; risk?: string; page?: number; limit?: number };
    const result = await getMerchants(fastify.db, { status: status as never, mcc, name, risk, page, limit });
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
          merchantOwnerPartyReference: { type: 'string', description: 'Ch-05: FK → party.partyInstanceReference (SD-13). Enables dual-role (customer + merchant).' },
          merchantWebhookEndpoint: { type: 'string', format: 'uri', description: 'HTTPS URL for payment event callbacks.' },
          merchantSettlementSchedule: { type: 'string', enum: ['T+1', 'T+2', 'T+3'], default: 'T+2' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            merchantAgreementInstanceReference: { type: 'string', description: 'UUID of the created merchant agreement.' },
            merchantName: { type: 'string' },
            merchantAgreementStatus: { type: 'string', enum: ['under_review'] },
            message: { type: 'string' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtDemoPayload }).user;
    const body = request.body as Parameters<typeof createMerchant>[1];
    if (!body.merchantName || !body.merchantCategoryCode) {
      return reply.status(400).send({ error: 'merchantName and merchantCategoryCode are required' });
    }
    // Ch-05: inject ownerPartyReference from JWT if not provided explicitly
    if (!body.merchantOwnerPartyReference && user?.partyRef) {
      body.merchantOwnerPartyReference = user.partyRef as string;
    }
    const result = await createMerchant(fastify.db, body);

    void dispatchIntegration(fastify.db, 'kyb_business', 'merchant.onboard', {
      merchantAgreementInstanceReference: result.merchantAgreementInstanceReference,
      merchantName: body.merchantName,
      merchantCategoryCode: body.merchantCategoryCode,
      merchantCountryCode: body.merchantCountryCode,
    }).catch(() => { /* fire-and-forget */ });

    return reply.status(201).send(result);
  });

  // GET /api/v1/merchants/picker
  // MUST be registered before /:id to prevent "picker" being matched as a UUID param
  fastify.get('/picker', {
    schema: {
      tags: ['merchants'],
      summary: 'Merchant picker list for payment forms (SD-89)',
      description: `Returns active merchant agreements (name + MCC + risk only) for use in payment-form dropdowns.
Accessible to any authenticated user — returns only non-sensitive business-public fields.
Supports optional name search and limit for progressive disclosure UX.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q:     { type: 'string', description: 'Case-insensitive partial name search.' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 4 },
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
                  merchantName:        { type: 'string' },
                  merchantCategoryCode: { type: 'string' },
                  merchantRiskCategory: { type: 'string', enum: ['low', 'medium', 'high'] },
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
    const { q, limit } = request.query as { q?: string; limit?: number };
    const result = await getMerchantPicker(fastify.db, { q, limit });
    return reply.send(result);
  });

  // GET /api/v1/merchants/me  — Ch-05: customer fetches their own merchant by JWT partyRef
  // MUST be registered before /:id to prevent "me" being matched as a UUID param
  fastify.get('/me', {
    schema: {
      tags: ['merchants'],
      summary: "Get current user's merchant agreement (SD-89)",
      description: `Returns the \`merchantAgreementProcedure\` owned by the authenticated user's Party (SD-13).
Returns \`{ found: false }\` when no merchant is linked to the caller's \`partyRef\`.
Used by customers to detect their onboarding state: no application / under_review / agreed / active.`,
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            found: { type: 'boolean' },
            merchant: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
              properties: {
                merchantAgreementKybCheck: {
                  type: 'object',
                  nullable: true,
                  additionalProperties: true,
                  description: 'BQ:Step — KYB check result (BIAN SD-89). PCI DSS Req 12.8.',
                },
              },
            },
          },
        },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtDemoPayload }).user;
    const partyRef = user?.partyRef;
    if (!partyRef) return reply.send({ found: false, merchant: null });
    const merchant = await getMerchantByOwnerPartyRef(fastify.db, partyRef);
    if (!merchant) return reply.send({ found: false, merchant: null });
    return reply.send({ found: true, merchant });
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
            merchantAgreementStatus: { type: 'string', enum: ['initiated', 'under_review', 'agreed', 'active', 'amended', 'suspended', 'rejected', 'closed'] },
            merchantRiskCategory: { type: 'string', enum: ['low', 'medium', 'high'] },
            merchantTransactionLimitAmount: { type: 'number' },
            merchantAverageTransactionAmount: { type: 'number' },
            merchantTransactionCount30d: { type: 'number' },
            merchantAllowedCurrencies: { type: 'array', items: { type: 'string' } },
            merchantWebhookEndpoint: { type: 'string' },
            merchantSettlementSchedule: { type: 'string', enum: ['T+1', 'T+2', 'T+3'] },
            merchantAgreementKybCheck: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
              description: 'BQ:Step — KYB check result (BIAN SD-89). PCI DSS Req 12.8.',
            },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    return reply.send(merchant);
  });

  // GET /api/v1/merchants/:id/transactions  — Acquiring-side view (BIAN SD-89)
  // Lists payments the merchant RECEIVED. PCI DSS Req 3/7: the payer's PII
  // (account reference / email / raw gateway payload) is never returned — only
  // masked PAN, amount, status, type, channel, descriptor and timestamp.
  fastify.get('/:id/transactions', {
    schema: {
      tags: ['merchants'],
      summary: 'List a merchant\'s received payments (acquiring view, SD-89)',
      description: `Returns the card transactions where this merchant was the payee, newest first.

**Authorization:** the merchant **owner** (JWT \`partyRef\` matches \`merchantOwnerPartyReference\`), a \`merchant_officer\`, or a \`security_auditor\`. Any other caller receives 403.

**PCI DSS Req 3 / Req 7 (data minimization):** the payer's PII is **never** included — no account reference, email, or raw gateway payload. Only acquiring essentials (masked PAN, amount, status, type, channel, descriptor, timestamp).`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: '`merchantAgreementInstanceReference` UUID.' } } },
      querystring: {
        type: 'object',
        properties: {
          page:   { type: 'integer', minimum: 1, default: 1 },
          limit:  { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['authorized', 'declined', 'pending', 'settled', 'disputed'], description: 'Filter by transaction status.' },
          search: { type: 'string', description: 'Case-insensitive match on masked PAN suffix, descriptor or merchant name (no PII).' },
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
                  cardTransactionInstanceReference: { type: 'string' },
                  cardTransactionAmount:            { $ref: 'MonetaryAmount#' },
                  cardTransactionDateTime:          { type: 'string', format: 'date-time' },
                  cardTransactionStatus:            { type: 'string' },
                  cardTransactionType:              { type: 'string' },
                  cardTransactionChannel:           { type: 'string' },
                  cardTransactionMerchantName:      { type: 'string' },
                  cardTransactionMaskedPanDisplay:  { type: 'string' },
                  cardTransactionDescription:       { type: 'string' },
                },
              },
            },
            total: { type: 'number' },
            page:  { type: 'number' },
            limit: { type: 'number' },
          },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page = 1, limit = 20, status, search } = request.query as { page?: number; limit?: number; status?: string; search?: string };
    const user = (request as { user?: JwtDemoPayload }).user;

    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });

    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = user?.role === 'merchant_officer' || user?.role === 'security_auditor';
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, a merchant officer, or a security auditor can view received payments.' });
    }

    const result = await getMerchantTransactions(fastify.db, id, Number(page), Number(limit), { status, search });
    return reply.send(result);
  });

  // GET /api/v1/merchants/:id/stats  — Acquiring analytics (BIAN Merchant Activity Analysis)
  // Aggregates over the merchant's received payments. No PII; same authorization as
  // /:id/transactions (owner / merchant_officer / security_auditor).
  fastify.get('/:id/stats', {
    schema: {
      tags: ['merchants'],
      summary: 'Merchant received-payments analytics (SD-89)',
      description: 'Aggregated statistics for the merchant: totals, average ticket, breakdown by status, by currency, and operations per month. Pure aggregation over plaintext fields — no payer PII.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            count:       { type: 'number' },
            totalAmount: { type: 'number' },
            avgAmount:   { type: 'number' },
            byStatus:    { type: 'array', items: { type: 'object', properties: { status: { type: 'string' }, count: { type: 'number' }, amount: { type: 'number' } } } },
            byMonth:     { type: 'array', items: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' }, count: { type: 'number' }, amount: { type: 'number' } } } },
            byCurrency:  { type: 'array', items: { type: 'object', properties: { currency: { type: 'string' }, count: { type: 'number' }, amount: { type: 'number' } } } },
          },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as { user?: JwtDemoPayload }).user;
    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = user?.role === 'merchant_officer' || user?.role === 'security_auditor';
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, a merchant officer, or a security auditor can view merchant analytics.' });
    }
    const stats = await getMerchantStats(fastify.db, id);
    return reply.send(stats);
  });

  // PATCH /api/v1/merchants/:id/review  (Ch-05 — BIAN Action Term: Control)
  fastify.patch('/:id/review', {
    schema: {
      tags: ['merchants'],
      summary: 'Approve or reject a merchant application — BIAN Action: Control (SD-89)',
      description: `**Roles:** \`merchant_officer\`, \`security_auditor\` only.

Transitions a \`merchantAgreementProcedure\` in \`under_review\` status to \`agreed\` (approve) or \`rejected\` (reject).
The reviewing officer's partyRef is recorded for audit trail.

**PCI DSS:** Req 7.1 (least privilege) — only \`merchant_officer\` role may approve/reject.
**PCI DSS:** Req 12.8 — documented agreement approval by authorized officer.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['approve', 'reject'], description: 'BIAN Control: approve → agreed; reject → rejected.' },
          reviewNote: { type: 'string', description: 'KYB outcome note for the audit trail. Required on reject.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            merchantAgreementInstanceReference: { type: 'string' },
            merchantAgreementStatus: { type: 'string', enum: ['agreed', 'rejected'] },
            merchantReviewedDateTime: { type: 'string' },
            merchantAgreementKybCheckStatus: { type: 'string', enum: ['verified', 'rejected'], description: 'BQ:Step outcome (BIAN SD-89). PCI DSS Req 12.8.' },
          },
        },
        400: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        409: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtDemoPayload }).user;
    const role = user?.role;

    // RBAC: only merchant_officer and security_auditor can review applications
    if (role !== 'merchant_officer' && role !== 'security_auditor') {
      return reply.status(403).send({ error: 'Access denied: merchant review requires merchant_officer or security_auditor role.' });
    }

    const { id } = request.params as { id: string };
    const { action, reviewNote } = request.body as { action: 'approve' | 'reject'; reviewNote?: string };

    // reviewerPartyRef: prefer JWT partyRef claim; fall back to sub
    const reviewerPartyRef = (user as { partyRef?: string })?.partyRef ?? user?.sub ?? 'unknown';

    const outcome = await reviewMerchantApplication(fastify.db, id, reviewerPartyRef, action, reviewNote);

    if (outcome === 'not_found') return reply.status(404).send({ error: 'Merchant not found' });
    if (outcome === 'invalid_status') return reply.status(409).send({ error: 'Merchant application is not in under_review status. Cannot review.' });

    const updated = await getMerchantById(fastify.db, id);
    return reply.send({
      merchantAgreementInstanceReference: id,
      merchantAgreementStatus: updated?.merchantAgreementStatus,
      merchantReviewedDateTime: updated?.merchantReviewedDateTime?.toISOString(),
      merchantAgreementKybCheckStatus: updated?.merchantAgreementKybCheck?.merchantAgreementKybCheckStatus,
    });
  });

  // PATCH /api/v1/merchants/:id
  fastify.patch('/:id', {
    schema: {
      tags: ['merchants'],
      summary: 'Update merchant configuration (SD-89)',
      description: `Partial update of a \`merchantAgreement\`. Only the provided fields are updated.
Allowed fields: \`merchantTransactionLimitAmount\`, \`merchantWebhookEndpoint\`, \`merchantSettlementSchedule\`, \`merchantAgreementStatus\`, \`merchantAllowedCurrencies\`.

**Roles:** \`merchant_officer\`, \`security_auditor\` only.`,
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
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtDemoPayload }).user;
    if (user?.role !== 'merchant_officer' && user?.role !== 'security_auditor') {
      return reply.status(403).send({ error: 'Access denied: merchant configuration update requires merchant_officer or security_auditor role.' });
    }
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    const result = await updateMerchant(fastify.db, id, patch as never);
    if (!result) return reply.status(404).send({ error: 'Merchant not found' });
    return reply.send(result);
  });

  // POST /api/v1/merchants/:id/webhooks
  fastify.post('/:id/webhooks', {
    schema: {
      tags: ['merchants'],
      summary: 'Register a webhook endpoint for a merchant (SD-89)',
      description: `Registers or updates the HTTPS webhook URL for payment event notifications.
The PSP delivers \`POST\` callbacks on: \`payment.authorized\`, \`payment.captured\`, \`payment.refunded\`, \`payment.voided\`.
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
    const result = await registerWebhook(fastify.db, id, webhookEndpoint);
    if (!result) return reply.status(404).send({ error: 'Merchant not found' });
    return reply.send(result);
  });

  // POST /api/v1/merchants/:id/keys
  fastify.post('/:id/keys', {
    schema: {
      tags: ['merchants'],
      summary: 'Generate a new API key for a merchant (SD-89)',
      description: `Generates a new API key (\`lbpk_live_<32hex>\`) for the specified merchant.

**Security:** The plaintext key is returned **once** in this response. Only a bcrypt hash is stored. Store the key securely immediately - it cannot be retrieved again.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        201: {
          type: 'object',
          properties: {
            keyId: { type: 'string', description: 'UUID to reference this key (for revocation).' },
            keyPrefix: { type: 'string', description: 'First 12 chars for display: "lbpk_live_ab".' },
            merchantApiKey: { type: 'string', description: 'Full API key. Store securely. Shown once only.' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await generateApiKey(fastify.db, id);
    if (!result) return reply.status(404).send({ error: 'Merchant not found' });
    return reply.status(201).send(result);
  });

  // DELETE /api/v1/merchants/:id/keys/:keyId
  fastify.delete('/:id/keys/:keyId', {
    schema: {
      tags: ['merchants'],
      summary: 'Revoke a merchant API key (SD-89)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'keyId'],
        properties: { id: { type: 'string' }, keyId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { revoked: { type: 'boolean' }, keyId: { type: 'string' } },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id, keyId } = request.params as { id: string; keyId: string };
    const result = await revokeApiKey(fastify.db, id, keyId);
    if (result === 'not_found') return reply.status(404).send({ error: 'Merchant or key not found' });
    return reply.send({ revoked: true, keyId });
  });
}
