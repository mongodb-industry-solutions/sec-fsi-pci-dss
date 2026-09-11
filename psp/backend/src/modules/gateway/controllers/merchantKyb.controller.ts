// KYB Administration controller (v31). Mounted under /merchants (same prefix as
// merchant.controller: one merchant surface, no forked API). Provides the KYB *data-administration*
// endpoints for the Operations Officer: review/correct KYB data, administer beneficial owners, and the
// correlated process timeline. The KYB *decision* (approve/reject) stays on /:id/review (merchant_officer).
//
// Security (API-First, plan §12): every route enforces requirePermission server-side; customer callers
// are additionally scoped to merchants they own. Verdict/status fields are rejected here (decision 2).

import { FastifyInstance } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { requirePermission } from '../../../vendors/middleware/acl';
import { getMerchantById } from '../services/merchant.service';
import { listAuditEvents } from '../../provider/services/businessProcessEvent.service';
import {
  getKybDetail,
  listBeneficialOwners,
  patchKybData,
  addBeneficialOwner,
  updateBeneficialOwner,
  removeBeneficialOwner,
} from '../services/merchantKyb.service';
import { isMerchantOwner } from '../services/merchantBeneficialOwner';

const E = { $ref: 'Error#' };
const OWNER_ROLE_ENUM = ['ultimate_beneficial_owner', 'director', 'shareholder', 'authorized_signatory'];

function actorOf(request: { user?: JwtUserPayload }) {
  const u = request.user;
  return { performedByPartyReference: u?.partyRef ?? u?.sub ?? undefined, performedByRole: u?.role };
}

