// BIAN SD-54: Merchant Beneficiary API — OAuth authorization_code sub-binding (v17)
// Routes mounted at /merchant/beneficiaries → /api/v1/merchant/beneficiaries
//
// The merchant obtains a token via authorization_code on behalf of the user (PSP OAuth flow).
// token.sub === partyRef (the user who authorized) — enforced by requireMerchantOnBehalfOf().
// Raw PII (phone/email) is NEVER persisted; only the resolved partyRef and a masked hint.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validateMerchantToken } from '../../../vendors/middleware/validateMerchantToken';
import {
  registerBeneficiary,
  listBeneficiaries,
  removeBeneficiary,
} from '../../identity/services/counterpartyArrangement.service';

// Scopes required for beneficiary operations (ADR-037 extension)
export const MERCHANT_BENEFICIARY_SCOPES = {
  lookup: 'write:beneficiaries',
  list: 'read:beneficiaries',
  remove: 'write:beneficiaries',
} as const;

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

    const body = req.body as { lookupType: 'phone' | 'email'; lookupValue: string; label?: string };

    try {
      const result = await registerBeneficiary(fastify.db, {
        ownerPartyReference: partyRef,
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
    const { results, total } = await listBeneficiaries(fastify.db, partyRef, q);
    return reply.send({ results, total, page: q.page ?? 1, limit: q.limit ?? 20 });
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

    const ok = await removeBeneficiary(fastify.db, partyRef, beneficiaryToken);
    if (!ok) return reply.status(404).send({ error: 'Beneficiary not found' });
    return reply.send({ counterpartyArrangementReference: beneficiaryToken, counterpartyArrangementStatus: 'removed' });
  });
}
