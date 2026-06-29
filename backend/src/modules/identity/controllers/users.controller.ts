import { FastifyInstance } from 'fastify';
import { listManagedUsers, createUser, updateUser, deleteUser } from '../services/user.service';
import { requirePermission } from '../../../vendors/middleware/acl';

const E = { type: 'object', properties: { error: { type: 'string' } } };

const UserObject = {
  type: 'object',
  description: 'Managed user record. Passwords are never returned.',
  properties: {
    id:     { type: 'string',  description: 'Unique user identifier (UUID).' },
    email:  { type: 'string',  description: 'User email address (used for login).' },
    name:   { type: 'string',  description: 'Display name.' },
    role:   { type: 'string',  description: 'Assigned RBAC role name (e.g. level1_analyst, manager).' },
    domain: { type: 'string',  description: 'Authentication domain the user belongs to.' },
    status: { type: 'string',  enum: ['active', 'suspended'], description: 'Account status.' },
  },
};

// ADR-030 / SD-91: managed user administration (local domains). Reads need authDomains:view,
// mutations need authDomains:manage (manager). Passwords are never returned.
export async function usersController(fastify: FastifyInstance) {
  const tags = ['users'];
  const canView = requirePermission('authDomains', 'view');
  const canManage = requirePermission('authDomains', 'manage');

  // GET /api/v1/users?domain=&q=
  fastify.get<{ Querystring: { domain?: string; q?: string } }>('/', {
    preHandler: canView,
    schema: {
      tags,
      summary: 'List managed users (ADR-030)',
      description: 'Returns users in managed authentication domains visible to the caller. '
        + 'Results can be filtered by `domain` (exact match) and `q` (substring search on email or name). '
        + 'Requires `authDomains:view` permission (manager role). '
        + 'Passwords are never included in any response.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Filter by authentication domain name (exact match).' },
          q:      { type: 'string', description: 'Substring search across email and name fields.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            users: { type: 'array', items: UserObject },
          },
        },
        401: E,
        403: E,
      },
    },
  }, async (request) => {
    const { domain, q } = request.query;
    return { users: await listManagedUsers(fastify.db, { domain, q }) };
  });

  // POST /api/v1/users
  fastify.post<{ Body: { email: string; name: string; role: string; domain?: string; password?: string; status?: 'active' | 'suspended' } }>('/', {
    preHandler: canManage,
    schema: {
      tags,
      summary: 'Create a local user',
      description: 'Creates a new user in a local authentication domain. '
        + 'Requires `authDomains:manage` permission (manager role). '
        + 'If `password` is omitted or shorter than 4 characters it defaults to `demo1234`. '
        + 'Email must be unique within the domain; returns 409 on conflict.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['email', 'name', 'role'],
        properties: {
          email:    { type: 'string', description: 'User email address (used for login). Must be unique in the domain.' },
          name:     { type: 'string', description: 'Display name.' },
          role:     { type: 'string', description: 'RBAC role to assign (must exist in the roles collection).' },
          domain:   { type: 'string', description: 'Target authentication domain. Defaults to the default local domain.' },
          password: { type: 'string', description: 'Initial password. Defaults to `demo1234` if shorter than 4 characters.' },
          status:   { type: 'string', enum: ['active', 'suspended'], description: 'Initial account status. Defaults to `active`.' },
        },
      },
      response: {
        201: UserObject,
        401: E,
        403: E,
        409: { ...E, description: 'A user with this email already exists in the domain.' },
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
      tags,
      summary: 'Update a user (role / name / status / password)',
      description: 'Updates one or more mutable fields of a managed user. '
        + 'All body fields are optional; only the fields provided are changed. '
        + 'Changing `role` takes effect immediately without a re-login (role is resolved from the DB on each request). '
        + 'Setting `status` to `suspended` blocks subsequent logins but does not invalidate existing JWTs. '
        + 'Requires `authDomains:manage` permission (manager role).',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'User ID (UUID).' } },
      },
      body: {
        type: 'object',
        properties: {
          name:     { type: 'string', description: 'New display name.' },
          role:     { type: 'string', description: 'New RBAC role name (must exist in the roles collection).' },
          status:   { type: 'string', enum: ['active', 'suspended'], description: 'Account status.' },
          password: { type: 'string', description: 'New password (minimum 4 characters).' },
        },
      },
      response: {
        200: UserObject,
        401: E,
        403: E,
        404: { ...E, description: 'User not found.' },
      },
    },
  }, async (request, reply) => {
    const updated = await updateUser(fastify.db, request.params.id, request.body ?? {});
    if (!updated) return reply.status(404).send({ error: 'User not found' });
    return updated;
  });

  // DELETE /api/v1/users/:id
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: canManage,
    schema: {
      tags,
      summary: 'Delete a user',
      description: 'Permanently removes a managed user from the system. '
        + 'Existing JWTs issued for this user remain valid until expiry — consider also forcing a logout. '
        + 'Requires `authDomains:manage` permission (manager role). '
        + 'Built-in demo users can be deleted but will be re-seeded on next setup run.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'User ID (UUID) to delete.' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            deleted: { type: 'boolean', description: 'Always true on success.' },
            id:      { type: 'string',  description: 'ID of the deleted user.' },
          },
        },
        401: E,
        403: E,
        404: { ...E, description: 'User not found.' },
      },
    },
  }, async (request, reply) => {
    const ok = await deleteUser(fastify.db, request.params.id);
    if (!ok) return reply.status(404).send({ error: 'User not found' });
    return { deleted: true, id: request.params.id };
  });
}
