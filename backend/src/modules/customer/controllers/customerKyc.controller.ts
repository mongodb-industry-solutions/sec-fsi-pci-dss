// BIAN SD-53 KYC Administration controller (v31). Mounted under /customer (same prefix as the
// customer-agreement search controller — one customer surface, no forked API). The Operations Officer
// reviews/corrects KYC data here; sensitive identity fields stay behind the L1/L2 QE tiers + escalation
// token (never decrypted without viewSensitive). Verdict/status is not editable here (decision 2).

import { FastifyInstance } from 'fastify';
import type { AuthenticatedRequest, JwtUserPayload } from '../../../shared/models/identity.model';
import { requirePermission } from '../../../vendors/middleware/acl';
import { getEventBus, makeEvent } from '../../../vendors/eventbus';
import { listAuditEvents } from '../../provider/services/businessProcessEvent.service';
import { listKycAdmin, getKycByPartyRef, patchKycData } from '../services/customerAgreement.service';

const E = { $ref: 'Error#' };

function actor(request: unknown) {
  const u = (request as { user?: JwtUserPayload }).user;
  return { performedByPartyReference: u?.partyRef ?? u?.sub, performedByRole: u?.role };
}

export async function customerKycController(fastify: FastifyInstance) {
  const canView = requirePermission('customers', 'view');
  const canManage = requirePermission('customers', 'manage');

  // GET /customer/kyc — paged list of KYC-completed parties (L1 masked). requirePermission customers:view.
  fastify.get('/kyc', {
    schema: {
      tags: ['customer'],
      summary: 'KYC administration list (SD-53, v31)',
      description: 'Paged list of parties that completed KYC (status in verified/rejected/expired). Masked by default (L1). Index-backed filter + sort. Filters: `status`, `segment`, `riskRating`.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['verified', 'rejected', 'expired'] },
          segment: { type: 'string', enum: ['retail', 'premium', 'corporate', 'sme'] },
          riskRating: { type: 'string', enum: ['low', 'medium', 'high'] },
          partyType: { type: 'string', enum: ['customer', 'employee', 'service_account', 'all'], description: 'Party type filter (UI defaults to customer). `all` applies no type constraint.' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: E, 403: E },
    },
    preHandler: canView,
    handler: async (request, reply) => {
      const { userRole } = request as unknown as AuthenticatedRequest;
      const q = request.query as { status?: string; segment?: string; riskRating?: string; partyType?: string; page?: number; limit?: number };
      const result = await listKycAdmin(userRole, q);
      return reply.send(result);
    },
  });

  // GET /customer/:partyInstanceReference/kyc — full KYC detail. L2 decrypt only with viewSensitive.
  fastify.get('/:partyInstanceReference/kyc', {
    schema: {
      tags: ['customer'],
      summary: 'KYC administration detail (SD-53, v31)',
      description: 'Full KYC record for a party. Sensitive identity fields (address, gov ID, source of funds) are decrypted only for a caller holding the escalation token (viewSensitive); otherwise masked.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['partyInstanceReference'], properties: { partyInstanceReference: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: E, 403: E, 404: E },
    },
    preHandler: canView,
    handler: async (request, reply) => {
      const { partyInstanceReference } = request.params as { partyInstanceReference: string };
      const { userRole, escalationToken } = request as unknown as AuthenticatedRequest;
      const u = (request as { user?: JwtUserPayload }).user;
      const result = await getKycByPartyRef(fastify.db, partyInstanceReference, userRole, escalationToken, { ref: u?.partyRef ?? u?.sub, name: u?.name });
      if (!result) return reply.status(404).send({ error: 'KYC record not found' });
      return reply.send(result);
    },
  });

  // PATCH /customer/:partyInstanceReference/kyc — correct KYC data. amendmentReason required.
  fastify.patch('/:partyInstanceReference/kyc', {
    schema: {
      tags: ['customer'],
      summary: 'Correct KYC data (SD-53, v31) — data administration, not a decision',
      description: 'Edits permitted KYC data fields (occupation, source of funds, government ID, address, purpose of relationship). **Rejects (400) any write to `customerAgreementKycCheckStatus`** — the verdict is not editable here. Requires `customers:manage` and an `amendmentReason`. Emits `kyc.record.amended`.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['partyInstanceReference'], properties: { partyInstanceReference: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['amendmentReason'],
        properties: {
          amendmentReason: { type: 'string', minLength: 3 },
          customerAgreementOccupation: { type: 'string' },
          customerAgreementSourceOfFunds: { type: 'string' },
          customerAgreementPurposeOfRelationship: { type: 'string' },
          customerAgreementGovernmentID: { type: 'object', additionalProperties: true },
          customerAgreementResidentialAddress: { type: 'object', additionalProperties: true },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 401: E, 403: E, 404: E },
    },
    preHandler: canManage,
    handler: async (request, reply) => {
      const { partyInstanceReference } = request.params as { partyInstanceReference: string };
      const body = { ...(request.body as Record<string, unknown>) };
      const amendmentReason = String(body.amendmentReason ?? '');
      delete body.amendmentReason;
      const forbidden = Object.keys(body).filter((k) => /status|verdict|riskrating|riskscore|pepstatus|sanctions/i.test(k));
      if (forbidden.length) return reply.status(400).send({ error: `Verdict/status fields cannot be edited here: ${forbidden.join(', ')}.` });
      const result = await patchKycData(fastify.db, partyInstanceReference, body, amendmentReason, actor(request));
      if (result.status === 'not_found') return reply.status(404).send({ error: 'KYC record not found' });
      if (result.status === 'invalid') return reply.status(400).send({ error: result.error });
      return reply.send({ partyInstanceReference, updated: true });
    },
  });

  // POST /customer/:partyInstanceReference/kyc/re-screen — re-trigger KYC screening via the port (events).
  fastify.post('/:partyInstanceReference/kyc/re-screen', {
    schema: {
      tags: ['customer'],
      summary: 'Re-trigger KYC screening (SD-53, v31)',
      description: 'Publishes `kyc.screening.requested` on the bus (correlationId = partyInstanceReference); the ProviderGroups reactor dispatches the screening provider via the port, keeping the engine swappable. Requires `customers:manage`.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['partyInstanceReference'], properties: { partyInstanceReference: { type: 'string' } } },
      response: { 202: { type: 'object', additionalProperties: true }, 401: E, 403: E },
    },
    preHandler: canManage,
    handler: async (request, reply) => {
      const { partyInstanceReference } = request.params as { partyInstanceReference: string };
      try {
        getEventBus().publish(makeEvent({
          eventType: 'kyc.screening.requested', correlationId: partyInstanceReference, businessProcess: 'customer_onboarding',
          source: 'psp.core', payload: { partyInstanceReference },
          bian: { serviceDomain: 'SD-13 Party Data Management', controlRecord: 'PartyReferenceDataDirectoryEntry' },
        }));
      } catch { /* bus not initialized */ }
      return reply.status(202).send({ partyInstanceReference, rescreenRequested: true });
    },
  });

  // GET /customer/:partyInstanceReference/kyc/process — correlated KYC process timeline (§5bis.5).
  fastify.get('/:partyInstanceReference/kyc/process', {
    schema: {
      tags: ['customer'],
      summary: 'KYC correlated process timeline (SD-53, v31)',
      description: 'Reconstructs the KYC journey from its correlationId (= partyInstanceReference): bus milestones + provider wire calls (sanitized, PCI Req 10.7).',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['partyInstanceReference'], properties: { partyInstanceReference: { type: 'string' } } },
      querystring: { type: 'object', properties: { page: { type: 'integer', minimum: 1, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: E, 403: E },
    },
    preHandler: canView,
    handler: async (request, reply) => {
      const { partyInstanceReference } = request.params as { partyInstanceReference: string };
      const { page = 1, limit = 100 } = request.query as { page?: number; limit?: number };
      const result = await listAuditEvents(fastify.db, { source: 'all', ref: partyInstanceReference, entityType: 'customer', page: Number(page), limit: Number(limit) });
      return reply.send(result);
    },
  });
}
