import { FastifyInstance } from 'fastify';
import { listManagedUsers, createUser, updateUser, deleteUser } from '../services/user.service';
import { requirePermission } from '../../../vendors/middleware/acl';

// ADR-030 / SD-91: managed user administration (local domains). Reads need authDomains:view,
// mutations need authDomains:manage (manager). Passwords are never returned.
export async function usersController(fastify: FastifyInstance) {
  const tags = ['users'];
  const canView = requirePermission('authDomains', 'view');
  const canManage = requirePermission('authDomains', 'manage');

  // GET /api/v1/users?domain=&q=
  fastify.get<{ Querystring: { domain?: string; q?: string } }>('/', {
    preHandler: canView,
    schema: { tags, summary: 'List managed users (ADR-030)', security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const { domain, q } = request.query;
    return { users: await listManagedUsers(fastify.db, { domain, q }) };
  });

  // POST /api/v1/users
  fastify.post<{ Body: { email: string; name: string; role: string; domain?: string; password?: string; status?: 'active' | 'suspended' } }>('/', {
    preHandler: canManage,
    schema: {
      tags, summary: 'Create a local user', security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['email', 'name', 'role'],
        properties: {
          email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' },
          domain: { type: 'string' }, password: { type: 'string' },
          status: { type: 'string', enum: ['active', 'suspended'] },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body;
    try {
      const user = await createUser(fastify.db, {
        email: b.email, name: b.name, role: b.role, domain: b.domain,
        password: b.password && b.password.length >= 4 ? b.password : 'demo1234',
        status: b.status,
      });
      return reply.status(201).send(user);
    } catch (err) {
      return reply.status(409).send({ error: (err as Error).message });
    }
  });

  // PUT /api/v1/users/:id
  fastify.put<{ Params: { id: string }; Body: { name?: string; role?: string; status?: 'active' | 'suspended'; password?: string } }>('/:id', {
    preHandler: canManage,
    schema: {
      tags, summary: 'Update a user (role/name/status/password)', security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', additionalProperties: true },
    },
  }, async (request, reply) => {
    const updated = await updateUser(fastify.db, request.params.id, request.body ?? {});
    if (!updated) return reply.status(404).send({ error: 'User not found' });
    return updated;
  });

  // DELETE /api/v1/users/:id
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: canManage,
    schema: { tags, summary: 'Delete a user', security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const ok = await deleteUser(fastify.db, request.params.id);
    if (!ok) return reply.status(404).send({ error: 'User not found' });
    return { deleted: true, id: request.params.id };
  });
}
