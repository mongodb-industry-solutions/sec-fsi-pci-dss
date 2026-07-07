// BIAN SD-54: Merchant Beneficiary API — OAuth authorization_code sub-binding (v17)
// Routes mounted at /merchant/beneficiaries → /api/v1/merchant/beneficiaries
//
// The merchant obtains a token via authorization_code on behalf of the user (PSP OAuth flow).
// token.sub === partyRef (the user who authorized) — enforced by requireMerchantOnBehalfOf().
// Raw PII (phone/email) is NEVER persisted; only the resolved partyRef and a masked hint.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Db } from 'mongodb';
import { validateMerchantToken } from '../../../vendors/middleware/validateMerchantToken';
import {
  registerBeneficiary,
  listBeneficiaries,
  removeBeneficiary,
} from '../../identity/services/counterpartyArrangement.service';
import { resolvePartyInstanceReference } from '../../identity/services/oauth.service';
import { executeP2PTransfer } from '../services/p2pTransfer.service';
import { getDefaultPayoutAccount, listPayoutAccounts } from '../services/payoutAccount.service';
import { emitProcessEvent, attributionFromMerchantContext } from '../../provider/services/businessProcessEvent.service';

// Scopes required for beneficiary operations (ADR-037 extension)
export const MERCHANT_BENEFICIARY_SCOPES = {
  lookup: 'write:beneficiaries',
  list: 'read:beneficiaries',
  remove: 'write:beneficiaries',
  // Sending money to a beneficiary is a bank transfer (SD-65) → write:transfers,
  // consistent with the merchantGateway transfer routes.
  send: 'write:transfers',
} as const;

/**
 * Resolve the party's source payout account for an outbound send: the active default
 * account if present, otherwise the first active account. Returns null when the user
 * has no usable payout account (caller returns a clear error).
 */
async function resolveSourcePayoutAccountRef(
  db: Db,
  partyRef: string,
): Promise<string | null> {
  const def = await getDefaultPayoutAccount(db, partyRef);
  if (def) return def.payoutAccountInstanceReference;
  const { results } = await listPayoutAccounts(db, partyRef, { status: 'active', limit: 1 });
  return results[0]?.payoutAccountInstanceReference ?? null;
}

/**
 * Validate merchant OAuth token AND enforce sub-binding:
 * token.sub must equal the partyRef in the request (the user's authorization_code grant).
 */
async function requireMerchantOnBehalfOf(
  req: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  partyRef: string,
): Promise<boolean> {
  await validateMerchantToken(req, reply, scope);
  if (!req.merchantContext) return false; // reply already sent

  if (req.merchantContext.sub !== partyRef) {
    reply.status(403).send({
      error: 'access_denied',
      error_description: 'Token subject does not match the requested partyRef. Use authorization_code grant on behalf of this user.',
    });
    return false;
  }
  return true;
}

