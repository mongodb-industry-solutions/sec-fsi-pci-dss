import { FastifyInstance } from 'fastify';
import type { DemoRequest } from '../../../shared/models/identity.model';
import {
  createIntegration,
  getIntegration,
  listIntegrations,
  updateIntegration,
  rotateKey,
  suspendIntegration,
} from '../services/integrationRegistry.service';
import {
  testIntegration,
  getIntegrationEvents,
} from '../services/integrationDispatch.service';

const E = { type: 'object', properties: { error: { type: 'string' } } };

export async function integrationRegistryController(fastify: FastifyInstance) {
  // ── GET /integrations ──────────────────────────────────────────────────────
  fastify.get('/', {
    schema: {
      tags: ['integrations'],
      summary: 'List all integration providers (SD-193)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          type:   { type: 'string' },
          status: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', properties: { integrations: { type: 'array' } } },
        403: E,
      },
    },
    handler: async (request, reply) => {
      const { demoRole } = request as unknown as DemoRequest;
      if (demoRole !== 'manager') return reply.status(403).send({ error: 'Forbidden: manager role required' });

      const { type, status } = request.query as { type?: string; status?: string };
      const integrations = await listIntegrations(
        fastify.db,
        { type: type as never, status }
      );
      return { integrations };
    },
  });

  // ── POST /integrations ─────────────────────────────────────────────────────
  fastify.post('/', {
    schema: {
      tags: ['integrations'],
      summary: 'Register a new integration provider (SD-193)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['externalProviderArrangementName', 'externalProviderArrangementType', 'externalProviderMode'],
        properties: {
          externalProviderArrangementName:   { type: 'string', minLength: 1 },
          externalProviderArrangementType:   { type: 'string', enum: ['fraud_detection','aml_monitoring','kyc_identity','kyb_business','hrp_sanctions','credit_bureau'] },
          externalProviderApiEndpoint:       { type: 'string' },
          externalProviderArrangementStatus: { type: 'string', enum: ['active','inactive','test'] },
          externalProviderMode:              { type: 'string', enum: ['sync','async'] },
          externalProviderCallbackUrl:       { type: 'string' },
          externalProviderTimeoutMs:         { type: 'number', minimum: 100, maximum: 30000 },
        },
      },
      response: {
        201: { type: 'object' },
        403: E,
        409: E,
      },
    },
    handler: async (request, reply) => {
      const { demoRole } = request as unknown as DemoRequest;
      if (demoRole !== 'manager') return reply.status(403).send({ error: 'Forbidden: manager role required' });

      try {
        const body = request.body as Record<string, unknown>;
        const result = await createIntegration(fastify.db, {
          name:          body.externalProviderArrangementName as string,
          type:          body.externalProviderArrangementType as never,
          mode:          body.externalProviderMode as never,
          endpoint:      body.externalProviderApiEndpoint as string | undefined,
          callbackSecret: body.externalProviderCallbackUrl as string | undefined,
          triggerEvents: (body.externalProviderTriggerEvents as string[] | undefined) ?? [],
          timeoutMs:     body.externalProviderTimeoutMs as number | undefined,
        });
        return reply.status(201).send(result);
      } catch (err) {
        if ((err as { code?: number }).code === 409) return reply.status(409).send({ error: 'A provider with this type and endpoint already exists' });
        throw err;
      }
    },
  });

  // ── GET /integrations/:id ──────────────────────────────────────────────────
  fastify.get('/:id', {
    schema: {
      tags: ['integrations'],
      summary: 'Get integration provider detail',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: { type: 'object' },
        403: E,
        404: E,
      },
    },
    handler: async (request, reply) => {
      const { demoRole } = request as unknown as DemoRequest;
      if (demoRole !== 'manager') return reply.status(403).send({ error: 'Forbidden: manager role required' });

      const { id } = request.params as { id: string };
      const integration = await getIntegration(fastify.db, id);
      if (!integration) return reply.status(404).send({ error: 'Integration not found' });
      return { integration };
    },
  });

  // ── PATCH /integrations/:id ────────────────────────────────────────────────
  fastify.patch('/:id', {
    schema: {
      tags: ['integrations'],
      summary: 'Update integration provider configuration',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          externalProviderApiEndpoint:       { type: 'string' },
          externalProviderTriggerEvents:     { type: 'array', items: { type: 'string' } },
          externalProviderMode:              { type: 'string', enum: ['sync','async'] },
          externalProviderTimeoutMs:         { type: 'number', minimum: 100, maximum: 30000 },
          externalProviderRetryPolicy:       { type: 'object' },
          externalProviderArrangementStatus: { type: 'string', enum: ['active','inactive','test'] },
        },
      },
      response: {
        200: { type: 'object' },
        403: E,
        404: E,
      },
    },
    handler: async (request, reply) => {
      const { demoRole } = request as unknown as DemoRequest;
      if (demoRole !== 'manager') return reply.status(403).send({ error: 'Forbidden: manager role required' });

      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      const patch: Parameters<typeof updateIntegration>[2] = {};
      if (body.externalProviderApiEndpoint !== undefined)       patch.externalProviderApiEndpoint   = body.externalProviderApiEndpoint as string;
      if (body.externalProviderTriggerEvents !== undefined)     patch.externalProviderTriggerEvents = body.externalProviderTriggerEvents as string[];
      if (body.externalProviderMode !== undefined)              patch.externalProviderMode          = body.externalProviderMode as never;
      if (body.externalProviderTimeoutMs !== undefined)         patch.externalProviderTimeoutMs     = body.externalProviderTimeoutMs as number;
      if (body.externalProviderRetryPolicy !== undefined)       patch.externalProviderRetryPolicy   = body.externalProviderRetryPolicy as never;
      if (body.externalProviderArrangementStatus !== undefined) patch.externalProviderArrangementStatus = body.externalProviderArrangementStatus as never;

      const integration = await updateIntegration(fastify.db, id, patch);
      if (!integration) return reply.status(404).send({ error: 'Integration not found' });
      return { integration };
    },
  });

  // ── POST /integrations/:id/rotate-key ──────────────────────────────────────
  fastify.post('/:id/rotate-key', {
    schema: {
      tags: ['integrations'],
      summary: 'Rotate API key for integration provider',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: { type: 'object' },
        400: E,
        403: E,
        404: E,
      },
    },
    handler: async (request, reply) => {
      const { demoRole } = request as unknown as DemoRequest;
      if (demoRole !== 'manager') return reply.status(403).send({ error: 'Forbidden: manager role required' });

      const { id } = request.params as { id: string };
      try {
        const result = await rotateKey(fastify.db, id);
        if (!result) return reply.status(404).send({ error: 'Integration not found' });
        return result;
      } catch (err) {
        if ((err as { code?: number }).code === 400) return reply.status(400).send({ error: (err as Error).message });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/test ─────────────────────────────────────────────
  fastify.post('/:id/test', {
    schema: {
      tags: ['integrations'],
      summary: 'Test connectivity for integration provider',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: { type: 'object', properties: { status: { type: 'string' }, latencyMs: { type: 'number' } } },
        403: E,
        404: E,
      },
    },
    handler: async (request, reply) => {
      const { demoRole } = request as unknown as DemoRequest;
      if (demoRole !== 'manager') return reply.status(403).send({ error: 'Forbidden: manager role required' });

      const { id } = request.params as { id: string };
      try {
        const result = await testIntegration(fastify.db, id);
        return result;
      } catch (err) {
        if ((err as { code?: number }).code === 404) return reply.status(404).send({ error: 'Integration not found' });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/suspend ──────────────────────────────────────────
  fastify.post('/:id/suspend', {
    schema: {
      tags: ['integrations'],
      summary: 'Suspend an integration provider',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: { type: 'object' },
        400: E,
        403: E,
        404: E,
      },
    },
    handler: async (request, reply) => {
      const { demoRole } = request as unknown as DemoRequest;
      if (demoRole !== 'manager') return reply.status(403).send({ error: 'Forbidden: manager role required' });

      const { id } = request.params as { id: string };
      try {
        const integration = await suspendIntegration(fastify.db, id);
        if (!integration) return reply.status(404).send({ error: 'Integration not found' });
        return { integration };
      } catch (err) {
        if ((err as { code?: number }).code === 400) return reply.status(400).send({ error: (err as Error).message });
        throw err;
      }
    },
  });

  // ── GET /integrations/:id/events ────────────────────────────────────────────
  fastify.get('/:id/events', {
    schema: {
      tags: ['integrations'],
      summary: 'Get integration event log (paginated)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          page:  { type: 'string' },
          limit: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object' },
        403: E,
      },
    },
    handler: async (request, reply) => {
      const { demoRole } = request as unknown as DemoRequest;
      if (demoRole !== 'manager') return reply.status(403).send({ error: 'Forbidden: manager role required' });

      const { id } = request.params as { id: string };
      const { page, limit } = request.query as { page?: string; limit?: string };
      const result = await getIntegrationEvents(fastify.db, id, parseInt(page ?? '1'), parseInt(limit ?? '20'));
      return result;
    },
  });
}
