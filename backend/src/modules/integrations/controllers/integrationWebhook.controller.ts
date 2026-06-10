import { FastifyInstance } from 'fastify';
import {
  validateCallback,
  processFdsCallback,
  processAmlCallback,
  processKycCallback,
  processKybCallback,
  processHrpCallback,
  processGenericCallback,
} from '../services/integrationCallback.service';

export async function integrationWebhookController(fastify: FastifyInstance) {
  const webhookOpts = {
    schema: {
      tags: ['webhooks'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      headers: { type: 'object', properties: { 'x-webhook-signature': { type: 'string' } } },
      response: { 200: { type: 'object', properties: { received: { type: 'boolean' } } } },
    },
  };

  // ── POST /webhooks/fds/:id/callback ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/fds/:id/callback', webhookOpts, async (request, reply) => {
    const { id } = request.params;
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    const bodyRaw = JSON.stringify(request.body);

    const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
    if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

    await processFdsCallback(fastify.db, provider!, request.body as never);
    return { received: true };
  });

  // ── POST /webhooks/aml/:id/callback ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/aml/:id/callback', webhookOpts, async (request, reply) => {
    const { id } = request.params;
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    const bodyRaw = JSON.stringify(request.body);

    const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
    if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

    await processAmlCallback(fastify.db, provider!, request.body as never);
    return { received: true };
  });

  // ── POST /webhooks/kyc/:id/callback ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/kyc/:id/callback', webhookOpts, async (request, reply) => {
    const { id } = request.params;
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    const bodyRaw = JSON.stringify(request.body);

    const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
    if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

    await processKycCallback(fastify.db, provider!, request.body as never);
    return { received: true };
  });

  // ── POST /webhooks/kyb/:id/callback ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/kyb/:id/callback', webhookOpts, async (request, reply) => {
    const { id } = request.params;
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    const bodyRaw = JSON.stringify(request.body);

    const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
    if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

    await processKybCallback(fastify.db, provider!, request.body as never);
    return { received: true };
  });

  // ── POST /webhooks/hrp/:id/callback ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/hrp/:id/callback', webhookOpts, async (request, reply) => {
    const { id } = request.params;
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    const bodyRaw = JSON.stringify(request.body);

    const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
    if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

    await processHrpCallback(fastify.db, provider!, request.body as never);
    return { received: true };
  });

  // ── POST /webhooks/generic/:id/callback ────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/generic/:id/callback', webhookOpts, async (request, reply) => {
    const { id } = request.params;
    const signature = request.headers['x-webhook-signature'] as string | undefined;
    const bodyRaw = JSON.stringify(request.body);

    const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
    if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

    await processGenericCallback(fastify.db, provider!, request.body as never);
    return { received: true };
  });
}
