import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import {
  listProcessEvents,
  listComplianceEvents,
  listAuditEvents,
  type AuditSource,
} from '../services/businessProcessEvent.service';
import type { BusinessProcessType, ComplianceProcessType, BusinessEntityType } from '../models/externalProviderArrangement.model';
import { MongoEventStore } from '../../../vendors/eventbus';

const E = { type: 'object', properties: { error: { type: 'string' } } };

// Access to the audit/process event streams is data-driven (ADR-030): gated on the auditEvents:view
// permission via requirePermission, so role/permission edits in the role collection (or custom roles
// granting auditEvents:view) are honored without touching this controller. Seeded holders today:
// security_auditor, manager, operations_officer (observes internal-module process outcomes) and
// level2_investigator. NOT level1_analyst or merchant_officer: the stream is cross-entity and
// neither has a job-related need (PCI DSS).
const requireAuditView = requirePermission('auditEvents', 'view');

export async function processEventController(fastify: FastifyInstance) {
  // ── GET /events/audit ───────────────────────────────────────────────────────
  // Unified audit view: business + compliance + integration events merged into one
  // normalized stream. Filters: source, type, outcome, q, date range. Auditor/manager.
  fastify.get('/audit', {
    schema: {
      tags: ['events'],
      summary: 'Unified audit event stream (business + compliance + integration + security)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          source:     { type: 'string', enum: ['all', 'business', 'compliance', 'integration', 'security'] },
          type:       { type: 'string' },
          entityType: { type: 'string', enum: ['fraud_case', 'transaction', 'customer', 'merchant', 'integration'] },
          outcome:    { type: 'string' },
          q:          { type: 'string' },
          ref:        { type: 'string', description: 'Related reference, finds every event for a transaction id, case id, merchant, customer/account ref, or card token.' },
          minScore:   { type: 'integer', minimum: 0, maximum: 100 },
          from:       { type: 'string', format: 'date-time' },
          to:         { type: 'string', format: 'date-time' },
          page:       { type: 'integer', minimum: 1, default: 1 },
          limit:      { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        403: E,
      },
    },
    preHandler: requireAuditView,
    handler: async (request, reply) => {
      const q = request.query as Record<string, string>;
      const result = await listAuditEvents(fastify.db, {
        source:     (q.source as AuditSource | 'all' | undefined) ?? 'all',
        type:       q.type || undefined,
        entityType: q.entityType || undefined,
        outcome:    q.outcome || undefined,
        q:          q.q || undefined,
        ref:        q.ref || undefined,
        minScore:   q.minScore !== undefined ? parseInt(q.minScore, 10) : undefined,
        from:       q.from ? new Date(q.from) : undefined,
        to:         q.to   ? new Date(q.to)   : undefined,
        page:       q.page  ? parseInt(q.page,  10) : 1,
        limit:      q.limit ? parseInt(q.limit, 10) : 20,
        // Forwarded so the identity slice is fetched with the CALLER's authority, not this service's.
        request,
      });
      return reply.send(result);
    },
  });

  // ── GET /events/trail/:correlationId ────────────────────────────────────────
  // dev.v8: the correlated journey. Every DomainEvent for one business-process instance
  // (e.g. a payment) in time order, so an investigator/auditor follows the whole story
  // (issuer + FDS + sanctions + AML + authorization) without cross-referencing logs.
  fastify.get('/trail/:correlationId', {
    schema: {
      tags: ['events'],
      summary: 'Correlated event trail for one journey (dev.v8 EDA)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['correlationId'], properties: { correlationId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E },
    },
    preHandler: requireAuditView,
    handler: async (request, reply) => {
      const { correlationId } = request.params as { correlationId: string };
      const events = await new MongoEventStore(fastify.db).trail(correlationId);
      return reply.send({ correlationId, count: events.length, events });
    },
  });

  // ── GET /events/process ────────────────────────────────────────────────────
  fastify.get('/process', {
    schema: {
      tags: ['events'],
      summary: 'List business process events (ADR-025)',
      description: 'Returns paginated businessProcessEvent documents. Requires the auditEvents:view permission (ADR-030 data-driven RBAC).',
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
    preHandler: requireAuditView,
    handler: async (request, reply) => {
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
    preHandler: requireAuditView,
    handler: async (request, reply) => {
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
      description: 'Returns paginated complianceProcessEvent documents. Requires the auditEvents:view permission (ADR-030 data-driven RBAC).',
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
    preHandler: requireAuditView,
    handler: async (request, reply) => {
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
    preHandler: requireAuditView,
    handler: async (request, reply) => {
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
