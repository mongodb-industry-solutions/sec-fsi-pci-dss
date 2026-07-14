// BIAN SD-89: Merchant Relations  -  REST controller
// Routes mounted at /merchants → /api/v1/merchants

import { FastifyInstance } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { getMerchants, getMerchantPicker, getMerchantById, getMerchantByOwnerPartyRef, createMerchant, updateMerchant, registerWebhook, sendTestWebhook, generateApiKey, importApiKey, updateApiKeyLabel, revokeApiKey, reviewMerchantApplication, getMerchantEvents, getMerchantApiKeys, appendMerchantEvent } from '../services/merchant.service';
import { emitComplianceEvent, listMerchantActivity } from '../../provider/services/businessProcessEvent.service';
import { listMerchantAuthorizations } from '../../identity/services/oauth.service';
import { getPayoutAccount } from '../services/payoutAccount.service';
import { issueMerchantOAuthClient, revokeMerchantOAuthClient, rotateMerchantOAuthClientSecret, updateMerchantOAuthClient } from '../services/merchantOAuth.service';
import { WebhookService } from '../services/merchantWebhook.service';
import type { WebhookEventType } from '../models/merchantAgreement.model';
import { getMerchantTransactions, getMerchantTransactionById, getMerchantStats } from '../../transaction/services/cardTransaction.service';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';

// Roles allowed to READ a merchant's business detail (profile, payments, analytics, audit trail).
// PSP staff: `merchant_officer` and `security_auditor`. Fraud-investigation roles
// (`level1_analyst`, `level2_investigator`) need this in the context of a case (SD-89 Merchant
// Relations is referenced from SD-83 Fraud Diagnosis) — PCI DSS Req 7 still excludes the
// administrative `manager` role, which has no business need-to-know. Credential routes (API keys)
// keep the stricter officer/auditor/owner set and are NOT widened here.
const MERCHANT_DETAIL_READ_ROLES = new Set([
  'merchant_officer', 'security_auditor', 'level1_analyst', 'level2_investigator',
]);

// Authorization verdict for API-key MUTATIONS (generate/import/revoke/relabel): the merchant
// **owner** (JWT partyRef matches merchantOwnerPartyReference) or a `merchant_officer`. The
// `security_auditor` may view keys (read-only) but never mutate credentials.
async function checkKeyMutationAccess(
  fastify: FastifyInstance,
  merchantId: string,
  user?: JwtUserPayload,
): Promise<{ ok: true } | { status: 403 | 404; error: string }> {
  const merchant = await getMerchantById(fastify.db, merchantId) as Record<string, unknown> | null;
  if (!merchant) return { status: 404, error: 'Merchant not found' };
  const isOwner = !!user?.partyRef && merchant.merchantOwnerPartyReference === user.partyRef;
  const isOfficer = user?.role === 'merchant_officer';
  if (!isOwner && !isOfficer) {
    return { status: 403, error: 'Access denied: only the merchant owner or a merchant officer can manage API keys.' };
  }
  return { ok: true };
}

