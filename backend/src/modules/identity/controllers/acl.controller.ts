import { FastifyInstance } from 'fastify';
import { loadRole } from '../../../vendors/middleware/acl';
import { RESOURCES, ACTIONS } from '../../../shared/models/acl.model';
import type { AuthenticatedRequest } from '../../../shared/models/identity.model';

// ADR-030: expose the current user's EFFECTIVE permissions so the frontend can gate UI without
// embedding permissions in the JWT (changes take effect without re-login). PCI DSS Req 7.
export async function aclController(fastify: FastifyInstance) {
  fastify.get('/effective', {
    schema: {
      tags: ['acl'],
      summary: 'Effective ACL permissions for the authenticated user (ADR-030)',
      description: 'Returns the resolved role, data scope and resource×action permission map for the '
        + 'caller, plus the static permission catalog. The frontend `can()` and `<RequirePermission>` '
        + 'are populated from this; the JWT never carries permissions.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          description: 'Resolved permission set for the authenticated user.',
          properties: {
            role:              { type: 'string', description: 'The user\'s assigned role name (e.g. level1_analyst, manager).' },
            label:             { type: 'string', description: 'Human-readable role label.' },
            description:       { type: ['string', 'null'], description: 'Optional description of the role.' },
            scope:             { type: 'string', enum: ['own', 'all'], description: '`own` = user can only access their own records; `all` = unrestricted.' },
            isBuiltin:         { type: 'boolean', description: 'True for platform-defined roles that cannot be deleted.' },
            bianServiceDomain: { type: ['string', 'null'], description: 'BIAN service domain that owns this role.' },
            permissions: {
              type: 'object',
              description: 'Resource → allowed-actions map. Only present keys are granted; absent = deny. Example: `{ "fraudCases": ["view", "update"] }`.',
              additionalProperties: { type: 'array', items: { type: 'string' } },
            },
            catalog: {
              type: 'object',
              description: 'Static catalog of all known resources and actions in the system.',
              properties: {
                resources: { type: 'array', items: { type: 'string' } },
                actions:   { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request) => {
    const role = (request as unknown as AuthenticatedRequest).userRole;
    const rec = await loadRole(fastify.db, role);
    return {
      role,
      label: rec?.roleLabel ?? role,
      description: rec?.roleDescription ?? null,
      scope: rec?.roleScope ?? 'all',
      isBuiltin: rec?.roleIsBuiltin ?? false,
      bianServiceDomain: rec?.bianServiceDomain ?? null,
      permissions: rec?.rolePermissions ?? {},
      catalog: { resources: RESOURCES, actions: ACTIONS },
    };
  });
}
