// BIAN SD-65/66: Merchant Gateway API — OAuth authorization_code on-behalf-of (v18)
// Routes mounted at /merchant/{accounts,transactions,transfers} → /api/v1/merchant/*
//
// These merchant-facing OAuth endpoints let the Espresso Works app act on behalf of the
// logged-in user (token.sub === :partyRef). They REUSE the existing SD-66 payout-account and
// SD-65 bank-transfer services — no business logic is duplicated. Display-safe only:
//   · no CHD (PCI SAQ A), · IBAN masked-only (GDPR Art. 5/32, PSD2 minimisation).
// Separation of duties: validateMerchantToken (OAuth) is NEVER combined with requirePermission.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validateMerchantToken } from '../../../vendors/middleware/validateMerchantToken';
import { listPayoutAccounts } from '../services/payoutAccount.service';
import {
  previewBankTransfer,
  executeBankTransfer,
  maskAccountIdentifier,
} from '../services/bankTransfer.service';
import type { BankRail, RailDestination } from '../../../shared/services/bankTransfer';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { emitProcessEvent, attributionFromMerchantContext } from '../../provider/services/businessProcessEvent.service';

// Scopes required per operation (real PSP verb:resource convention, v18).
export const MERCHANT_GATEWAY_SCOPES = {
  accounts: 'read:accounts',
  transactions: 'read:transactions',
  transfers: 'write:transfers',
} as const;

/**
 * Validate the merchant OAuth token AND enforce sub-binding:
 * token.sub must equal the :partyRef in the request. Prevents cross-user access.
 */
async function requireMerchantOnBehalfOf(
  req: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  partyRef: string,
): Promise<boolean> {
  await validateMerchantToken(req, reply, scope);
  if (!req.merchantContext) return false; // reply already sent (401/403)

  if (req.merchantContext.sub !== partyRef) {
    reply.status(403).send({
      error: 'access_denied',
      error_description: 'Token subject does not match the requested partyRef. Use authorization_code grant on behalf of this user.',
    });
    return false;
  }
  return true;
}

const destinationSchema = {
  type: 'object',
  required: ['countryCode', 'currency'],
  properties: {
    countryCode: { type: 'string', minLength: 2, maxLength: 2 },
    currency: { type: 'string', minLength: 3, maxLength: 3 },
    iban: { type: 'string' },
    accountNumber: { type: 'string' },
    routingNumber: { type: 'string' },
    bic: { type: 'string' },
    correspondentBic: { type: 'string' },
    beneficiaryName: { type: 'string', maxLength: 140 },
    bankName: { type: 'string', maxLength: 100 },
  },
} as const;

// Strip QE-encrypted / raw account coordinates, exposing a masked IBAN only (GDPR/PSD2).
function safeMerchantAccount(doc: Record<string, unknown>) {
  const { payoutAccountIban, payoutAccountRoutingNumber, _id, ...rest } = doc as Record<string, unknown> & {
    payoutAccountIban?: string;
    payoutAccountRoutingNumber?: string;
    _id?: unknown;
  };
  void payoutAccountRoutingNumber;
  void _id;
  return {
    ...rest,
    payoutAccountMaskedIban:
      typeof payoutAccountIban === 'string' && payoutAccountIban.length > 0
        ? maskAccountIdentifier(payoutAccountIban)
        : undefined,
    payoutAccountHasIban: typeof payoutAccountIban === 'string' && payoutAccountIban.length > 0,
  };
}

interface PreviewBody { destination: RailDestination; amountCurrency?: string; rail?: BankRail }
interface ExecuteBody {
  amount: number; currency: string; destination: RailDestination;
  rail?: BankRail; reference?: string; settlementSchedule?: 'T+0' | 'T+1' | 'T+2' | 'T+3';
}

