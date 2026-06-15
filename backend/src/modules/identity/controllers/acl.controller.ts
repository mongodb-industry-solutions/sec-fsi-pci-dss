import { FastifyInstance } from 'fastify';
import { loadRole } from '../../../vendors/middleware/acl';
import { RESOURCES, ACTIONS } from '../../../shared/models/acl.model';
import type { DemoRequest } from '../../../shared/models/identity.model';

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
    },
  }, async (request) => {
    const role = (request as unknown as DemoRequest).demoRole;
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
