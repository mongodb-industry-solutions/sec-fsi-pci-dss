import { FastifyInstance } from 'fastify';
import {
  ROLE_COLLECTION, RoleRecord, RolePermissions, RESOURCES, ACTIONS, Resource, Action,
} from '../../../shared/models/acl.model';
import { requirePermission, invalidateRoleCache } from '../../../vendors/middleware/acl';

const RESOURCE_SET = new Set<string>(RESOURCES);
const ACTION_SET = new Set<string>(ACTIONS);

// Keep only valid resource→action[] entries (default-deny: anything unknown is dropped, not error).
function sanitizePermissions(input: unknown): RolePermissions {
  const out: RolePermissions = {};
  if (!input || typeof input !== 'object') return out;
  for (const [res, actions] of Object.entries(input as Record<string, unknown>)) {
    if (!RESOURCE_SET.has(res) || !Array.isArray(actions)) continue;
    const clean = [...new Set(actions.filter((a): a is Action => typeof a === 'string' && ACTION_SET.has(a)))];
    if (clean.length) out[res as Resource] = clean;
  }
  return out;
}

// ADR-030 / SD-16: data-driven RBAC role administration. Reads need `roles:view`, mutations need
// `roles:manage` (manager). Builtin roles are editable (permissions) but cannot be renamed or deleted.
export async function rolesController(fastify: FastifyInstance) {
  const col = () => fastify.db.collection<RoleRecord>(ROLE_COLLECTION);

  // GET /roles — list all roles
  fastify.get('/', {
    preHandler: requirePermission('roles', 'view'),
    schema: { tags: ['roles'], summary: 'List RBAC roles (ADR-030)', security: [{ bearerAuth: [] }] },
  }, async () => {
    const roles = await col().find({}, { projection: { _id: 0 } }).sort({ roleIsBuiltin: -1, roleName: 1 }).toArray();
    return { roles, catalog: { resources: RESOURCES, actions: ACTIONS } };
  });

  // GET /roles/:roleName
  fastify.get('/:roleName', {
    preHandler: requirePermission('roles', 'view'),
    schema: { tags: ['roles'], summary: 'Get a role by name', security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['roleName'], properties: { roleName: { type: 'string' } } } },
  }, async (request, reply) => {
    const { roleName } = request.params as { roleName: string };
    const role = await col().findOne({ roleName }, { projection: { _id: 0 } });
    if (!role) return reply.status(404).send({ error: 'Role not found' });
    return role;
  });

  // POST /roles — create a custom role (any subset of the catalog, including full-manage)
  fastify.post('/', {
    preHandler: requirePermission('roles', 'manage'),
    schema: {
      tags: ['roles'], summary: 'Create a custom role', security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['roleName', 'roleLabel'],
        properties: {
          roleName: { type: 'string', description: 'Unique, lowercase kebab/snake identifier.' },
          roleLabel: { type: 'string' },
          roleDescription: { type: 'string' },
          roleScope: { type: 'string', enum: ['own', 'all'] },
          rolePermissions: { type: 'object', additionalProperties: true },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as Partial<RoleRecord> & { roleName: string; roleLabel: string };
    const roleName = String(body.roleName).trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(roleName)) {
      return reply.status(400).send({ error: 'roleName must be lowercase letters, digits, hyphen or underscore.' });
    }
    if (await col().findOne({ roleName })) {
      return reply.status(409).send({ error: `Role '${roleName}' already exists.` });
    }
    const now = new Date();
    const doc: RoleRecord = {
      roleName,
      roleLabel: String(body.roleLabel).trim(),
      roleDescription: body.roleDescription ? String(body.roleDescription) : undefined,
      rolePermissions: sanitizePermissions(body.rolePermissions),
      roleScope: body.roleScope === 'own' ? 'own' : 'all',
      roleIsBuiltin: false,
      bianServiceDomain: 'Party Authentication',
      bianControlRecordType: 'PartyAuthenticationAssessment',
      recordCreatedDateTime: now,
      recordUpdatedDateTime: now,
    };
    await col().insertOne(doc);
    invalidateRoleCache(roleName);
    return reply.status(201).send({ ...doc, _id: undefined });
  });

  // PUT /roles/:roleName — update label/description/scope/permissions. Builtin: permissions editable,
  // but it stays builtin and keeps its name.
  fastify.put('/:roleName', {
    preHandler: requirePermission('roles', 'manage'),
    schema: {
      tags: ['roles'], summary: 'Update a role (permissions/label/scope)', security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['roleName'], properties: { roleName: { type: 'string' } } },
      body: { type: 'object', additionalProperties: true },
    },
  }, async (request, reply) => {
    const { roleName } = request.params as { roleName: string };
    const existing = await col().findOne({ roleName });
    if (!existing) return reply.status(404).send({ error: 'Role not found' });

    const body = request.body as Partial<RoleRecord>;
    const set: Partial<RoleRecord> = { recordUpdatedDateTime: new Date() };
    if (typeof body.roleLabel === 'string') set.roleLabel = body.roleLabel.trim();
    if (typeof body.roleDescription === 'string') set.roleDescription = body.roleDescription;
    if (body.roleScope === 'own' || body.roleScope === 'all') set.roleScope = body.roleScope;
    if (body.rolePermissions !== undefined) set.rolePermissions = sanitizePermissions(body.rolePermissions);

    await col().updateOne({ roleName }, { $set: set });
    invalidateRoleCache(roleName);
    const updated = await col().findOne({ roleName }, { projection: { _id: 0 } });
    return updated;
  });

  // DELETE /roles/:roleName — custom roles only. Builtin roles cannot be deleted (PCI Req 7 baseline).
  fastify.delete('/:roleName', {
    preHandler: requirePermission('roles', 'manage'),
    schema: {
      tags: ['roles'], summary: 'Delete a custom role', security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['roleName'], properties: { roleName: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { roleName } = request.params as { roleName: string };
    const existing = await col().findOne({ roleName });
    if (!existing) return reply.status(404).send({ error: 'Role not found' });
    if (existing.roleIsBuiltin) {
      return reply.status(403).send({ error: 'Builtin roles cannot be deleted (they may be edited or deactivated by removing permissions).' });
    }
    await col().deleteOne({ roleName });
    invalidateRoleCache(roleName);
    return { deleted: true, roleName };
  });
}
