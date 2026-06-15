import { FastifyInstance } from 'fastify';
import type { DemoRequest } from '../../../shared/models/identity.model';
import {
  createRoutingGroup,
  getRoutingGroup,
  listRoutingGroups,
  updateRoutingGroup,
  addMemberToGroup,
  removeMemberFromGroup,
  getDefaultGroupForType,
  deleteRoutingGroup,
} from '../services/integrationRoutingGroup.service';

const E = { type: 'object', properties: { error: { type: 'string' } } };

function isAuthorized(request: DemoRequest): boolean {
  return request.demoRole === 'manager';
}

export async function integrationRoutingGroupController(fastify: FastifyInstance) {
  // ── GET /integration-groups ────────────────────────────────────────────────
  fastify.get('/', {
    schema: {
      tags: ['providers'],
      summary: 'List routing groups (SD-193)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { type: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const { type } = request.query as { type?: string };
      const groups = await listRoutingGroups(fastify.db, { type: type as never });
      return { groups };
    },
  });

  // ── POST /integration-groups ───────────────────────────────────────────────
  fastify.post('/', {
    schema: {
      tags: ['providers'],
      summary: 'Create a routing group',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'providerType', 'strategy'],
        properties: {
          name:         { type: 'string', minLength: 1 },
          providerType: { type: 'string' },
          strategy:     { type: 'string', enum: ['primary_fallback', 'round_robin', 'weighted', 'parallel'] },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 403: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const body = request.body as { name: string; providerType: string; strategy: string };
      const group = await createRoutingGroup(fastify.db, {
        name: body.name,
        providerType: body.providerType as never,
        strategy: body.strategy as never,
      });
      return reply.status(201).send({ group });
    },
  });

  // ── GET /integration-groups/:id ────────────────────────────────────────────
  fastify.get('/:id', {
    schema: {
      tags: ['providers'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const { id } = request.params as { id: string };
      const group = await getRoutingGroup(fastify.db, id);
      if (!group) return reply.status(404).send({ error: 'Routing group not found' });
      return { group };
    },
  });

  // ── PATCH /integration-groups/:id ─────────────────────────────────────────
  fastify.patch('/:id', {
    schema: {
      tags: ['providers'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          routingGroupName:     { type: 'string' },
          routingGroupStrategy: { type: 'string' },
          routingGroupStatus:   { type: 'string', enum: ['active', 'inactive'] },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, string>;
      const group = await updateRoutingGroup(fastify.db, id, {
        routingGroupName: body.routingGroupName,
        routingGroupStrategy: body.routingGroupStrategy as never,
        routingGroupStatus: body.routingGroupStatus as never,
      });
      if (!group) return reply.status(404).send({ error: 'Routing group not found' });
      return { group };
    },
  });

  // ── POST /integration-groups/:id/members ──────────────────────────────────
  fastify.post('/:id/members', {
    schema: {
      tags: ['providers'],
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['providerId'],
        properties: {
          providerId: { type: 'string' },
          priority:   { type: 'number' },
          weight:     { type: 'number', minimum: 0, maximum: 100 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const { id } = request.params as { id: string };
      const body = request.body as { providerId: string; priority?: number; weight?: number };
      const group = await addMemberToGroup(fastify.db, id, body.providerId, body.priority, body.weight);
      if (!group) return reply.status(404).send({ error: 'Routing group not found' });
      return { group };
    },
  });

  // ── GET /integration-groups/default/:type ────────────────────────────────
  fastify.get('/default/:type', {
    schema: {
      tags: ['providers'],
      summary: 'Get default routing group for a provider type (SD-193)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['type'], properties: { type: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const { type } = request.params as { type: string };
      const group = await getDefaultGroupForType(fastify.db, type as never);
      if (!group) return reply.status(404).send({ error: 'No default group for this type' });
      return { group };
    },
  });

  // ── DELETE /integration-groups/:id ────────────────────────────────────────
  fastify.delete('/:id', {
    schema: {
      tags: ['providers'],
      summary: 'Delete a routing group (SD-193). Detaches members; default group is protected.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E, 409: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const { id } = request.params as { id: string };
      const result = await deleteRoutingGroup(fastify.db, id);
      if (!result.ok && result.reason === 'not_found')
        return reply.status(404).send({ error: 'Routing group not found' });
      if (!result.ok && result.reason === 'is_default')
        return reply.status(409).send({ error: 'The default routing group cannot be deleted.' });
      return { deleted: true };
    },
  });

  // ── DELETE /integration-groups/:id/members/:pid ───────────────────────────
  fastify.delete('/:id/members/:pid', {
    schema: {
      tags: ['providers'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'pid'],
        properties: { id: { type: 'string' }, pid: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as DemoRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const { id, pid } = request.params as { id: string; pid: string };
      const group = await removeMemberFromGroup(fastify.db, id, pid);
      if (!group) return reply.status(404).send({ error: 'Routing group not found' });
      return { group };
    },
  });
}
