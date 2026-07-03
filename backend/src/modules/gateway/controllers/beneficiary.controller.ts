// BIAN SD-54: Counterparty Administration — staff-facing REST controller
// Routes mounted at /beneficiaries → /api/v1/beneficiaries
// Auth: JWT bearer + RBAC. Read ops: customers:view (L1+). Write ops: customers:viewSensitive (L2/auditor).
// PCI DSS Req 7 (least privilege): L1 can view contact aliases; L2/auditor can create, edit, remove.

import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import {
  listAllBeneficiaries,
  getOneBeneficiary,
  updateBeneficiaryLabel,
  removeBeneficiary,
  registerBeneficiary,
} from '../../identity/services/counterpartyArrangement.service';

export async function beneficiaryController(fastify: FastifyInstance) {

  // GET /api/v1/beneficiaries
  // List all beneficiaries across all users (staff global view)
  fastify.get('/', {
    preHandler: requirePermission('customers', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'List all beneficiary arrangements — staff view (SD-54)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          ownerRef: { type: 'string', description: 'Filter by owner partyInstanceReference' },
          q: { type: 'string', description: 'Search on label or masked contact hint' },
          status: { type: 'string', enum: ['active', 'removed'] },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as { ownerRef?: string; q?: string; status?: 'active' | 'removed'; page?: number; limit?: number };
    const { results, total } = await listAllBeneficiaries(fastify.db, {
      ownerRef: q.ownerRef,
      q: q.q,
      status: q.status,
      page: q.page,
      limit: q.limit,
    });
    return reply.send({ results, total, page: q.page ?? 1, limit: q.limit ?? 20 });
  });

  // GET /api/v1/beneficiaries/by-ref/:beneficiaryRef
  // Fetch a single record by its arrangement reference (no ownerRef needed — staff scope).
  // Must be registered before /:ownerRef to avoid parametric shadowing.
  fastify.get('/by-ref/:beneficiaryRef', {
    preHandler: requirePermission('customers', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Get a beneficiary arrangement by reference (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['beneficiaryRef'],
        properties: { beneficiaryRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { beneficiaryRef } = request.params as { beneficiaryRef: string };
    const record = await getOneBeneficiary(fastify.db, beneficiaryRef);
    if (!record) return reply.status(404).send({ error: 'Beneficiary not found' });
    return reply.send(record);
  });

  // GET /api/v1/beneficiaries/:ownerRef
  // List beneficiaries for a specific party (staff view of one customer's list)
  fastify.get('/:ownerRef', {
    preHandler: requirePermission('customers', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: "List a party's beneficiaries (SD-54)",
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef'],
        properties: { ownerRef: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const { ownerRef } = request.params as { ownerRef: string };
    const q = request.query as { page?: number; limit?: number };
    const { results, total } = await listAllBeneficiaries(fastify.db, { ownerRef, page: q.page, limit: q.limit });
    return reply.send({ results, total, page: q.page ?? 1, limit: q.limit ?? 20 });
  });

  // GET /api/v1/beneficiaries/:ownerRef/:beneficiaryRef
  // Get a single beneficiary record (with ownerRef context for audit purposes)
  fastify.get('/:ownerRef/:beneficiaryRef', {
    preHandler: requirePermission('customers', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Get a beneficiary arrangement (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef', 'beneficiaryRef'],
        properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };
    const record = await getOneBeneficiary(fastify.db, beneficiaryRef);
    if (!record) return reply.status(404).send({ error: 'Beneficiary not found' });
    return reply.send(record);
  });

  // PATCH /api/v1/beneficiaries/:ownerRef/:beneficiaryRef
  // Update the alias/label — the only mutable field on a CounterpartyArrangement (SD-54 §7.3).
  fastify.patch('/:ownerRef/:beneficiaryRef', {
    preHandler: requirePermission('customers', 'viewSensitive'),
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
        properties: {
          counterpartyLabel: { type: 'string', minLength: 1, maxLength: 80 },
        },
      },
    },
  }, async (request, reply) => {
    const { beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };
    const { counterpartyLabel } = request.body as { counterpartyLabel: string };
    const updated = await updateBeneficiaryLabel(fastify.db, beneficiaryRef, counterpartyLabel);
    if (!updated) return reply.status(404).send({ error: 'Beneficiary not found or already removed' });
    return reply.send(updated);
  });

  // POST /api/v1/beneficiaries/:ownerRef
  // Register a new beneficiary on behalf of a party (staff action — phone/email QE lookup).
  fastify.post('/:ownerRef', {
    preHandler: requirePermission('customers', 'viewSensitive'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Add a beneficiary for a party — staff action (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef'],
        properties: { ownerRef: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['lookupType', 'lookupValue'],
        properties: {
          lookupType: { type: 'string', enum: ['phone', 'email'] },
          lookupValue: { type: 'string', description: 'Raw phone number or email — QE equality search; NEVER stored.' },
          label: { type: 'string', maxLength: 80 },
        },
      },
    },
  }, async (request, reply) => {
    const { ownerRef } = request.params as { ownerRef: string };
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

  // DELETE /api/v1/beneficiaries/:ownerRef/:beneficiaryRef
  // Soft-delete a beneficiary (staff action — sets status to 'removed').
  fastify.delete('/:ownerRef/:beneficiaryRef', {
    preHandler: requirePermission('customers', 'viewSensitive'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Remove a beneficiary — staff action (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef', 'beneficiaryRef'],
        properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };
    const ok = await removeBeneficiary(fastify.db, ownerRef, beneficiaryRef);
    if (!ok) return reply.status(404).send({ error: 'Beneficiary not found' });
    return reply.send({ counterpartyArrangementReference: beneficiaryRef, counterpartyArrangementStatus: 'removed' });
  });
}
