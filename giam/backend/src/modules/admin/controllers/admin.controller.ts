import { FastifyInstance } from 'fastify';
import { readLogs } from '../../../shared/services/logBuffer';
import { requireAdmin } from '../../../vendors/middleware/adminAuth';

// Operational diagnostics. Not part of the integration contract, and behind the administrative
// credential: a log buffer from an identity service is not something to publish.
export async function adminController(fastify: FastifyInstance) {
  fastify.get('/logs', {
    preHandler: requireAdmin,
    schema: {
      operationId: 'getAdminLogs',
      tags: ['admin'],
      summary: 'Recent log lines',
      description:
        'No applicable standard. Ring buffer of recent lines, warnings and above plus request '
        + 'summaries, so a degraded service is diagnosable without pod access. Messages are length '
        + 'capped and never carry a stack, because a stack from this service can carry a credential.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 200, examples: [50] },
        },
      },
      response: {
        200: {
          description: 'The most recent lines, oldest first.',
          type: 'object',
          additionalProperties: false,
          required: ['lines'],
          properties: { lines: { type: 'array', items: { type: 'string' } } },
          examples: [{ lines: ['[2026-08-28T10:00:00.000Z] STARTUP giam is up'] }],
        },
        401: { $ref: 'Problem#', description: 'No valid administrative token was presented.' },
        503: { $ref: 'Problem#', description: 'No administrative credential is configured.' },
      },
    },
  }, async (request) => {
    const { limit } = request.query as { limit?: number };
    return { lines: readLogs(limit ?? 200) };
  });
}
