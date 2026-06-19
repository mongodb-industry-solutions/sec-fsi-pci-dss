// Auth Domains capability-less Module — STATIC full-CRUD routes (ADR-029) at /api/v1/modules/domains.
// Admin-managed (JWT required; default auth applies). List supports q + pagination (10/page, §5.4).
import { FastifyInstance } from 'fastify';
import {
  listAuthDomains,
  getAuthDomain,
  createAuthDomain,
  updateAuthDomain,
  deleteAuthDomain,
} from '../services/domain.service';
import { AuthenticationDomainRecord } from '../../identity/models/authenticationDomain.model';
import { requirePermission } from '../../../vendors/middleware/acl';

export async function domainController(fastify: FastifyInstance) {
  const tags = ['modules:domains'];
  // ADR-030: auth-domain administration is manager-only (authDomains permission).
  const canView = requirePermission('authDomains', 'view');
  const canManage = requirePermission('authDomains', 'manage');

  // GET /api/v1/modules/domains?q=&page=&limit=
  fastify.get<{ Querystring: { q?: string; page?: string; limit?: string } }>(
    '/',
    { preHandler: canView, schema: { tags } },
    async (request) => {
      const { q, page, limit } = request.query;
      return listAuthDomains(fastify.db, {
        q,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
    },
  );

  // GET /api/v1/modules/domains/:id
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: canView, schema: { tags } }, async (request, reply) => {
    const found = await getAuthDomain(fastify.db, request.params.id);
    if (!found) return reply.code(404).send({ error: 'Authentication domain not found' });
    return found;
  });

  // POST /api/v1/modules/domains
  fastify.post<{ Body: Partial<AuthenticationDomainRecord> }>('/', { preHandler: canManage, schema: { tags } }, async (request, reply) => {
    const created = await createAuthDomain(fastify.db, request.body ?? {});
    return reply.code(201).send(created);
  });

  // PUT /api/v1/modules/domains/:id
  fastify.put<{ Params: { id: string }; Body: Partial<AuthenticationDomainRecord> }>(
    '/:id',
    { preHandler: canManage, schema: { tags } },
    async (request, reply) => {
      const updated = await updateAuthDomain(fastify.db, request.params.id, request.body ?? {});
      if (!updated) return reply.code(404).send({ error: 'Authentication domain not found' });
      return updated;
    },
  );

  // DELETE /api/v1/modules/domains/:id
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: canManage, schema: { tags } }, async (request, reply) => {
    const ok = await deleteAuthDomain(fastify.db, request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Authentication domain not found' });
    return { deleted: true };
  });
}