export async function merchantGatewayController(fastify: FastifyInstance) {

  // GET /api/v1/merchant/accounts/:partyRef — user's payout accounts, masked IBAN only.
  fastify.get('/accounts/:partyRef', {
    config: { skipAuth: true },
    schema: {
      tags: ['merchant-portal'],
      summary: "List user's payout accounts (SD-66, masked IBAN)",
      description: 'On-behalf-of OAuth. Requires scope read:accounts + token.sub === :partyRef. IBAN is masked (GDPR/PSD2).',
      params: { type: 'object', required: ['partyRef'], properties: { partyRef: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { partyRef } = req.params as { partyRef: string };
    const ok = await requireMerchantOnBehalfOf(req, reply, MERCHANT_GATEWAY_SCOPES.accounts, partyRef);
    if (!ok) return;

    const q = req.query as { page?: number; limit?: number };
    const { results, total } = await listPayoutAccounts(fastify.db, partyRef, { page: q.page, limit: q.limit });
    const safe = results.map((r) => safeMerchantAccount(r as unknown as Record<string, unknown>));
    return reply.send({ results: safe, total, page: q.page ?? 1, limit: q.limit ?? 20 });
  });

  // GET /api/v1/merchant/transactions/:partyRef — user's execution/operation history (display-safe).
  fastify.get('/transactions/:partyRef', {
    config: { skipAuth: true },
    schema: {
      tags: ['merchant-portal'],
      summary: "List user's operation history (SD-65, display-safe)",
      description: 'On-behalf-of OAuth. Requires scope read:transactions + token.sub === :partyRef. No CHD; IBAN masked.',
      params: { type: 'object', required: ['partyRef'], properties: { partyRef: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { partyRef } = req.params as { partyRef: string };
    const ok = await requireMerchantOnBehalfOf(req, reply, MERCHANT_GATEWAY_SCOPES.transactions, partyRef);
    if (!ok) return;

    const q = req.query as { page?: number; limit?: number };
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter = {
      beneficiaryType: 'user' as const,
      $or: [{ initiatorPartyReference: partyRef }, { beneficiaryPartyReference: partyRef }],
    };
    const col = fastify.db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION);
    const [docs, total] = await Promise.all([
      col.find(filter).sort({ initiatedAt: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(filter),
    ]);

    // Display-safe projection: no CHD, destination shown masked only.
    const results = docs.map((d) => ({
      paymentExecutionInstanceReference: d.paymentExecutionInstanceReference,
      direction: d.initiatorPartyReference === partyRef ? 'sent' : 'received',
      grossAmount: d.grossAmount,
      netAmount: d.netAmount,
      feeAmount: d.feeAmount,
      currency: d.currency,
      paymentExecutionRail: d.paymentExecutionRail ?? null,
      paymentExecutionStatus: d.paymentExecutionStatus,
      beneficiaryName: d.beneficiaryName ?? null,
      destinationAccountMasked: d.destinationAccountMasked ?? null,
      initiatedAt: d.initiatedAt?.toISOString() ?? null,
      completedAt: d.completedAt?.toISOString() ?? null,
    }));

    return reply.send({ results, total, page, limit });
  });

  // POST /api/v1/merchant/transfers/:partyRef/preview — stateless rail derivation + fee quote.
  fastify.post('/transfers/:partyRef/preview', {
    config: { skipAuth: true },
    schema: {
      tags: ['merchant-portal'],
      summary: 'Preview a bank transfer on behalf of the user (SD-65/66)',
      description: 'On-behalf-of OAuth. Requires scope write:transfers + token.sub === :partyRef. No side effects.',
      params: { type: 'object', required: ['partyRef'], properties: { partyRef: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['destination'],
        properties: { destination: destinationSchema, amountCurrency: { type: 'string' }, rail: { type: 'string' } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { partyRef } = req.params as { partyRef: string };
    const ok = await requireMerchantOnBehalfOf(req, reply, MERCHANT_GATEWAY_SCOPES.transfers, partyRef);
    if (!ok) return;

    const body = req.body as PreviewBody;
    const result = previewBankTransfer(body.destination, body.amountCurrency ?? body.destination.currency, body.rail);
    return reply.send(result);
  });

  // POST /api/v1/merchant/transfers/:partyRef/bank — execute a bank transfer on behalf of the user.
  fastify.post('/transfers/:partyRef/bank', {
    config: { skipAuth: true },
    schema: {
      tags: ['merchant-portal'],
      summary: 'Execute a bank transfer on behalf of the user (SD-65/66)',
      description: 'On-behalf-of OAuth. Requires scope write:transfers + token.sub === :partyRef. Emits attributed businessProcessEvent.',
      params: { type: 'object', required: ['partyRef'], properties: { partyRef: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['amount', 'currency', 'destination'],
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          destination: destinationSchema,
          rail: { type: 'string' },
          reference: { type: 'string', maxLength: 140 },
          settlementSchedule: { type: 'string', enum: ['T+0', 'T+1', 'T+2', 'T+3'] },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { partyRef } = req.params as { partyRef: string };
    const ok = await requireMerchantOnBehalfOf(req, reply, MERCHANT_GATEWAY_SCOPES.transfers, partyRef);
    if (!ok) return;

    const body = req.body as ExecuteBody;
    const result = await executeBankTransfer(fastify.db, {
      initiatorPartyRef: partyRef,
      amount: body.amount,
      currency: body.currency,
      destination: body.destination,
      rail: body.rail,
      reference: body.reference,
      settlementSchedule: body.settlementSchedule,
    });

    // Attribute the merchant-originated action (SD-16 audit, PCI DSS Req 10).
    emitProcessEvent(fastify.db, {
      entityType: 'execution', entityId: result.executionReference,
      processType: 'payment_processing', processAction: 'merchant.transfer.bank',
      processOutcome: result.status === 'submitted' ? 'approved' : 'rejected',
      performedByPartyReference: partyRef, performedByRole: 'customer',
      eventSummary: { amount: body.amount, currency: body.currency, rail: result.rail, status: result.status },
      bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
      attribution: attributionFromMerchantContext(req.merchantContext),
    });

    const code = result.status === 'submitted' ? 202 : 422;
    return reply.code(code).send(result);
  });
}
