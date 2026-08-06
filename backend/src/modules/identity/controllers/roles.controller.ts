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

const E = { type: 'object', properties: { error: { type: 'string' } } };

const RoleObject = {
  type: 'object',
  description: 'RBAC role record.',
  properties: {
    roleName:        { type: 'string', description: 'Unique lowercase kebab/snake identifier used in JWTs and the ACL middleware.' },
    roleLabel:       { type: 'string', description: 'Human-readable display name.' },
    roleDescription: { type: 'string', description: 'Optional extended description.' },
    roleScope:       { type: 'string', enum: ['own', 'all'], description: '`own` restricts the role to the user\'s own records; `all` is unrestricted.' },
    roleIsBuiltin:   { type: 'boolean', description: 'True for platform-defined roles. Builtin roles can be edited (permissions) but not renamed or deleted.' },
    rolePermissions: {
      type: 'object',
      description: 'Resource → allowed actions. Only keys present are granted; absent = deny.',
      additionalProperties: { type: 'array', items: { type: 'string' } },
    },
    bianServiceDomain:      { type: 'string', description: 'BIAN service domain this role primarily belongs to.' },
    bianControlRecordType:  { type: 'string', description: 'BIAN control-record type for this role.' },
    recordCreatedDateTime:  { type: 'string', format: 'date-time' },
    recordUpdatedDateTime:  { type: 'string', format: 'date-time' },
  },
};

// ADR-030 / SD-16: data-driven RBAC role administration. Reads need `roles:view`, mutations need
// `roles:manage` (manager). Builtin roles are editable (permissions) but cannot be renamed or deleted.
export async function rolesController(fastify: FastifyInstance) {
  const col = () => fastify.db.collection<RoleRecord>(ROLE_COLLECTION);

  // GET /roles: list all roles
  fastify.get('/', {
    preHandler: requirePermission('roles', 'view'),
    schema: {
      tags: ['roles'],
      summary: 'List RBAC roles (ADR-030)',
      description: 'Returns all roles defined in the system, sorted with builtin roles first then alphabetically. '
        + 'Also includes the static `catalog` of valid resource names and action names that can be used when '
        + 'creating or editing roles. Requires `roles:view` permission (manager role).',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            roles: { type: 'array', items: RoleObject },
            catalog: {
              type: 'object',
              description: 'All valid resource and action names in the permission system.',
              properties: {
                resources: { type: 'array', items: { type: 'string' } },
                actions:   { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        401: E,
        403: E,
      },
    },
  }, async () => {
    const roles = await col().find({}, { projection: { _id: 0 } }).sort({ roleIsBuiltin: -1, roleName: 1 }).toArray();
    return { roles, catalog: { resources: RESOURCES, actions: ACTIONS } };
  });

  // GET /roles/:roleName
  fastify.get('/:roleName', {
    preHandler: requirePermission('roles', 'view'),
    schema: {
      tags: ['roles'],
      summary: 'Get a role by name',
      description: 'Returns the full definition of a single RBAC role, including its permissions map, '
        + 'scope, builtin flag, and BIAN metadata. '
        + 'Requires `roles:view` permission (manager role). '
        + 'Returns 404 if the role does not exist.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['roleName'],
        properties: { roleName: { type: 'string', description: 'Lowercase role identifier, e.g. `level1_analyst`.' } },
      },
      response: {
        200: RoleObject,
        401: E,
        403: E,
        404: { ...E, description: 'Role not found.' },
      },
    },
  }, async (request, reply) => {
    const { roleName } = request.params as { roleName: string };
    const role = await col().findOne({ roleName }, { projection: { _id: 0 } });
    if (!role) return reply.status(404).send({ error: 'Role not found' });
    return role;
  });

  // POST /roles: create a custom role (any subset of the catalog, including full-manage)
  fastify.post('/', {
    preHandler: requirePermission('roles', 'manage'),
    schema: {
      tags: ['roles'],
      summary: 'Create a custom role',
      description: 'Creates a new custom RBAC role with the specified permissions. '
        + '`roleName` must be unique, lowercase, and match `^[a-z0-9][a-z0-9_-]*$`. '
        + '`rolePermissions` keys must be valid resource names from the catalog; unknown resources are silently dropped. '
        + 'Returns 409 if the role name already exists. '
        + 'Requires `roles:manage` permission (manager role).',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['roleName', 'roleLabel'],
        properties: {
          roleName:        { type: 'string', description: 'Unique, lowercase kebab/snake identifier. Pattern: `^[a-z0-9][a-z0-9_-]*$`.' },
          roleLabel:       { type: 'string', description: 'Human-readable display name shown in the UI.' },
          roleDescription: { type: 'string', description: 'Optional extended description of the role\'s purpose.' },
          roleScope:       { type: 'string', enum: ['own', 'all'], description: '`own` = user sees only their own records; `all` = unrestricted. Defaults to `all`.' },
          rolePermissions: {
            type: 'object',
            description: 'Resource → action array map. Only catalog resources and actions are accepted; unknown values are dropped.',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      response: {
        201: RoleObject,
        400: { ...E, description: 'Invalid roleName format.' },
        401: E,
        403: E,
        409: { ...E, description: 'A role with this name already exists.' },
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

  // PUT /roles/:roleName, update label/description/scope/permissions. Builtin: permissions editable,
  // but it stays builtin and keeps its name.
  fastify.put('/:roleName', {
    preHandler: requirePermission('roles', 'manage'),
    schema: {
      tags: ['roles'],
      summary: 'Update a role (permissions / label / scope)',
      description: 'Updates one or more mutable fields of a role. All body fields are optional; only provided fields are changed. '
        + 'Builtin roles (roleIsBuiltin: true) allow permission and label edits but cannot be renamed. '
        + 'Permission changes take effect immediately without a re-login (resolved from DB per request). '
        + 'Unknown resources in `rolePermissions` are silently dropped. '
        + 'Requires `roles:manage` permission (manager role).',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['roleName'],
        properties: { roleName: { type: 'string', description: 'Lowercase role identifier.' } },
      },
      body: {
        type: 'object',
        properties: {
          roleLabel:       { type: 'string', description: 'New human-readable display name.' },
          roleDescription: { type: 'string', description: 'New extended description.' },
          roleScope:       { type: 'string', enum: ['own', 'all'] },
          rolePermissions: {
            type: 'object',
            description: 'Full replacement permissions map (not merged). Unknown resources are dropped.',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      response: {
        200: RoleObject,
        401: E,
        403: E,
        404: { ...E, description: 'Role not found.' },
      },
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

  // DELETE /roles/:roleName, custom roles only. Builtin roles cannot be deleted (PCI Req 7 baseline).
  fastify.delete('/:roleName', {
    preHandler: requirePermission('roles', 'manage'),
    schema: {
      tags: ['roles'],
      summary: 'Delete a custom role',
      description: 'Permanently deletes a custom RBAC role. '
        + 'Builtin roles (roleIsBuiltin: true) cannot be deleted, they may be deactivated by removing all permissions via PUT. '
        + 'Users currently assigned the deleted role will fail permission checks until reassigned. '
        + 'Requires `roles:manage` permission (manager role). '
        + 'Returns 403 if the role is builtin, 404 if the role does not exist.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['roleName'],
        properties: { roleName: { type: 'string', description: 'Lowercase role identifier to delete.' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            deleted:  { type: 'boolean', description: 'Always true on success.' },
            roleName: { type: 'string',  description: 'Name of the deleted role.' },
          },
        },
        401: E,
        403: { ...E, description: 'Builtin roles cannot be deleted.' },
        404: { ...E, description: 'Role not found.' },
      },
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
