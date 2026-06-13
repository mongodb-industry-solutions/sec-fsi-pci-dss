import { FastifyInstance } from 'fastify';
import type { DemoRequest } from '../../../shared/models/identity.model';
import {
  listProcessEvents,
  listComplianceEvents,
} from '../services/businessProcessEvent.service';
import type { BusinessProcessType, ComplianceProcessType, BusinessEntityType } from '../models/externalProviderArrangement.model';

const E = { type: 'object', properties: { error: { type: 'string' } } };

function isAuditRole(request: DemoRequest): boolean {
  return request.demoRole === 'security_auditor' || request.demoRole === 'manager';
}

export async function processEventController(fastify: FastifyInstance) {
  // ── GET /events/process ────────────────────────────────────────────────────
  fastify.get('/process', {
    schema: {
      tags: ['events'],
      summary: 'List business process events (ADR-025)',
      description: 'Returns paginated businessProcessEvent documents. Requires security_auditor or manager role.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          processType: { type: 'string' },
          entityType:  { type: 'string' },
          from:        { type: 'string', format: 'date-time' },
          to:          { type: 'string', format: 'date-time' },
          page:        { type: 'integer', minimum: 1, default: 1 },
          limit:       { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: { type: 'object', properties: { events: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } },
        403: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuditRole(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden: security_auditor or manager role required' });

      const q = request.query as Record<string, string>;
      const result = await listProcessEvents(fastify.db, {
        processType: q.processType as BusinessProcessType | undefined,
        entityType:  q.entityType  as BusinessEntityType  | undefined,
        from:  q.from  ? new Date(q.from)  : undefined,
        to:    q.to    ? new Date(q.to)    : undefined,
        page:  q.page  ? parseInt(q.page,  10) : 1,
        limit: q.limit ? parseInt(q.limit, 10) : 20,
      });
      return reply.send(result);
    },
  });

  // ── GET /events/process/:entityType/:entityId ──────────────────────────────
  fastify.get<{ Params: { entityType: string; entityId: string } }>('/process/:entityType/:entityId', {
    schema: {
      tags: ['events'],
      summary: 'List process events for a specific business entity (ADR-025)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['entityType', 'entityId'],
        properties: {
          entityType: { type: 'string' },
          entityId:   { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          page:  { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
      response: {
        200: { type: 'object', properties: { events: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } },
        403: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuditRole(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden: security_auditor or manager role required' });

      const { entityType, entityId } = request.params;
      const q = request.query as Record<string, string>;
      const result = await listProcessEvents(fastify.db, {
        entityType: entityType as BusinessEntityType,
        entityId,
        page:  q.page  ? parseInt(q.page,  10) : 1,
        limit: q.limit ? parseInt(q.limit, 10) : 50,
      });
      return reply.send(result);
    },
  });

  // ── GET /events/compliance ─────────────────────────────────────────────────
  fastify.get('/compliance', {
    schema: {
      tags: ['events'],
      summary: 'List compliance process events (ADR-025)',
      description: 'Returns paginated complianceProcessEvent documents. Requires security_auditor or manager role.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          processType: { type: 'string' },
          entityType:  { type: 'string' },
          from:        { type: 'string', format: 'date-time' },
          to:          { type: 'string', format: 'date-time' },
          page:        { type: 'integer', minimum: 1, default: 1 },
          limit:       { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: { type: 'object', properties: { events: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } },
        403: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuditRole(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden: security_auditor or manager role required' });

      const q = request.query as Record<string, string>;
      const result = await listComplianceEvents(fastify.db, {
        processType: q.processType as ComplianceProcessType | undefined,
        entityType:  q.entityType  as BusinessEntityType    | undefined,
        from:  q.from  ? new Date(q.from)  : undefined,
        to:    q.to    ? new Date(q.to)    : undefined,
        page:  q.page  ? parseInt(q.page,  10) : 1,
        limit: q.limit ? parseInt(q.limit, 10) : 20,
      });
      return reply.send(result);
    },
  });

  // ── GET /events/compliance/:entityType/:entityId ───────────────────────────
  fastify.get<{ Params: { entityType: string; entityId: string } }>('/compliance/:entityType/:entityId', {
    schema: {
      tags: ['events'],
      summary: 'List compliance events for a specific business entity (ADR-025)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['entityType', 'entityId'],
        properties: {
          entityType: { type: 'string' },
          entityId:   { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          page:  { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
      response: {
        200: { type: 'object', properties: { events: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } },
        403: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuditRole(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden: security_auditor or manager role required' });

      const { entityType, entityId } = request.params;
      const q = request.query as Record<string, string>;
      const result = await listComplianceEvents(fastify.db, {
        entityType: entityType as BusinessEntityType,
        entityId,
        page:  q.page  ? parseInt(q.page,  10) : 1,
        limit: q.limit ? parseInt(q.limit, 10) : 50,
      });
      return reply.send(result);
    },
  });
}