export async function merchantBeneficiaryController(fastify: FastifyInstance) {

  // POST /api/v1/merchant/beneficiaries/:partyRef/lookup
  // Resolve a phone or email to a beneficiary token — anti-enumeration response
  fastify.post('/:partyRef/lookup', {
    // OAuth-guarded route: opt out of the global HS256 JWT preHandler; requireMerchantOnBehalfOf
    // validates the RS256 OAuth token + scope + sub-binding in-handler.
    config: { skipAuth: true },
    schema: {
      tags: ['merchant-portal'],
      summary: 'Lookup beneficiary by phone or email (SD-54)',
      description: 'Resolves a phone/email to a beneficiary token on behalf of the user. '
        + 'Requires authorization_code OAuth with scope write:beneficiaries. '
        + 'Anti-enumeration: always returns { found: false } for non-existent or duplicate contacts.',
      params: { type: 'object', required: ['partyRef'], properties: { partyRef: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['lookupType', 'lookupValue'],
        properties: {
          lookupType: { type: 'string', enum: ['phone', 'email'] },
          lookupValue: { type: 'string', description: 'Raw phone number or email address.' },
          label: { type: 'string', description: 'Optional display label for this beneficiary.' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { partyRef } = req.params as { partyRef: string };
    const authorized = await requireMerchantOnBehalfOf(req, reply, MERCHANT_BENEFICIARY_SCOPES.lookup, partyRef);
    if (!authorized) return;

    // Counterparties (SD-54) are keyed by the SD-13 party, not the OAuth subject — translate first.
    const ownerParty = await resolvePartyInstanceReference(fastify.db, partyRef);
    if (!ownerParty) return reply.status(404).send({ error: 'party_not_found' });

    const body = req.body as { lookupType: 'phone' | 'email'; lookupValue: string; label?: string };

    try {
      const result = await registerBeneficiary(fastify.db, {
        ownerPartyReference: ownerParty,
        lookupType: body.lookupType,
        lookupValue: body.lookupValue,
        label: body.label,
      });
      return reply.send(result);
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode === 422) {
        return reply.status(422).send({ error: e.message });
      }
      throw err;
    }
  });

  // GET /api/v1/merchant/beneficiaries/:partyRef
  // List the user's registered beneficiaries
  fastify.get('/:partyRef', {
    config: { skipAuth: true },
    schema: {
      tags: ['merchant-portal'],
      summary: "List user's beneficiaries (SD-54)",
      description: "Returns the user's saved beneficiary list. Requires authorization_code OAuth with scope read:beneficiaries.",
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
    const authorized = await requireMerchantOnBehalfOf(req, reply, MERCHANT_BENEFICIARY_SCOPES.list, partyRef);
    if (!authorized) return;

    const q = req.query as { page?: number; limit?: number };
    const ownerParty = await resolvePartyInstanceReference(fastify.db, partyRef);
    if (!ownerParty) return reply.send({ results: [], total: 0, page: q.page ?? 1, limit: q.limit ?? 20 });
    const { results, total } = await listBeneficiaries(fastify.db, ownerParty, q);
    // Display-safe projection: expose only the opaque token, owner label, lookup type,
    // masked hint and status. NEVER leak counterpartyPartyReference (PSP-internal identity)
    // or the raw lookup value to the merchant (GDPR minimisation, SD-54 v17 design).
    const safe = results.map((b) => ({
      counterpartyArrangementReference: b.counterpartyArrangementReference,
      counterpartyLabel: b.counterpartyLabel,
      counterpartyLookupType: b.counterpartyLookupType,
      counterpartyLookupHint: b.counterpartyLookupHint,
      counterpartyArrangementStatus: b.counterpartyArrangementStatus,
      recordCreatedDateTime: b.recordCreatedDateTime,
    }));
    return reply.send({ results: safe, total, page: q.page ?? 1, limit: q.limit ?? 20 });
  });

  // DELETE /api/v1/merchant/beneficiaries/:partyRef/:beneficiaryToken
  // Remove a beneficiary
  fastify.delete('/:partyRef/:beneficiaryToken', {
    config: { skipAuth: true },
    schema: {
      tags: ['merchant-portal'],
      summary: 'Remove a beneficiary (SD-54)',
      description: 'Removes a beneficiary from the user\'s list. Requires authorization_code OAuth with scope write:beneficiaries.',
      params: {
        type: 'object',
        required: ['partyRef', 'beneficiaryToken'],
        properties: { partyRef: { type: 'string' }, beneficiaryToken: { type: 'string' } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { partyRef, beneficiaryToken } = req.params as { partyRef: string; beneficiaryToken: string };
    const authorized = await requireMerchantOnBehalfOf(req, reply, MERCHANT_BENEFICIARY_SCOPES.remove, partyRef);
    if (!authorized) return;

    const ownerParty = await resolvePartyInstanceReference(fastify.db, partyRef);
    if (!ownerParty) return reply.status(404).send({ error: 'Beneficiary not found' });
    const ok = await removeBeneficiary(fastify.db, ownerParty, beneficiaryToken);
    if (!ok) return reply.status(404).send({ error: 'Beneficiary not found' });
    return reply.send({ counterpartyArrangementReference: beneficiaryToken, counterpartyArrangementStatus: 'removed' });
  });

  // POST /api/v1/merchant/beneficiaries/:partyRef/:beneficiaryToken/send
  // Send money to a saved beneficiary on behalf of the user (P2P transfer, SD-65).
  // Mirrors the PSP's send-to-beneficiary flow but originates from the merchant portal.
  // The merchant only ever provides an amount + opaque beneficiary token — never IBAN/PAN/CHD.
  fastify.post('/:partyRef/:beneficiaryToken/send', {
    config: { skipAuth: true },
    schema: {
      tags: ['merchant-portal'],
      summary: 'Send money to a beneficiary (SD-65)',
      description: 'Executes a P2P bank transfer to a saved beneficiary on behalf of the user. '
        + 'Requires authorization_code OAuth with scope write:transfers. '
        + 'The source account is the user\'s default (or first active) payout account, resolved server-side. '
        + 'The merchant supplies only the amount and the opaque beneficiary token (no CHD, no IBAN).',
      params: {
        type: 'object',
        required: ['partyRef', 'beneficiaryToken'],
        properties: { partyRef: { type: 'string' }, beneficiaryToken: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', description: 'Amount to send, in the source account currency.' },
          currency: { type: 'string', description: 'Optional client hint; the server uses the source account currency.' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { partyRef, beneficiaryToken } = req.params as { partyRef: string; beneficiaryToken: string };
    const authorized = await requireMerchantOnBehalfOf(req, reply, MERCHANT_BENEFICIARY_SCOPES.send, partyRef);
    if (!authorized) return;

    const body = req.body as { amount: number; currency?: string };
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
      return reply.status(422).send({ error: 'invalid_amount', error_description: 'Amount must be greater than zero.' });
    }

    // Counterparties (SD-54) and payout accounts (SD-66) are keyed by the SD-13 party.
    const ownerParty = await resolvePartyInstanceReference(fastify.db, partyRef);
    if (!ownerParty) return reply.status(404).send({ error: 'party_not_found' });

    // Resolve the user's source account server-side — never trusted from the client.
    const fromAccountRef = await resolveSourcePayoutAccountRef(fastify.db, ownerParty);
    if (!fromAccountRef) {
      return reply.status(422).send({ error: 'no_source_account', error_description: 'You have no active payout account to send from.' });
    }

    const result = await executeP2PTransfer(fastify.db, {
      initiatorPartyRef: ownerParty,
      counterpartyArrangementRef: beneficiaryToken,
      fromAccountRef,
      amount: body.amount,
    });

    // Attribute the merchant-originated action (SD-16 audit, PCI DSS Req 10).
    emitProcessEvent(fastify.db, {
      entityType: 'execution', entityId: result.transferReference || beneficiaryToken,
      processType: 'payment_processing', processAction: 'merchant.beneficiary.send',
      processOutcome: result.status === 'failed' ? 'rejected' : 'approved',
      performedByPartyReference: ownerParty, performedByRole: 'customer',
      eventSummary: { amount: result.amount, currency: result.currency, status: result.status, beneficiaryArrangement: beneficiaryToken },
      bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
      attribution: attributionFromMerchantContext(req.merchantContext),
    });

    // Display-safe result — no recipient account/party identity leaked to the merchant.
    const safe = {
      transferReference: result.transferReference,
      amount: result.amount,
      currency: result.currency,
      status: result.status,
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    };
    const code = result.status === 'failed' ? 422 : 202;
    return reply.code(code).send(safe);
  });
}