// Authorization verdict for OAuth client MUTATIONS: the merchant owner, a merchant_officer,
// or system_admin. Mirrors checkKeyMutationAccess but extends to system_admin since OAuth
// client registration is a platform-level configuration action (ADR-037).
async function checkOAuthClientAccess(
  fastify: FastifyInstance,
  merchantId: string,
  user?: JwtUserPayload,
): Promise<{ ok: true } | { status: 403 | 404; error: string }> {
  const merchant = await getMerchantById(fastify.db, merchantId) as Record<string, unknown> | null;
  if (!merchant) return { status: 404, error: 'Merchant not found' };
  const isOwner = !!user?.partyRef && merchant.merchantOwnerPartyReference === user.partyRef;
  const isPrivileged = user?.role === 'merchant_officer' || user?.role === 'manager';
  if (!isOwner && !isPrivileged) {
    return { status: 403, error: 'Access denied: only the merchant owner, a merchant officer, or a system admin can manage OAuth client configuration.' };
  }
  return { ok: true };
}

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
          mine: { type: 'boolean', description: 'When true, restrict results to the caller\'s own merchants regardless of role.' },
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
    const user = (request as { user?: JwtUserPayload }).user;
    const { status, mcc, name, risk, page, limit, mine } = request.query as { status?: string; mcc?: string; name?: string; risk?: string; page?: number; limit?: number; mine?: boolean };
    // Customers see only their own merchants; mine=true scopes any role to their own records
    const ownerPartyRef = (user?.role === 'customer' || mine) ? (user?.partyRef ?? undefined) : undefined;
    const result = await getMerchants(fastify.db, { status: status as never, mcc, name, risk, page, limit, ownerPartyRef });
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
    const user = (request as { user?: JwtUserPayload }).user;
    const body = request.body as Parameters<typeof createMerchant>[1];
    if (!body.merchantName || !body.merchantCategoryCode) {
      return reply.status(400).send({ error: 'merchantName and merchantCategoryCode are required' });
    }
    // Ch-05: inject ownerPartyReference from JWT if not provided explicitly
    if (!body.merchantOwnerPartyReference && user?.partyRef) {
      body.merchantOwnerPartyReference = user.partyRef as string;
    }
    const result = await createMerchant(fastify.db, body);

    void dispatchProvider(fastify.db, 'kyb_business', 'kyb.validation.requested', {
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
    const user = (request as { user?: JwtUserPayload }).user;
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
            merchantOwnerPartyReference: { type: 'string', nullable: true, description: 'FK → party.partyInstanceReference (SD-13). Enables owner self-service (settings, payout account).' },
            merchantDefaultPayoutAccountReference: { type: 'string', nullable: true, description: 'FK → payoutAccountArrangement (SD-66). Settlement destination for this merchant.' },
            merchantTier: { type: 'string', nullable: true },
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
          page:      { type: 'integer', minimum: 1, default: 1 },
          limit:     { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status:    { type: 'string', enum: ['authorized', 'declined', 'pending', 'settled', 'disputed'], description: 'Filter by transaction status.' },
          search:    { type: 'string', description: 'Case-insensitive match on masked PAN suffix, descriptor or merchant name (no PII).' },
          txnId:     { type: 'string', description: 'Exact match on cardTransactionInstanceReference (UUID).' },
          cardToken: { type: 'string', description: 'Exact match on paymentCardReference (token surrogate, not CHD).' },
          dateFrom:  { type: 'string', format: 'date-time', description: 'Inclusive lower bound on cardTransactionDateTime (ISO 8601).' },
          dateTo:    { type: 'string', format: 'date-time', description: 'Inclusive upper bound on cardTransactionDateTime (ISO 8601).' },
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
                  paymentCardReference:              { type: 'string' },
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
    const { page = 1, limit = 20, status, search, txnId, cardToken, dateFrom, dateTo } = request.query as {
      page?: number; limit?: number; status?: string; search?: string;
      txnId?: string; cardToken?: string; dateFrom?: string; dateTo?: string;
    };
    const user = (request as { user?: JwtUserPayload }).user;

    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });

    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = MERCHANT_DETAIL_READ_ROLES.has(user?.role ?? '');
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, PSP staff, or a fraud investigator can view received payments.' });
    }

    const result = await getMerchantTransactions(fastify.db, id, Number(page), Number(limit), { status, search, txnId, cardToken, dateFrom, dateTo });
    return reply.send(result);
  });

  // GET /api/v1/merchants/:id/transactions/:tid  — Single transaction detail (acquiring-side)
  // PCI DSS Req 3/7: same data-minimization projection as the list — no payer PII.
  fastify.get('/:id/transactions/:tid', {
    schema: {
      tags: ['merchants'],
      summary: 'Single merchant transaction detail (acquiring view, SD-89)',
      description: `Returns a single card transaction where this merchant was the payee.

**Authorization:** same as the list endpoint — merchant owner, \`merchant_officer\`, or \`security_auditor\`.

**PCI DSS Req 3 / Req 7 (data minimization):** the payer's PII is **never** included.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'tid'],
        properties: {
          id:  { type: 'string', description: '`merchantAgreementInstanceReference` UUID.' },
          tid: { type: 'string', description: '`cardTransactionInstanceReference` UUID.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            cardTransactionInstanceReference: { type: 'string' },
            cardTransactionAmount:            { $ref: 'MonetaryAmount#' },
            cardTransactionDateTime:          { type: 'string', format: 'date-time' },
            cardTransactionStatus:            { type: 'string' },
            cardTransactionType:              { type: 'string' },
            cardTransactionChannel:           { type: 'string' },
            cardTransactionInitiationType:    { type: 'string' },
            cardTransactionMerchantName:      { type: 'string' },
            cardTransactionMerchantCategoryCode: { type: 'string' },
            cardTransactionMaskedPanDisplay:  { type: 'string' },
            cardTransactionDescription:       { type: 'string' },
            cardTransactionNarrative:         { type: 'string' },
            paymentCardReference:             { type: 'string' },
            merchantAgreementInstanceReference: { type: 'string' },
          },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id, tid } = request.params as { id: string; tid: string };
    const user = (request as { user?: JwtUserPayload }).user;

    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });

    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = MERCHANT_DETAIL_READ_ROLES.has(user?.role ?? '');
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const txn = await getMerchantTransactionById(fastify.db, id, tid);
    if (!txn) return reply.status(404).send({ error: 'Transaction not found for this merchant' });
    return reply.send(txn);
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
            commissionRevenue: {
              type: 'object',
              description: 'v18: merchant commission revenue (SD-89) aggregated from paymentExecution fee attribution (SD-65).',
              properties: {
                total:   { type: 'number' },
                count:   { type: 'number' },
                byMonth: { type: 'array', items: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' }, count: { type: 'number' }, amount: { type: 'number' } } } },
              },
            },
          },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as { user?: JwtUserPayload }).user;
    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = MERCHANT_DETAIL_READ_ROLES.has(user?.role ?? '');
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, PSP staff, or a fraud investigator can view merchant analytics.' });
    }
    const stats = await getMerchantStats(fastify.db, id);
    return reply.send(stats);
  });

  // GET /api/v1/merchants/:id/events  — Merchant lifecycle audit trail (SD-89, PCI DSS Req 10)
  // Append-only log of submitted / approved / rejected / updated actions. No PII.
  // Same authorization as /:id/transactions (owner / merchant_officer / security_auditor).
  fastify.get('/:id/events', {
    schema: {
      tags: ['merchants'],
      summary: 'Merchant lifecycle audit trail (SD-89, Req 10)',
      description: 'Append-only event log of merchant relationship actions (submitted, approved, rejected, KYB, config updates). Operational metadata only — no cardholder data.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  merchantAgreementEventInstanceReference: { type: 'string' },
                  eventType:                 { type: 'string' },
                  eventDateTime:             { type: 'string', format: 'date-time' },
                  performedByPartyReference: { type: 'string' },
                  performedByRole:           { type: 'string' },
                  details:                   { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as { user?: JwtUserPayload }).user;
    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = MERCHANT_DETAIL_READ_ROLES.has(user?.role ?? '');
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, PSP staff, or a fraud investigator can view the audit trail.' });
    }
    const events = await getMerchantEvents(fastify.db, id);
    return reply.send({ events });
  });

  // GET /api/v1/merchants/:id/activity  — v18 B-01/B-12: "user × merchant × action" audit view.
  // Reads businessProcessEvent tagged with merchantAgreementReference (OAuth-originated actions).
  // Filter by user (actingPartyReference) + free-text + date range, paginated. Display-safe
  // (no CHD, no raw IBAN). Same authorization as /:id/events (owner / officer / auditor / L1 / L2).
  fastify.get('/:id/activity', {
    schema: {
      tags: ['merchants'],
      summary: 'Merchant activity view — who did what through this merchant (SD-89 / SD-16 audit)',
      description: `Lists \`businessProcessEvent\` records attributed to this merchant's OAuth client
(v18 activity attribution). Shows the acting user (party display-safe), action/event, channel
(\`oauth_merchant\`), timestamp and the related operation reference.

**Filters:** \`user\` (actingPartyReference exact), \`q\` (free text on action/entity/user), \`dateFrom\`/\`dateTo\` (ISO 8601), \`page\`/\`limit\`.

**Authorization:** merchant owner, \`merchant_officer\`, \`security_auditor\`, \`level1_analyst\`, \`level2_investigator\`.

**PCI DSS Req 3/7 (data minimization):** never returns CHD or raw IBAN.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          user:     { type: 'string', description: 'Filter by acting party reference (the user sub).' },
          q:        { type: 'string', description: 'Free-text match on action, entity id, process type or user.' },
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo:   { type: 'string', format: 'date-time' },
          page:     { type: 'integer', minimum: 1, default: 1 },
          limit:    { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id:                    { type: 'string' },
                  eventDateTime:         { type: 'string', format: 'date-time' },
                  processType:           { type: 'string' },
                  processAction:         { type: 'string' },
                  processOutcome:        { type: 'string' },
                  entityType:            { type: 'string' },
                  entityId:              { type: 'string' },
                  clientId:              { type: 'string' },
                  actingPartyReference:  { type: 'string' },
                  actingUserName:        { type: 'string', description: 'Display-safe SD-13 name of the acting user (no CHD, no IBAN).' },
                  actingChannel:         { type: 'string' },
                  summary:               { type: 'object', additionalProperties: true },
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
    const { user: actingUser, q, dateFrom, dateTo, page = 1, limit = 20 } = request.query as {
      user?: string; q?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number;
    };
    const user = (request as { user?: JwtUserPayload }).user;
    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = MERCHANT_DETAIL_READ_ROLES.has(user?.role ?? '');
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, PSP staff, or a fraud investigator can view merchant activity.' });
    }
    const result = await listMerchantActivity(fastify.db, id, {
      actingPartyReference: actingUser,
      q,
      from: dateFrom ? new Date(dateFrom) : undefined,
      to: dateTo ? new Date(dateTo) : undefined,
      page: Number(page),
      limit: Number(limit),
    });
    return reply.send(result);
  });

  // GET /api/v1/merchants/:id/authorizations  — v18 B-10: users who granted consent to this merchant.
  // Reads partyAuthConsent filtered by merchantAgreementInstanceReference. Display-safe user identity
  // (SD-13), scopes, status, grant/last-used timestamps. Search by user, paginated. Same authorization.
  fastify.get('/:id/authorizations', {
    schema: {
      tags: ['merchants'],
      summary: 'Users who authorized this merchant (OAuth consent grants, SD-16)',
      description: `Lists the users who granted OAuth consent to this merchant's app.

**Filters:** \`q\` (search by user name / email / party ref), \`page\`/\`limit\`.

**Authorization:** merchant owner, \`merchant_officer\`, \`security_auditor\`, \`level1_analyst\`, \`level2_investigator\`.

Display-safe — no CHD, no raw IBAN.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          q:     { type: 'string', description: 'Search by user name, email or party reference.' },
          page:  { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            authorizations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  consentId:                            { type: 'string' },
                  partyAuthenticationInstanceReference: { type: 'string' },
                  userName:                             { type: 'string' },
                  userEmail:                            { type: 'string' },
                  grantedScopes:                        { type: 'array', items: { type: 'string' } },
                  consentStatus:                        { type: 'string', enum: ['active', 'revoked'] },
                  consentGrantedAt:                     { type: 'string', format: 'date-time' },
                  lastUsedAt:                           { type: 'string', format: 'date-time', nullable: true },
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
    const { q, page = 1, limit = 20 } = request.query as { q?: string; page?: number; limit?: number };
    const user = (request as { user?: JwtUserPayload }).user;
    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = MERCHANT_DETAIL_READ_ROLES.has(user?.role ?? '');
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, PSP staff, or a fraud investigator can view merchant authorizations.' });
    }
    const result = await listMerchantAuthorizations(fastify.db, id, { q, page: Number(page), limit: Number(limit) });
    return reply.send(result);
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
    const user = (request as { user?: JwtUserPayload }).user;
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

**Roles:** \`merchant_officer\` and \`security_auditor\` may update any allowed field on any merchant.
A merchant owner (\`customer\` role) may self-serve operational settings on their OWN merchant only:
\`merchantAllowedCurrencies\`, \`merchantSettlementSchedule\`, \`merchantWebhookEndpoint\`.
Risk-governed fields (\`merchantTransactionLimitAmount\`, \`merchantAgreementStatus\`) remain PSP staff only.`,
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
          merchantDefaultPayoutAccountReference: { type: 'string', description: 'FK → payoutAccountArrangement. Must belong to merchant owner party (E4 guard).' },
          merchantCommissionRate: { type: 'number', minimum: 0, maximum: 1, description: 'v18: SD-89 commission rate 0..1 (max 4 decimals). Editable by merchant owner or merchant_officer.' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Updated merchant agreement (partial).' },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtUserPayload }).user;
    const { id } = request.params as { id: string };
    const patch = request.body as Record<string, unknown>;
    const isStaff = user?.role === 'merchant_officer' || user?.role === 'security_auditor';

    // v18: validate the commission rate (SD-89). number, 0 ≤ rate ≤ 1, max 4 decimals.
    if (patch.merchantCommissionRate !== undefined) {
      const rate = patch.merchantCommissionRate;
      if (typeof rate !== 'number' || !isFinite(rate) || rate < 0 || rate > 1) {
        return reply.status(400).send({ error: 'merchantCommissionRate must be a number between 0 and 1.' });
      }
      // At most 4 decimal places. Compare the rounded value back to the original rate (tolerating
      // binary-float error) instead of comparing scaled integers directly — `rate * 10000` is not
      // guaranteed to be an exact integer even for valid inputs (e.g. 0.1 * 10000 = 1000.0000000001).
      const rounded = Math.round(rate * 10000) / 10000;
      if (Math.abs(rounded - rate) > 1e-9) {
        return reply.status(400).send({ error: 'merchantCommissionRate supports at most 4 decimal places.' });
      }
    }

    if (!isStaff) {
      // Merchant owner self-service: must own this merchant and may only touch operational fields.
      const OWNER_FIELDS = ['merchantAllowedCurrencies', 'merchantSettlementSchedule', 'merchantWebhookEndpoint', 'merchantDefaultPayoutAccountReference', 'merchantCommissionRate'];
      if (user?.role !== 'customer' || !user?.partyRef) {
        return reply.status(403).send({ error: 'Access denied: merchant configuration update requires merchant_officer, security_auditor or the merchant owner.' });
      }
      const own = await getMerchantByOwnerPartyRef(fastify.db, user.partyRef);
      if (!own || own.merchantAgreementInstanceReference !== id) {
        return reply.status(403).send({ error: 'Access denied: you can only update your own merchant.' });
      }
      const disallowed = Object.keys(patch).filter((k) => !OWNER_FIELDS.includes(k));
      if (disallowed.length > 0) {
        return reply.status(403).send({ error: `Access denied: merchant owners can only update operational settings (${OWNER_FIELDS.join(', ')}). Risk-governed fields are PSP staff only.` });
      }
    }

    // E4: Ownership guard — selected default payout account must belong to the merchant's owner party.
    // Prevents a merchant from routing payouts to a bank account they don't own (BIAN SD-66 / PCI Req 7).
    if (patch.merchantDefaultPayoutAccountReference) {
      const merchant = await getMerchantById(fastify.db, id);
      if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
      const account = await getPayoutAccount(fastify.db, patch.merchantDefaultPayoutAccountReference as string);
      if (!account) return reply.status(404).send({ error: 'Payout account not found' });
      if (account.partyInstanceReference !== merchant.merchantOwnerPartyReference) {
        return reply.status(400).send({ error: 'Payout account does not belong to this merchant\'s owner party' });
      }
    }

    const result = await updateMerchant(fastify.db, id, patch as never);
    if (!result) return reply.status(404).send({ error: 'Merchant not found' });

    // v18: audit the commission-rate change explicitly (SD-89, PCI DSS Req 10).
    if (patch.merchantCommissionRate !== undefined) {
      const actor = user?.partyRef ?? user?.sub ?? 'unknown';
      await appendMerchantEvent(fastify.db, id, 'merchant.commission_rate.updated', {
        performedByPartyReference: actor,
        performedByRole: user?.role,
        details: { merchantCommissionRate: patch.merchantCommissionRate },
      }).catch(() => { /* non-blocking */ });
      emitComplianceEvent(fastify.db, {
        entityType: 'merchant',
        entityId: id,
        processType: 'merchant_onboarding',
        processAction: 'merchant.commission_rate.updated',
        processOutcome: 'approved',
        performedByPartyReference: actor,
        performedByRole: user?.role ?? null,
        eventSummary: { merchantCommissionRate: patch.merchantCommissionRate },
        bianServiceDomain: 'Merchant Relations',
        bianControlRecordType: 'MerchantAgreementProcedure',
      });
    }
    return reply.send(result);
  });

  // POST /api/v1/merchants/:id/deactivate
  fastify.post('/:id/deactivate', {
    schema: {
      tags: ['merchants'],
      summary: 'Self-deactivate a merchant account (SD-89)',
      description: `Transitions an \`active\` or \`agreed\` merchant to \`suspended\` status.
The merchant record is retained for audit (PCI DSS Req 10). No payments, OAuth authentication,
or new operations are permitted while suspended.

**Roles:** merchant owner (\`customer\`), \`merchant_officer\`, or \`system_admin\`.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Optional reason for deactivation (recorded for audit).' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            merchantAgreementInstanceReference: { type: 'string' },
            merchantAgreementStatus: { type: 'string' },
            merchantDeactivatedDateTime: { type: 'string' },
          },
        },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        409: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtUserPayload }).user;
    const { id } = request.params as { id: string };
    const { reason } = (request.body ?? {}) as { reason?: string };

    const merchant = await getMerchantById(fastify.db, id) as Record<string, unknown> | null;
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });

    const isOwner = !!user?.partyRef && merchant.merchantOwnerPartyReference === user.partyRef;
    const isPrivileged = user?.role === 'merchant_officer' || user?.role === 'manager';
    if (!isOwner && !isPrivileged) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, a merchant officer, or a system admin can deactivate a merchant.' });
    }

    const currentStatus = merchant.merchantAgreementStatus as string;
    if (currentStatus === 'suspended') {
      return reply.status(409).send({ error: 'Merchant is already suspended.' });
    }
    if (currentStatus === 'rejected' || currentStatus === 'closed') {
      return reply.status(409).send({ error: `Cannot deactivate a merchant in '${currentStatus}' status.` });
    }

    const now = new Date();
    await updateMerchant(fastify.db, id, {
      merchantAgreementStatus: 'suspended',
      merchantDeactivatedDateTime: now,
      merchantDeactivatedByPartyRef: user?.partyRef ?? user?.sub ?? 'unknown',
      merchantDeactivationReason: reason ?? null,
    } as never);

    return reply.send({
      merchantAgreementInstanceReference: id,
      merchantAgreementStatus: 'suspended',
      merchantDeactivatedDateTime: now.toISOString(),
    });
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
            merchantWebhookSecret: { type: 'string', description: 'HMAC signing secret — verify the X-Webhook-Signature header with it. Generated on first save.' },
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

  // POST /api/v1/merchants/:id/webhooks/test — send a SIMULATED payment.completed webhook so the
  // merchant can verify their endpoint without running a full payment. Owner / merchant_officer.
  fastify.post('/:id/webhooks/test', {
    schema: {
      tags: ['merchants'],
      summary: 'Send a test webhook to the merchant endpoint (SD-89)',
      description: `Delivers a representative (clearly \`test: true\`) \`payment.completed\` event to the
merchant's configured \`merchantWebhookEndpoint\`, HMAC-signed exactly like a real callback. Returns the
payload sent + the delivery outcome (status, attempts, the merchant's response). No real CHD is included.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          payload: { type: 'object', additionalProperties: true, description: 'Optional edited payload to send instead of the default sample.' },
          authHeader: {
            type: 'object',
            description: 'Optional auth header to add (e.g. the scheme the merchant configured — paste an API key value here to test it).',
            properties: { name: { type: 'string' }, value: { type: 'string' } },
          },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Delivery result + the payload + signed headers that were sent.' },
        400: { description: 'No webhook endpoint configured.', $ref: 'Error#' },
        401: { $ref: 'Error#' },
        403: { description: 'Not the merchant owner or a merchant officer.', $ref: 'Error#' },
        404: { description: 'Merchant not found.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const body = (request.body ?? {}) as { payload?: Record<string, unknown>; authHeader?: { name?: string; value?: string } };
    const extraHeaders = body.authHeader?.name && body.authHeader?.value
      ? { [body.authHeader.name]: body.authHeader.value }
      : undefined;
    const result = await sendTestWebhook(fastify.db, id, { payload: body.payload, extraHeaders });
    if (result === null) return reply.status(404).send({ error: 'Merchant not found' });
    if (result.configured === false) {
      return reply.status(400).send({ error: 'No webhook endpoint configured. Save a webhook URL first.' });
    }
    return reply.send(result);
  });

  // GET /api/v1/merchants/:id/keys  — list API key METADATA (no secret/hash)
  // BIAN SD-89 credential management. Owner / merchant_officer / security_auditor.
  fastify.get('/:id/keys', {
    schema: {
      tags: ['merchants'],
      summary: 'List a merchant\'s API keys (metadata only, SD-89)',
      description: 'Returns API key metadata (id, prefix, label, status, created/last-used dates). The secret and its hash are **never** returned (PCI DSS Req 3).',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  keyId:               { type: 'string' },
                  keyPrefix:           { type: 'string' },
                  keyLabel:            { type: 'string', nullable: true },
                  keyStatus:           { type: 'string', enum: ['active', 'revoked'] },
                  keyOrigin:           { type: 'string', enum: ['generated', 'imported'], description: 'generated by the PSP, or imported from the merchant system.' },
                  keyCreatedDateTime:  { type: 'string', format: 'date-time' },
                  keyLastUsedDateTime: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
          },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as { user?: JwtUserPayload }).user;
    const merchant = await getMerchantById(fastify.db, id);
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    const ownerRef = (merchant as Record<string, unknown>).merchantOwnerPartyReference;
    const isOwner = !!user?.partyRef && ownerRef === user.partyRef;
    const isStaff = user?.role === 'merchant_officer' || user?.role === 'security_auditor';
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'Access denied: only the merchant owner, a merchant officer, or a security auditor can view API keys.' });
    }
    const keys = await getMerchantApiKeys(fastify.db, id);
    return reply.send({ keys: keys ?? [] });
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
      body: {
        type: 'object',
        properties: { label: { type: 'string', description: 'Optional human label to identify this key.' } },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            keyId: { type: 'string', description: 'UUID to reference this key (for revocation).' },
            keyPrefix: { type: 'string', description: 'First 12 chars for display: "lbpk_live_ab".' },
            keyLabel: { type: 'string', nullable: true, description: 'The label assigned to this key, if any.' },
            merchantApiKey: { type: 'string', description: 'Full API key. Store securely. Shown once only.' },
          },
        },
        401: { $ref: 'Error#' },
        403: { description: 'Not the merchant owner or a merchant officer.', $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const { label } = (request.body ?? {}) as { label?: string };
    const result = await generateApiKey(fastify.db, id, label);
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
        403: { description: 'Not the merchant owner or a merchant officer.', $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id, keyId } = request.params as { id: string; keyId: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const result = await revokeApiKey(fastify.db, id, keyId);
    if (result === 'not_found') return reply.status(404).send({ error: 'Merchant or key not found' });
    return reply.send({ revoked: true, keyId });
  });

  // POST /api/v1/merchants/:id/keys/import — register an EXISTING key from the merchant's own system
  fastify.post('/:id/keys/import', {
    schema: {
      tags: ['merchants'],
      summary: 'Import an existing merchant API key (SD-89)',
      description: `Registers an API key that the merchant already holds (e.g. issued by the merchant's
own system). **PCI DSS Req 3:** only a bcrypt hash + a display prefix are stored — the supplied key is
hashed and discarded, never persisted in plaintext and never returned. Marked \`keyOrigin: 'imported'\`.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['apiKey'],
        properties: {
          apiKey: { type: 'string', minLength: 12, description: 'The existing full API key to register (hashed server-side, never stored in plaintext).' },
          label: { type: 'string', description: 'Optional human label to identify this key.' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            keyId: { type: 'string' },
            keyPrefix: { type: 'string' },
            keyLabel: { type: 'string', nullable: true },
            keyStatus: { type: 'string', enum: ['active'] },
            keyOrigin: { type: 'string', enum: ['imported'] },
          },
        },
        400: { description: 'Key too short / invalid.', $ref: 'Error#' },
        401: { $ref: 'Error#' },
        403: { description: 'Not the merchant owner or a merchant officer.', $ref: 'Error#' },
        404: { description: 'Merchant not found.', $ref: 'Error#' },
        409: { description: 'Key already registered for this merchant.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const { apiKey, label } = (request.body ?? {}) as { apiKey?: string; label?: string };
    if (!apiKey) return reply.status(400).send({ error: 'apiKey is required' });
    const result = await importApiKey(fastify.db, id, apiKey, label);
    if (result === null) return reply.status(404).send({ error: 'Merchant not found' });
    if (result === 'invalid') return reply.status(400).send({ error: 'The API key is too short to register.' });
    if (result === 'duplicate') return reply.status(409).send({ error: 'This API key is already registered for the merchant.' });
    return reply.status(201).send(result);
  });

  // PATCH /api/v1/merchants/:id/keys/:keyId — rename (relabel) an API key
  // ── OAuth 2.0 Client Registration (v16, ADR-037) ──────────────────────────

  fastify.post('/:id/oauth-client', {
    schema: {
      tags: ['merchants'],
      summary: 'Issue OAuth 2.0 client credentials (SD-89)',
      description: 'Registers a new OAuth 2.0 client for the merchant. The generated client_secret is shown exactly once and never stored in plaintext. Requires merchant_officer or system_admin role.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['redirect_uris', 'grant_types', 'scopes'],
        properties: {
          redirect_uris: { type: 'array', items: { type: 'string' }, minItems: 1 },
          grant_types: { type: 'array', items: { type: 'string' }, minItems: 1 },
          scopes: { type: 'array', items: { type: 'string' }, minItems: 1 },
          require_pkce: { type: 'boolean', default: true },
          token_lifetime_seconds: { type: 'number', default: 3600 },
          refresh_token_lifetime_days: { type: 'number', default: 30 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user as JwtUserPayload | undefined;
    const access = await checkOAuthClientAccess(fastify, id, user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const body = request.body as any;
    try {
      const result = await issueMerchantOAuthClient(fastify.db, id, body);
      return reply.status(201).send(result);
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  fastify.delete('/:id/oauth-client', {
    schema: {
      tags: ['merchants'],
      summary: 'Revoke merchant OAuth 2.0 client (SD-89)',
      description: 'Revokes the merchant OAuth client. All tokens issued to this client immediately become invalid.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user as JwtUserPayload | undefined;
    const access = await checkOAuthClientAccess(fastify, id, user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    try {
      await revokeMerchantOAuthClient(fastify.db, id);
      return { revoked: true };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  // GET /api/v1/merchants/:id/oauth-client — retrieve OAuth client config (no secret)
  fastify.get('/:id/oauth-client', {
    schema: {
      tags: ['merchants'],
      summary: 'Get merchant OAuth 2.0 client config (SD-89)',
      description: 'Returns the OAuth client configuration for the merchant. The client_secret is never returned. Requires merchant owner, merchant_officer, or system_admin.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      response: {
        200: { description: 'OAuth client configuration (secret omitted).' },
        403: { description: 'Access denied.', $ref: 'Error#' },
        404: { description: 'Merchant not found or no OAuth client configured.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user as JwtUserPayload | undefined;
    const access = await checkOAuthClientAccess(fastify, id, user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const merchant = await getMerchantById(fastify.db, id) as Record<string, unknown> | null;
    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
    const oauthClient = merchant.merchantOAuthClient as (Record<string, unknown> & { oauthClientSecretHash?: unknown }) | undefined;
    if (!oauthClient) return reply.status(404).send({ error: 'No OAuth client configured for this merchant' });
    const { oauthClientSecretHash: _omit, ...publicConfig } = oauthClient;
    return reply.status(200).send(publicConfig);
  });

  // PATCH /api/v1/merchants/:id/oauth-client — update OAuth client config
  fastify.patch('/:id/oauth-client', {
    schema: {
      tags: ['merchants'],
      summary: 'Update merchant OAuth 2.0 client config (SD-89)',
      description: 'Updates selected fields of the merchant OAuth client config. All body fields are optional — only provided fields are updated. Requires merchant_officer or system_admin.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          redirect_uris: { type: 'array', items: { type: 'string' } },
          post_logout_redirect_uris: { type: 'array', items: { type: 'string' } },
          grant_types: {
            type: 'array',
            items: { type: 'string', enum: ['authorization_code', 'client_credentials', 'refresh_token', 'urn:openid:params:grant-type:ciba'] },
          },
          scopes: { type: 'array', items: { type: 'string' } },
          require_pkce: { type: 'boolean' },
          token_lifetime_seconds: { type: 'number', minimum: 300, maximum: 86400 },
          refresh_token_lifetime_days: { type: 'number', minimum: 1, maximum: 365 },
          claim_mapping: { type: 'object', additionalProperties: { type: 'string' } },
          logo_uri: { type: 'string', description: 'v18: OIDC client logo_uri (https). Shown on the consent page and app listings.' },
          client_uri: { type: 'string', description: 'v18: OIDC client_uri (https) — merchant home page.' },
          client_id: { type: 'string', minLength: 1, description: 'Set a custom client_id. Changing it orphans existing tokens/consents (aud mismatch) and requires updating the relying party config.' },
          client_secret: { type: 'string', minLength: 8, description: 'Set a custom client secret (re-hashed). The plaintext is never returned; store it now.' },
          client_secret_prefix: { type: 'string', maxLength: 16, description: 'Independent display/identification label (not derived from the secret). Set or generate on its own.' },
        },
      },
      response: {
        200: { description: 'Updated OAuth client configuration (secret omitted).' },
        400: { description: 'No OAuth client configured, or invalid input.', $ref: 'Error#' },
        403: { description: 'merchant_officer or system_admin required.', $ref: 'Error#' },
        404: { description: 'Merchant not found.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user as JwtUserPayload | undefined;
    const access = await checkOAuthClientAccess(fastify, id, user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const body = request.body as any;
    try {
      const result = await updateMerchantOAuthClient(fastify.db, id, body);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  fastify.post('/:id/oauth-client/rotate-secret', {
    schema: {
      tags: ['merchants'],
      summary: 'Rotate merchant OAuth client secret (SD-89)',
      description: 'Generates a new client_secret. The new secret is shown exactly once. The old secret is immediately invalidated.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user as JwtUserPayload | undefined;
    const access = await checkOAuthClientAccess(fastify, id, user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    try {
      const result = await rotateMerchantOAuthClientSecret(fastify.db, id);
      return result;
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  // ── Typed Webhook Registry (ADR-038) ────────────────────────────────────────

  // GET /api/v1/merchants/:id/webhooks/registry — list all typed webhooks
  fastify.get('/:id/webhooks/registry', {
    schema: {
      tags: ['merchants'],
      summary: 'List typed webhooks (SD-89)',
      description: 'Returns all per-event-type webhook configurations for a merchant. Secrets are masked.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    try {
      const webhooks = await new WebhookService(fastify.db).list(id);
      return { webhooks };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  // POST /api/v1/merchants/:id/webhooks/registry — register a typed webhook
  fastify.post('/:id/webhooks/registry', {
    schema: {
      tags: ['merchants'],
      summary: 'Register a typed webhook (SD-89)',
      description: 'Registers or replaces the webhook for a specific event type. Returns the signing secret once — store it securely.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['eventType', 'url'],
        properties: {
          eventType: { type: 'string', enum: ['payment.completed', 'payment.failed', 'oauth.authorization_granted', 'oauth.authorization_revoked', 'user.notification', 'dispute.opened', 'kyb.status_changed'] },
          url: { type: 'string', format: 'uri' },
          attributeMapping: { type: 'object', additionalProperties: { type: 'string' }, description: 'PSP field → merchant field renaming map.' },
          headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Static HTTP headers sent with every delivery.' },
          apiKeyId: { type: 'string', description: 'keyId of a merchantApiKey to inject on delivery.' },
          apiKeyTransport: { type: 'string', enum: ['header', 'body'], description: 'Injection channel for the API key.' },
          apiKeyFieldName: { type: 'string', description: 'Header name or body field name for the API key.' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const { eventType, url, attributeMapping, headers, apiKeyId, apiKeyTransport, apiKeyFieldName } = request.body as {
      eventType: WebhookEventType; url: string;
      attributeMapping?: Record<string, string>; headers?: Record<string, string>;
      apiKeyId?: string; apiKeyTransport?: 'header' | 'body'; apiKeyFieldName?: string;
    };
    try {
      const result = await new WebhookService(fastify.db).register(id, eventType, url, attributeMapping, headers, { apiKeyId, apiKeyTransport, apiKeyFieldName });
      return result;
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  // PATCH /api/v1/merchants/:id/webhooks/registry/:webhookId — update a typed webhook
  fastify.patch('/:id/webhooks/registry/:webhookId', {
    schema: {
      tags: ['merchants'],
      summary: 'Update a typed webhook (SD-89)',
      description: 'Updates the URL, status, or attribute mapping of a registered typed webhook.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id', 'webhookId'], properties: { id: { type: 'string' }, webhookId: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          status: { type: 'string', enum: ['active', 'inactive'] },
          attributeMapping: { type: 'object', additionalProperties: { type: 'string' } },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          apiKeyId: { type: ['string', 'null'] },
          apiKeyTransport: { type: 'string', enum: ['header', 'body'] },
          apiKeyFieldName: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id, webhookId } = request.params as { id: string; webhookId: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const patch = request.body as {
      url?: string; status?: 'active' | 'inactive';
      attributeMapping?: Record<string, string>; headers?: Record<string, string>;
      apiKeyId?: string | null; apiKeyTransport?: 'header' | 'body'; apiKeyFieldName?: string;
    };
    try {
      const result = await new WebhookService(fastify.db).update(id, webhookId, patch);
      return result;
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  // DELETE /api/v1/merchants/:id/webhooks/registry/:webhookId — remove a typed webhook
  fastify.delete('/:id/webhooks/registry/:webhookId', {
    schema: {
      tags: ['merchants'],
      summary: 'Delete a typed webhook (SD-89)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id', 'webhookId'], properties: { id: { type: 'string' }, webhookId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id, webhookId } = request.params as { id: string; webhookId: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    try {
      await new WebhookService(fastify.db).delete(id, webhookId);
      return { deleted: true, webhookId };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  // POST /api/v1/merchants/:id/webhooks/registry/:webhookId/test — test a typed webhook
  fastify.post('/:id/webhooks/registry/:webhookId/test', {
    schema: {
      tags: ['merchants'],
      summary: 'Test a typed webhook (SD-89)',
      description: 'Sends the well-defined sample payload for the event type to the webhook URL. Captures the request + merchant response. Marked test:true.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id', 'webhookId'], properties: { id: { type: 'string' }, webhookId: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          payload: { type: 'object', additionalProperties: true, description: 'Optional custom payload to send instead of the default sample.' },
        },
      },
    },
  }, async (request, reply) => {
    const { id, webhookId } = request.params as { id: string; webhookId: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const body = (request.body ?? {}) as { payload?: Record<string, unknown> };
    try {
      const result = await new WebhookService(fastify.db).test(id, webhookId, body.payload);
      return result;
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  // GET /api/v1/merchants/:id/webhooks/registry/:webhookId/test-payload — get canonical test payload
  fastify.get('/:id/webhooks/registry/:webhookId/test-payload', {
    schema: {
      tags: ['merchants'],
      summary: 'Get canonical test payload for a webhook (SD-89)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id', 'webhookId'], properties: { id: { type: 'string' }, webhookId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id, webhookId } = request.params as { id: string; webhookId: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    try {
      const svc = new WebhookService(fastify.db);
      const webhooks = await svc.list(id);
      const cfg = webhooks.find((w) => w.webhookId === webhookId);
      if (!cfg) return reply.status(404).send({ error: 'Webhook not found' });
      const payload = WebhookService.buildTestPayload(cfg.webhookEventType, id);
      return { payload };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  // GET /api/v1/merchants/:id/webhooks/logs — list webhook delivery logs (paginated)
  fastify.get('/:id/webhooks/logs', {
    schema: {
      tags: ['merchants'],
      summary: 'List webhook delivery logs (SD-89)',
      description: 'Returns paginated webhook delivery attempts for this merchant, newest first.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          eventType: { type: 'string' },
          deliveryType: { type: 'string', enum: ['live', 'test'] },
          delivered: { type: 'boolean' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const q = request.query as { eventType?: string; deliveryType?: string; delivered?: boolean; page?: number; limit?: number };
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 25));
    try {
      const { logs, total } = await new WebhookService(fastify.db).listLogs(
        id,
        { eventType: q.eventType as WebhookEventType | undefined, deliveryType: q.deliveryType as 'live' | 'test' | undefined, delivered: q.delivered },
        { skip: (page - 1) * limit, limit },
      );
      return { logs, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  fastify.patch('/:id/keys/:keyId', {
    schema: {
      tags: ['merchants'],
      summary: 'Update a merchant API key label (SD-89)',
      description: 'Changes the human label of an API key to identify it more easily. The label is never a secret. Pass an empty label to clear it.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'keyId'],
        properties: { id: { type: 'string' }, keyId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['label'],
        properties: { label: { type: 'string', maxLength: 80, description: 'New label (empty string clears it).' } },
      },
      response: {
        200: { type: 'object', properties: { keyId: { type: 'string' }, keyLabel: { type: 'string', nullable: true } } },
        401: { $ref: 'Error#' },
        403: { description: 'Not the merchant owner or a merchant officer.', $ref: 'Error#' },
        404: { description: 'Merchant or key not found.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id, keyId } = request.params as { id: string; keyId: string };
    const access = await checkKeyMutationAccess(fastify, id, (request as { user?: JwtUserPayload }).user);
    if (!('ok' in access)) return reply.status(access.status).send({ error: access.error });
    const { label } = (request.body ?? {}) as { label?: string };
    const result = await updateApiKeyLabel(fastify.db, id, keyId, label ?? '');
    if (result === 'not_found') return reply.status(404).send({ error: 'Merchant or key not found' });
    return reply.send({ keyId, keyLabel: label?.trim() ? label.trim() : null });
  });
}
