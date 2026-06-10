import { FastifyInstance } from 'fastify';
import type { DemoRequest } from '../../../shared/models/identity.model';
import {
  createIntegration,
  getIntegration,
  listIntegrations,
  updateIntegration,
  deleteIntegration,
  rotateKey,
  suspendIntegration,
} from '../services/integrationRegistry.service';
import {
  testIntegration,
  testMapping,
  getIntegrationEvents,
} from '../services/integrationDispatch.service';

const E = { type: 'object', properties: { error: { type: 'string' } } };

function isAuthorized(request: DemoRequest): boolean {
  return request.demoRole === 'manager';
}

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
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden: manager or system_admin role required' });

      const { type, status } = request.query as { type?: string; status?: string };
      const integrations = await listIntegrations(fastify.db, { type: type as never, status });
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
          externalProviderArrangementType:   { type: 'string', enum: ['fraud_detection','aml_monitoring','kyc_identity','kyb_business','hrp_sanctions','credit_bureau','generic'] },
          externalProviderApiEndpoint:       { type: 'string' },
          externalProviderArrangementStatus: { type: 'string', enum: ['active','inactive','test'] },
          externalProviderMode:              { type: 'string', enum: ['sync','async'] },
          externalProviderCallbackUrl:       { type: 'string' },
          externalProviderTimeoutMs:         { type: 'number', minimum: 100, maximum: 30000 },
          categoryConfig:                    { type: 'object' },
          authConfig:                        { type: 'object' },
          fieldMappingConfig:                { type: 'object' },
          routingGroupId:                    { type: 'string' },
          routingPriority:                   { type: 'number' },
          routingWeight:                     { type: 'number' },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        403: E,
        409: E,
        422: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden: manager or system_admin role required' });

      try {
        const body = request.body as Record<string, unknown>;
        const result = await createIntegration(fastify.db, {
          name:            body.externalProviderArrangementName as string,
          type:            body.externalProviderArrangementType as never,
          mode:            body.externalProviderMode as never,
          endpoint:        body.externalProviderApiEndpoint as string | undefined,
          callbackSecret:  body.externalProviderCallbackUrl as string | undefined,
          triggerEvents:   (body.externalProviderTriggerEvents as string[] | undefined) ?? [],
          timeoutMs:       body.externalProviderTimeoutMs as number | undefined,
          initialStatus:   body.externalProviderArrangementStatus as never,
          categoryConfig:  body.categoryConfig as never,
          authConfig:      body.authConfig as never,
          fieldMappingConfig: body.fieldMappingConfig as never,
          routingGroupId:  body.routingGroupId as string | undefined,
          routingPriority: body.routingPriority as number | undefined,
          routingWeight:   body.routingWeight as number | undefined,
        });
        return reply.status(201).send(result);
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code === 409) return reply.status(409).send({ error: 'A provider with this type and endpoint already exists' });
        if (code === 422) return reply.status(422).send({ error: (err as Error).message });
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
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });

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
          categoryConfig:                    { type: 'object' },
          authConfig:                        { type: 'object' },
          fieldMappingConfig:                { type: 'object' },
          routingGroupId:                    { type: 'string' },
          routingPriority:                   { type: 'number' },
          routingWeight:                     { type: 'number' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E, 422: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      const patch: Parameters<typeof updateIntegration>[2] = {};
      if (body.externalProviderApiEndpoint !== undefined)       patch.externalProviderApiEndpoint   = body.externalProviderApiEndpoint as string;
      if (body.externalProviderTriggerEvents !== undefined)     patch.externalProviderTriggerEvents = body.externalProviderTriggerEvents as string[];
      if (body.externalProviderMode !== undefined)              patch.externalProviderMode          = body.externalProviderMode as never;
      if (body.externalProviderTimeoutMs !== undefined)         patch.externalProviderTimeoutMs     = body.externalProviderTimeoutMs as number;
      if (body.externalProviderRetryPolicy !== undefined)       patch.externalProviderRetryPolicy   = body.externalProviderRetryPolicy as never;
      if (body.externalProviderArrangementStatus !== undefined) patch.externalProviderArrangementStatus = body.externalProviderArrangementStatus as never;
      if (body.categoryConfig !== undefined)                    patch.categoryConfig  = body.categoryConfig as never;
      if (body.authConfig !== undefined)                        patch.authConfig      = body.authConfig as never;
      if (body.fieldMappingConfig !== undefined)                patch.fieldMappingConfig = body.fieldMappingConfig as never;
      if (body.routingGroupId !== undefined)                    patch.routingGroupId  = body.routingGroupId as string;
      if (body.routingPriority !== undefined)                   patch.routingPriority = body.routingPriority as number;
      if (body.routingWeight !== undefined)                     patch.routingWeight   = body.routingWeight as number;

      try {
        const integration = await updateIntegration(fastify.db, id, patch);
        if (!integration) return reply.status(404).send({ error: 'Integration not found' });
        return { integration };
      } catch (err) {
        if ((err as { code?: number }).code === 422) return reply.status(422).send({ error: (err as Error).message });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/rotate-key ──────────────────────────────────────
  fastify.post('/:id/rotate-key', {
    schema: {
      tags: ['integrations'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });

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
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { status: { type: 'string' }, latencyMs: { type: 'number' } } }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      try {
        return await testIntegration(fastify.db, id);
      } catch (err) {
        if ((err as { code?: number }).code === 404) return reply.status(404).send({ error: 'Integration not found' });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/test-mapping ────────────────────────────────────
  fastify.post('/:id/test-mapping', {
    schema: {
      tags: ['integrations'],
      summary: 'Dry-run field mapping rules against a sample payload',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['direction', 'payload'],
        properties: {
          direction: { type: 'string', enum: ['outbound', 'inbound'] },
          payload:   { type: 'object' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      const { direction, payload } = request.body as { direction: 'outbound' | 'inbound'; payload: Record<string, unknown> };
      try {
        return await testMapping(fastify.db, id, direction, payload);
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
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });

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

  // ── DELETE /integrations/providers/:id ────────────────────────────────────
  fastify.delete('/:id', {
    schema: {
      tags: ['integrations'],
      summary: 'Delete an external integration provider',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: { type: 'object', properties: { deleted: { type: 'boolean' } } },
        400: E, 403: E, 404: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      try {
        const deleted = await deleteIntegration(fastify.db, id);
        if (!deleted) return reply.status(404).send({ error: 'Integration not found' });
        return { deleted: true };
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
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          page:  { type: 'string' },
          limit: { type: 'string' },
        },
      },
      response: { 200: { type: 'object' }, 403: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      const { page, limit } = request.query as { page?: string; limit?: string };
      return getIntegrationEvents(fastify.db, id, parseInt(page ?? '1'), parseInt(limit ?? '20'));
    },
  });
}
