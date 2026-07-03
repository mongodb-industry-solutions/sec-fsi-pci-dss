// BIAN SD-54: Counterparty Administration + SD-65: P2P Payment Execution — staff & customer REST controller
// Routes mounted at /beneficiaries → /api/v1/beneficiaries
// Auth: JWT bearer + RBAC (beneficiaries:view / beneficiaries:manage).
// Customer scope (roleScope: 'own'): requests with role=customer are restricted to their own partyRef.
// PCI DSS Req 7 (least privilege) · Req 10 (P2P transfer audit trail).

import { FastifyInstance } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { requirePermission } from '../../../vendors/middleware/acl';
import {
  listAllBeneficiaries,
  getOneBeneficiary,
  updateBeneficiaryLabel,
  removeBeneficiary,
  registerBeneficiary,
} from '../../identity/services/counterpartyArrangement.service';
import { executeP2PTransfer } from '../services/p2pTransfer.service';

function getUser(request: unknown): JwtUserPayload | undefined {
  return (request as { user?: JwtUserPayload }).user;
}

export async function beneficiaryController(fastify: FastifyInstance) {

  // GET /api/v1/beneficiaries
  // Staff: list all with optional filters. Customer: auto-scoped to own partyRef.
  fastify.get('/', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'List beneficiary arrangements (SD-54)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          ownerRef: { type: 'string' },
          q: { type: 'string' },
          status: { type: 'string', enum: ['active', 'removed'] },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const q = request.query as { ownerRef?: string; q?: string; status?: 'active' | 'removed'; page?: number; limit?: number };

    // Customer scope: ignore any ownerRef in query, force to own partyRef
    const ownerRef = user?.role === 'customer' ? user.partyRef : q.ownerRef;

    const { results, total } = await listAllBeneficiaries(fastify.db, {
      ownerRef,
      q: q.q,
      status: q.status,
      page: q.page,
      limit: q.limit,
    });
    return reply.send({ results, total, page: q.page ?? 1, limit: q.limit ?? 20 });
  });

  // GET /api/v1/beneficiaries/by-ref/:beneficiaryRef
  // Fetch a single record by arrangement reference. Must be before /:ownerRef.
  fastify.get('/by-ref/:beneficiaryRef', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Get a beneficiary arrangement by reference (SD-54)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['beneficiaryRef'], properties: { beneficiaryRef: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { beneficiaryRef } = request.params as { beneficiaryRef: string };
    const record = await getOneBeneficiary(fastify.db, beneficiaryRef);
    if (!record) return reply.status(404).send({ error: 'Beneficiary not found' });

    // Customer scope: verify ownership
    if (user?.role === 'customer' && record.ownerPartyReference !== user.partyRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    return reply.send(record);
  });

  // GET /api/v1/beneficiaries/:ownerRef
  fastify.get('/:ownerRef', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: "List a party's beneficiaries (SD-54)",
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['ownerRef'], properties: { ownerRef: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { ownerRef } = request.params as { ownerRef: string };
    if (user?.role === 'customer' && user.partyRef !== ownerRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    const q = request.query as { page?: number; limit?: number };
    const { results, total } = await listAllBeneficiaries(fastify.db, { ownerRef, page: q.page, limit: q.limit });
    return reply.send({ results, total, page: q.page ?? 1, limit: q.limit ?? 20 });
  });

  // GET /api/v1/beneficiaries/:ownerRef/:beneficiaryRef
  fastify.get('/:ownerRef/:beneficiaryRef', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Get a single beneficiary arrangement (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef', 'beneficiaryRef'],
        properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };
    if (user?.role === 'customer' && user.partyRef !== ownerRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    const record = await getOneBeneficiary(fastify.db, beneficiaryRef);
    if (!record) return reply.status(404).send({ error: 'Beneficiary not found' });
    return reply.send(record);
  });

  // PATCH /api/v1/beneficiaries/:ownerRef/:beneficiaryRef — update label/alias
  fastify.patch('/:ownerRef/:beneficiaryRef', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Update beneficiary label/alias (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef', 'beneficiaryRef'],
        properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['counterpartyLabel'],
        properties: { counterpartyLabel: { type: 'string', minLength: 1, maxLength: 80 } },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };
    if (user?.role === 'customer' && user.partyRef !== ownerRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    const { counterpartyLabel } = request.body as { counterpartyLabel: string };
    const updated = await updateBeneficiaryLabel(fastify.db, beneficiaryRef, counterpartyLabel);
    if (!updated) return reply.status(404).send({ error: 'Beneficiary not found or already removed' });
    return reply.send(updated);
  });

  // POST /api/v1/beneficiaries/:ownerRef — register new beneficiary via phone/email lookup
  fastify.post('/:ownerRef', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Add a beneficiary by phone/email lookup (SD-54)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['ownerRef'], properties: { ownerRef: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['lookupType', 'lookupValue'],
        properties: {
          lookupType: { type: 'string', enum: ['phone', 'email'] },
          lookupValue: { type: 'string' },
          label: { type: 'string', maxLength: 80 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { ownerRef } = request.params as { ownerRef: string };
    if (user?.role === 'customer' && user.partyRef !== ownerRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    const body = request.body as { lookupType: 'phone' | 'email'; lookupValue: string; label?: string };
    try {
      const result = await registerBeneficiary(fastify.db, {
        ownerPartyReference: ownerRef,
        lookupType: body.lookupType,
        lookupValue: body.lookupValue,
        label: body.label,
      });
      return reply.send(result);
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode === 422) return reply.status(422).send({ error: e.message });
      throw err;
    }
  });

  // DELETE /api/v1/beneficiaries/:ownerRef/:beneficiaryRef — soft-delete
  fastify.delete('/:ownerRef/:beneficiaryRef', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Remove a beneficiary (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef', 'beneficiaryRef'],
        properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };
    if (user?.role === 'customer' && user.partyRef !== ownerRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    const ok = await removeBeneficiary(fastify.db, ownerRef, beneficiaryRef);
    if (!ok) return reply.status(404).send({ error: 'Beneficiary not found' });
    return reply.send({ counterpartyArrangementReference: beneficiaryRef, counterpartyArrangementStatus: 'removed' });
  });

  // POST /api/v1/beneficiaries/:ownerRef/:beneficiaryRef/transfer
  // Initiate a P2P transfer from a customer's payout account to a saved beneficiary.
  // BIAN SD-65 Payment Execution · PCI DSS Req 10 (immutable audit record created).
  fastify.post('/:ownerRef/:beneficiaryRef/transfer', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Send money to a beneficiary — P2P transfer (SD-65)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef', 'beneficiaryRef'],
        properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['fromAccountRef', 'amount', 'currency'],
        properties: {
          fromAccountRef: { type: 'string' },
          amount: { type: 'number', exclusiveMinimum: 0 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          note: { type: 'string', maxLength: 140 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };

    // Customer scope: can only transfer from own accounts to own beneficiaries
    if (user?.role === 'customer' && user.partyRef !== ownerRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }

    const body = request.body as { fromAccountRef: string; amount: number; currency: string; note?: string };

    const result = await executeP2PTransfer(fastify.db, {
      initiatorPartyRef: ownerRef,
      counterpartyArrangementRef: beneficiaryRef,
      fromAccountRef: body.fromAccountRef,
      amount: body.amount,
      currency: body.currency,
      note: body.note,
    });

    if (result.status === 'failed') {
      return reply.status(422).send({ error: result.failureReason ?? 'Transfer failed.' });
    }

    return reply.send(result);
  });
}
