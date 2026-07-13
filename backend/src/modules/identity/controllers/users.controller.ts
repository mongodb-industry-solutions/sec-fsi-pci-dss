import { FastifyInstance } from 'fastify';
import { listManagedUsers, getManagedUser, createUser, updateUser, deleteUser } from '../services/user.service';
import { assertPasswordPolicy } from '../services/auth.service';
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
    status: { type: 'string',  enum: ['active', 'suspended', 'pending'], description: 'Account status. `pending` = self-registered, awaiting manager approval.' },
  },
};

// Extended record for the single-user detail view (adds read-only metadata not needed in the list).
const UserObjectFull = {
  ...UserObject,
  properties: {
    ...UserObject.properties,
    phone:          { type: 'string', description: 'Mobile phone from the linked party (SD-13). PII; the UI masks it by default.' },
    partyReference: { type: 'string', description: 'Linked party (SD-13) reference.' },
    lastLoginAt:    { type: 'string', description: 'Last successful login timestamp (ISO 8601).' },
    createdAt:      { type: 'string', description: 'Record creation timestamp (ISO 8601).' },
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

  // GET /api/v1/users/:id
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: canView,
    schema: {
      tags,
      summary: 'Get a single managed user',
      description: 'Returns the full detail record for one managed user. '
        + 'Requires `authDomains:view` permission (manager role). '
        + 'The email is PII (QE-encrypted at rest); the caller UI masks it by default. '
        + 'Passwords are never included.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'User ID (UUID).' } },
      },
      response: {
        200: UserObjectFull,
        401: E,
        403: E,
        404: { ...E, description: 'User not found.' },
      },
    },
  }, async (request, reply) => {
    const user = await getManagedUser(fastify.db, request.params.id);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return user;
  });

  // POST /api/v1/users
  fastify.post<{ Body: { email: string; name: string; role: string; domain?: string; password: string; status?: 'active' | 'suspended'; phone?: string } }>('/', {
    preHandler: canManage,
    schema: {
      tags,
      summary: 'Create a local user',
      description: 'Creates a new user in a local authentication domain. '
        + 'Requires `authDomains:manage` permission (manager role). '
        + 'Email must be unique within the domain; returns 409 on conflict.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['email', 'name', 'role', 'password'],
        properties: {
          email:    { type: 'string', description: 'User email address (used for login). Must be unique in the domain.' },
          name:     { type: 'string', description: 'Display name.' },
          role:     { type: 'string', description: 'RBAC role to assign (must exist in the roles collection).' },
          domain:   { type: 'string', description: 'Target authentication domain. Defaults to the default local domain.' },
          password: { type: 'string', minLength: 8, description: 'Initial password (policy: min 8 chars, at least one letter and one number; enforced server-side).' },
          status:   { type: 'string', enum: ['active', 'suspended'], description: 'Initial account status. Defaults to `active`.' },
          phone:    { type: 'string', description: 'Optional mobile phone (party SD-13, PII). Must be unique across parties.' },
        },
      },
      response: {
        201: UserObject,
        400: { ...E, description: 'Password does not meet the policy (min 8 chars, letter + number).' },
        401: E,
        403: E,
        409: { ...E, description: 'A user with this email already exists in the domain.' },
      },
    },
  }, async (request, reply) => {
    const b = request.body;
    try {
      assertPasswordPolicy(b.password);
      const user = await createUser(fastify.db, {
        email: b.email, name: b.name, role: b.role, domain: b.domain,
        password: b.password, status: b.status, phone: b.phone,
      });
      return reply.status(201).send(user);
    } catch (err) {
      // Only map known outcomes: 409 for uniqueness conflicts (email/phone), 400 for explicit
      // validation errors. Anything else is unexpected (Mongo/bcrypt/etc.) and must surface as a
      // 500 via Fastify's error handler rather than being masked as a client error.
      const e = err as { statusCode?: number; message: string };
      if (e.statusCode === 409) return reply.status(409).send({ error: e.message });
      if (e.statusCode === 400) return reply.status(400).send({ error: e.message });
      throw err;
    }
  });

  // PUT /api/v1/users/:id
  fastify.put<{ Params: { id: string }; Body: { name?: string; role?: string; status?: 'active' | 'suspended' | 'pending'; password?: string; phone?: string } }>('/:id', {
    preHandler: canManage,
    schema: {
      tags,
      summary: 'Update a user (role / name / status / password / phone)',
      description: 'Updates one or more mutable fields of a managed user. '
        + 'All body fields are optional; only the fields provided are changed. '
        + 'Changing `role` takes effect immediately without a re-login (role is resolved from the DB on each request). '
        + 'Setting `status` to `suspended` (or `pending`) blocks subsequent logins but does not invalidate existing JWTs; '
        + 'setting it to `active` approves a pending self-registered account. '
        + '`name`/`phone` are contact PII written to the linked party (SD-13); `phone` is QE-encrypted and unique. '
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
          status:   { type: 'string', enum: ['active', 'suspended', 'pending'], description: 'Account status. `active` approves a pending account.' },
          password: { type: 'string', description: 'New password (minimum 4 characters).' },
          phone:    { type: 'string', description: 'New mobile phone (party SD-13, PII). Must be unique across parties.' },
        },
      },
      response: {
        200: UserObject,
        401: E,
        403: E,
        404: { ...E, description: 'User not found.' },
        409: { ...E, description: 'Phone already in use by another party.' },
      },
    },
  }, async (request, reply) => {
    try {
      const updated = await updateUser(fastify.db, request.params.id, request.body ?? {});
      if (!updated) return reply.status(404).send({ error: 'User not found' });
      return updated;
    } catch (err) {
      const e = err as { statusCode?: number; message: string };
      if (e.statusCode === 409) return reply.status(409).send({ error: e.message });
      throw err;
    }
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
