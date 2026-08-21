// Payment Execution Procedure, REST controller (v17)
// Routes mounted at /executions → /api/v1/executions

import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import { getExecution, listExecutions } from '../services/paymentExecution.service';

export async function paymentExecutionController(fastify: FastifyInstance) {

  // GET /api/v1/executions
  fastify.get('/', {
    preHandler: requirePermission('transactions', 'view'),
    schema: {
      tags: ['executions'],
      summary: 'List payment executions (SD-65)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query as { status?: string; page?: number; limit?: number };
    const { results, total } = await listExecutions(fastify.db, q as any);
    return reply.send({ results, total, page: q.page ?? 1, limit: q.limit ?? 20 });
  });

  // GET /api/v1/executions/:executionRef
  fastify.get('/:executionRef', {
    preHandler: requirePermission('transactions', 'view'),
    schema: {
      tags: ['executions'],
      summary: 'Get payment execution by reference (SD-65)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['executionRef'],
        properties: { executionRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { executionRef } = request.params as { executionRef: string };
    const execution = await getExecution(fastify.db, executionRef);
    if (!execution) return reply.status(404).send({ error: 'Execution not found' });
    return reply.send(execution);
  });
}
