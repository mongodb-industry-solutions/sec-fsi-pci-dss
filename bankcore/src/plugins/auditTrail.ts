import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { buildAuditRecord, recordAudit } from '../modules/audit/services/bankAuditLog.service';

declare module 'fastify' {
  interface FastifyRequest {
    auditStartedAt?: number;
  }
}

// Records every request the bank answers, in one place.
//
// A hook rather than a call in each handler: an audit trail assembled by remembering to call something is a
// trail with holes exactly where someone was in a hurry, and the holes are invisible. Health and metrics are
// skipped because a liveness probe every few seconds would bury the rows a reviewer is looking for.
const SKIPPED = ['/health', '/metrics', '/docs', '/documentation', '/.well-known'];

async function auditTrailPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request) => {
    request.auditStartedAt = Date.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url.split('?')[0];
    if (SKIPPED.some((prefix) => route.startsWith(prefix))) return;
    // No database means no trail, and saying so beats throwing inside a response hook.
    if (fastify.dbError || !fastify.db) return;
    recordAudit(fastify.db, buildAuditRecord(request, reply, Date.now() - (request.auditStartedAt ?? Date.now())));
  });
}

export default fp(auditTrailPlugin, { name: 'auditTrail' });
