import { FastifyInstance } from 'fastify';
import { readLogs } from '../../../shared/services/logBuffer';
import { requireAdmin } from '../../../vendors/middleware/adminAuth';
import { config } from '../../../config';

// Diagnostics the PSP admin panel reads over the private network. No cardholder data, no secrets.
export async function systemController(fastify: FastifyInstance) {
  fastify.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'Health check with detail',
      description: 'IETF health+json. Reports the database and the key vault bankcore is bound to.',
      response: {
        200: { type: 'object', additionalProperties: true },
        503: { type: 'object', additionalProperties: true },
      },
    },
  }, async (_request, reply) => {
    const now = new Date().toISOString();
    reply.header('Content-Type', 'application/health+json; charset=utf-8');
    const detail = {
      database: config.mongodb.dbName,
      keyVaultNamespace: config.kms.keyVaultNamespace,
      consentMode: config.bank.consentMode,
    };
    if (fastify.dbError) {
      return reply.status(503).send({
        status: 'fail',
        serviceId: 'fsi-pci-dss-bankcore',
        detail,
        checks: { 'mongodb:connectivity': [{ status: 'fail', componentType: 'datastore', output: fastify.dbError, time: now }] },
      });
    }
    const t0 = Date.now();
    await fastify.db.command({ ping: 1 });
    return reply.send({
      status: 'pass',
      serviceId: 'fsi-pci-dss-bankcore',
      detail,
      checks: { 'mongodb:connectivity': [{ status: 'pass', componentType: 'datastore', observedValue: Date.now() - t0, observedUnit: 'ms', time: now }] },
    });
  });

  fastify.get('/logs', {
    // Admin only: bankcore is publicly reachable so its API can be reviewed, and a log buffer is not
    // something to publish.
    preHandler: requireAdmin,
    schema: {
      tags: ['system'],
      summary: 'Recent bankcore log lines',
      description:
        'Ring buffer of recent lines (warn and above, plus request summaries), so a broken bank is '
        + 'diagnosable from the PSP admin panel instead of only from pod logs. Requires the platform '
        + 'admin token.',
      security: [{ adminAuth: [] }],
      querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      response: {
        200: {
          type: 'object',
          properties: { lines: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  }, async (request) => {
    const { limit } = request.query as { limit?: number };
    return { lines: readLogs(limit ?? 200) };
  });
}