export async function merchantKybController(fastify: FastifyInstance) {
  const canView = requirePermission('merchants', 'view');
  const canManage = requirePermission('merchants', 'manage');

  // GET /:id/kyb, KYB detail incl. beneficial owners (party summaries) + composed owner-layer risk.
  fastify.get('/:id/kyb', {
    schema: {
      tags: ['merchants'],
      summary: 'KYB administration detail (SD-89, v31)',
      description: 'Full KYB data for the administration workbench: structured entity-layer verdict, beneficial owners (with display-safe party summaries and numeric participation), and composed owner-layer risk (each UBO KYC verdict by reference). No CHD, no owner PII duplication (GDPR minimization).',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: E, 403: E, 404: E },
    },
    preHandler: canView,
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = (request as { user?: JwtUserPayload }).user;
      const result = await getKybDetail(fastify.db, id);
      if (result.status === 'not_found') return reply.status(404).send({ error: 'Merchant not found' });
      if (user?.role === 'customer' && !isMerchantOwner(result.merchant as never, user?.partyRef)) {
        return reply.status(403).send({ error: 'Access denied: you can only view your own merchant.' });
      }
      return reply.send(result);
    },
  });

  // PATCH /:id/kyb, correct KYB data fields. amendmentReason required. Rejects status/verdict writes.
  fastify.patch('/:id/kyb', {
    schema: {
      tags: ['merchants'],
      summary: 'Correct KYB data (SD-89, v31), data administration, not a decision',
      description: 'Edits permitted KYB data fields (legal entity, MCC, category, name, country, KYB notes). **Rejects (400) any write to a status/verdict field**, approve/reject stays on /:id/review (merchant_officer). Requires `merchants:manage` and an `amendmentReason`. Emits `kyb.record.amended`.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['amendmentReason'],
        properties: {
          amendmentReason: { type: 'string', minLength: 3, description: 'Why this correction was made (audit trail, PCI Req 10).' },
          merchantLegalEntityReference: { type: 'string' },
          merchantCategoryCode: { type: 'string' },
          merchantName: { type: 'string' },
          merchantCountryCode: { type: 'string' },
          merchantAgreementKybCheckNotes: { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 401: E, 403: E, 404: E },
    },
    preHandler: canManage,
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = { ...(request.body as Record<string, unknown>) };
      const amendmentReason = String(body.amendmentReason ?? '');
      delete body.amendmentReason;
      // Defense in depth: explicitly reject any verdict/status/lifecycle field (decision 2).
      const forbidden = Object.keys(body).filter((k) => /status|verdict|kybcheckstatus|agreementstatus/i.test(k) && k !== 'merchantAgreementKybCheckNotes');
      if (forbidden.length) return reply.status(400).send({ error: `Verdict/status fields cannot be edited here: ${forbidden.join(', ')}. Use the review decision flow.` });
      const result = await patchKybData(fastify.db, id, body, amendmentReason, actorOf(request as never));
      if (result.status === 'not_found') return reply.status(404).send({ error: 'Merchant not found' });
      if (result.status === 'invalid') return reply.status(400).send({ error: result.error });
      return reply.send(result.merchant);
    },
  });

  // GET /:id/kyb/owners, the shareholder list. Any merchant owner or staff (merchants:view).
  fastify.get('/:id/kyb/owners', {
    schema: {
      tags: ['merchants'],
      summary: 'Beneficial owners / shareholders (SD-89 + SD-13, v31)',
      description: 'Lists each beneficial owner with numeric participation, role, primary/controlling flags and a display-safe party summary. Any beneficial owner or PSP staff (`merchants:view`) may read it.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: E, 403: E, 404: E },
    },
    preHandler: canView,
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = (request as { user?: JwtUserPayload }).user;
      const merchant = await getMerchantById(fastify.db, id);
      if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
      if (user?.role === 'customer' && !isMerchantOwner(merchant as never, user?.partyRef)) {
        return reply.status(403).send({ error: 'Access denied: you can only view your own merchant.' });
      }
      const result = await listBeneficialOwners(fastify.db, id);
      if (result.status === 'not_found') return reply.status(404).send({ error: 'Merchant not found' });
      return reply.send(result);
    },
  });

  // POST /:id/kyb/owners, add owner (references an existing party). Enforces invariants.
  fastify.post('/:id/kyb/owners', {
    schema: {
      tags: ['merchants'],
      summary: 'Add a beneficial owner (SD-89 + SD-13, v31)',
      description: 'Adds a beneficial owner (ownership metadata only; PII is edited on the party record). Enforces §3.2 invariants: participation 0..100, sum ≤ 100, exactly one primary. Emits `kyb.owner.added`.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['merchantBeneficialOwnerPartyReference', 'merchantBeneficialOwnerRole', 'merchantBeneficialOwnerOwnershipPercentage'],
        properties: {
          merchantBeneficialOwnerPartyReference: { type: 'string' },
          merchantBeneficialOwnerRole: { type: 'string', enum: OWNER_ROLE_ENUM },
          merchantBeneficialOwnerOwnershipPercentage: { type: 'number', minimum: 0, maximum: 100 },
          merchantBeneficialOwnerIsPrimary: { type: 'boolean' },
          merchantBeneficialOwnerIsControllingPerson: { type: 'boolean' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 401: E, 403: E, 404: E, 409: E },
    },
    preHandler: canManage,
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await addBeneficialOwner(fastify.db, id, request.body as never, actorOf(request as never));
      return sendOwnerResult(reply, result);
    },
  });

  // PATCH /:id/kyb/owners/:partyRef, edit role/percentage/primary flag only (no PII).
  fastify.patch('/:id/kyb/owners/:partyRef', {
    schema: {
      tags: ['merchants'],
      summary: 'Edit a beneficial owner (SD-89 + SD-13, v31)',
      description: 'Edits ownership metadata only (role, participation %, primary/controlling flags). Promoting a new primary demotes the previous one atomically. PII is edited on the party record. Emits `kyb.owner.amended` (and `kyb.owner.primary.reassigned` when the primary changes).',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id', 'partyRef'], properties: { id: { type: 'string' }, partyRef: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          merchantBeneficialOwnerRole: { type: 'string', enum: OWNER_ROLE_ENUM },
          merchantBeneficialOwnerOwnershipPercentage: { type: 'number', minimum: 0, maximum: 100 },
          merchantBeneficialOwnerIsPrimary: { type: 'boolean' },
          merchantBeneficialOwnerIsControllingPerson: { type: 'boolean' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 401: E, 403: E, 404: E, 409: E },
    },
    preHandler: canManage,
    handler: async (request, reply) => {
      const { id, partyRef } = request.params as { id: string; partyRef: string };
      const result = await updateBeneficialOwner(fastify.db, id, partyRef, request.body as never, actorOf(request as never));
      return sendOwnerResult(reply, result);
    },
  });

  // DELETE /:id/kyb/owners/:partyRef, remove owner (blocked if last or primary).
  fastify.delete('/:id/kyb/owners/:partyRef', {
    schema: {
      tags: ['merchants'],
      summary: 'Remove a beneficial owner (SD-89 + SD-13, v31)',
      description: 'Removes a beneficial owner. Blocked (400) if it is the last owner or the primary (reassign the primary first). Emits `kyb.owner.removed`.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id', 'partyRef'], properties: { id: { type: 'string' }, partyRef: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 401: E, 403: E, 404: E, 409: E },
    },
    preHandler: canManage,
    handler: async (request, reply) => {
      const { id, partyRef } = request.params as { id: string; partyRef: string };
      const result = await removeBeneficialOwner(fastify.db, id, partyRef, actorOf(request as never));
      return sendOwnerResult(reply, result);
    },
  });

  // GET /:id/kyb/process, correlated process timeline (§5bis.5): every bus milestone + provider call.
  fastify.get('/:id/kyb/process', {
    schema: {
      tags: ['merchants'],
      summary: 'KYB correlated process timeline (SD-89, v31)',
      description: 'Reconstructs the KYB journey from its correlationId (= merchant instance ref): every `*.requested`/`*.completed` bus milestone and every provider wire call (sanitized request/response, PCI Req 10.7). Answers what ran, how many providers were called, what each responded, and what parameters were sent.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: { type: 'object', properties: { page: { type: 'integer', minimum: 1, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: E, 403: E, 404: E },
    },
    preHandler: canView,
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const { page = 1, limit = 100 } = request.query as { page?: number; limit?: number };
      const user = (request as { user?: JwtUserPayload }).user;
      const merchant = await getMerchantById(fastify.db, id);
      if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });
      if (user?.role === 'customer' && !isMerchantOwner(merchant as never, user?.partyRef)) {
        return reply.status(403).send({ error: 'Access denied: you can only view your own merchant.' });
      }
      const result = await listAuditEvents(fastify.db, { source: 'all', ref: id, entityType: 'merchant', page: Number(page), limit: Number(limit), request });
      return reply.send(result);
    },
  });
}

function sendOwnerResult(reply: import('fastify').FastifyReply, result: { status: string; error?: string; owners?: unknown }) {
  switch (result.status) {
    case 'not_found': return reply.status(404).send({ error: 'Merchant not found' });
    case 'invalid': return reply.status(400).send({ error: result.error });
    case 'conflict': return reply.status(409).send({ error: 'The merchant was modified concurrently. Retry.' });
    default: return reply.send({ owners: result.owners });
  }
}
