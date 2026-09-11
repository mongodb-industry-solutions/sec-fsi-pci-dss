import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { callAuthority, AuthorityError } from '../../../vendors/security/authorityApi';
import { RESOURCES, ACTIONS } from '../../../shared/models/permissionCatalog';
import { expandRoles } from '../../../vendors/security/roleCatalog';

/**
 * The console's view of the directory: what the caller may do, which roles exist, and who is in it.
 *
 * These answered from this application's own collections until the identity extraction removed
 * them, and the console was never repointed. The routes 404'd, every caller wrapped the failure in
 * `.catch(() => [])`, and the pages went on rendering a shell around an empty list. Nothing looked
 * broken, which is why it lasted: a page that renders is a page that passes a sweep.
 *
 * Same three rules as the authorizations view next door, and for the same reasons:
 *
 * - The data comes from the authority, read with the CALLER's own token. Who may see what is
 *   decided there, so this service does not filter the result: a filter applied afterwards by a
 *   client is a presentation choice and not an access control.
 * - Nothing is stored and nothing is cached. A revoked role has to be gone on the next render.
 * - The shape the screens already expect is preserved. The console is not the place to absorb a
 *   vocabulary change that has nothing to do with what it displays.
 */

/** The authority's refusal, propagated. Reinterpreting it here would make this a second policy point. */
function relayFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthorityError) {
    const body = error.body as { detail?: string; title?: string } | undefined;
    return reply.status(error.status).send({ error: body?.detail ?? body?.title ?? 'Request refused' });
  }
  throw error;
}

interface LoginContext {
  providers?: Array<{
    name: string;
    displayName?: string;
    protocol?: string;
    enabled?: boolean;
    notice?: string;
  }>;
  registrationEnabled?: boolean;
}

interface AuthorityRole {
  roleId: string;
  name: string;
  displayName?: string;
  description?: string;
  scopeKind?: string;
  builtin?: boolean;
}

/** The authority says `self`; nearly forty screens say `own`. One translation, here, at the edge. */
function scopeOf(role: { scopeKind?: string }): 'own' | 'all' {
  return role.scopeKind === 'all' ? 'all' : 'own';
}

/** `resource:action` strings into the `{ resource: [action] }` map the screens read. */
function asPermissionMap(permissions: Iterable<string>): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const permission of permissions) {
    const [resource, action] = permission.split(':');
    if (!resource || !action) continue;
    (map[resource] ??= []).push(action);
  }
  for (const actions of Object.values(map)) actions.sort();
  return map;
}

export async function directoryController(fastify: FastifyInstance) {
  function bearerOf(request: FastifyRequest): string {
    const header = request.headers.authorization ?? '';
    return header.startsWith('Bearer ') ? header.slice(7) : '';
  }

  function callerOf(request: FastifyRequest): { roles?: string[]; permissions?: string[]; effectivePermissions?: string[] } | undefined {
    return (request as unknown as {
      user?: { roles?: string[]; permissions?: string[]; effectivePermissions?: string[] };
    }).user;
  }

  /**
   * What THIS caller may do, for an interface that wants to hide what it cannot offer.
   *
   * Answered from the token, not from a lookup. The roles were resolved by the authority at
   * issuance and expanded at the edge where the token was read, so this is a read of a decision
   * already made rather than a second place that makes one.
   *
   * The catalog half is this application's OWN declaration, because a console must show the
   * enforcement points that exist HERE. Listing the authority's would offer permissions no screen
   * checks and no route enforces.
   */
  fastify.get('/acl/effective', {
    schema: {
      tags: ['auth'],
      summary: 'What the caller may do',
      description:
        'The caller\'s own permissions, as the authority resolved them, together with the catalog '
        + 'of enforcement points this application declares. Intended for hiding what a person '
        + 'cannot do; it is NOT the enforcement, which happens per route.',
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const caller = callerOf(request);
    if (!caller) return reply.status(401).send({ error: 'Unauthenticated' });

    const roleName = caller.roles?.[0] ?? '';
    const held = caller.effectivePermissions
      ?? await expandRoles(bearerOf(request), caller.roles ?? [], caller.permissions ?? [])
      ?? [];

    // The role's own description is the authority's to give. A failure here costs a label, never
    // a permission, so it degrades to the role name rather than refusing the whole answer.
    let described: AuthorityRole | undefined;
    try {
      const { roles } = await callAuthority<{ roles: AuthorityRole[] }>(request, '/roles');
      described = roles.find((role) => role.name === roleName);
    } catch {
      described = undefined;
    }

    return reply.send({
      role: roleName,
      label: described?.displayName ?? roleName,
      description: described?.description ?? null,
      scope: described ? scopeOf(described) : 'own',
      isBuiltin: described?.builtin ?? false,
      bianServiceDomain: null,
      permissions: asPermissionMap(held),
      catalog: { resources: [...RESOURCES], actions: [...ACTIONS] },
    });
  });

  /**
   * Every role in the realm, with what it grants.
   *
   * Two authority reads rather than one: `/roles` carries the identity of a role and `/permissions`
   * carries what each grants, and they are separate there on purpose because a role can only ever
   * grant what an application registered as enforceable.
   */
  fastify.get('/roles', {
    schema: {
      tags: ['auth'],
      summary: 'Roles in this realm',
      description: 'Read from the identity authority with the caller\'s own token. Nothing is cached here.',
      security: [{ bearerAuth: [] }],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [{ roles }, catalog] = await Promise.all([
        callAuthority<{ roles: AuthorityRole[] }>(request, '/roles'),
        callAuthority<{ roles: Array<{ name: string; permissions: string[] }> }>(request, '/permissions'),
      ]);
      const granted = new Map(catalog.roles.map((role) => [role.name, role.permissions]));

      return reply.send({
        roles: roles.map((role) => ({
          roleName: role.name,
          roleLabel: role.displayName ?? role.name,
          roleDescription: role.description,
          rolePermissions: asPermissionMap(granted.get(role.name) ?? []),
          roleScope: scopeOf(role),
          roleIsBuiltin: role.builtin ?? false,
          bianServiceDomain: 'Party Authentication',
          bianControlRecordType: 'PartyAuthenticationRole',
        })),
        catalog: { resources: [...RESOURCES], actions: [...ACTIONS] },
      });
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  fastify.get('/roles/:roleName', {
    schema: {
      tags: ['auth'],
      summary: 'One role',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['roleName'],
        properties: { roleName: { type: 'string' } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { roleName } = request.params as { roleName: string };
    try {
      const [{ roles }, catalog] = await Promise.all([
        callAuthority<{ roles: AuthorityRole[] }>(request, '/roles'),
        callAuthority<{ roles: Array<{ name: string; permissions: string[] }> }>(request, '/permissions'),
      ]);
      const role = roles.find((entry) => entry.name === roleName);
      if (!role) return reply.status(404).send({ error: 'No such role' });

      const granted = catalog.roles.find((entry) => entry.name === roleName)?.permissions ?? [];
      return reply.send({
        roleName: role.name,
        roleLabel: role.displayName ?? role.name,
        roleDescription: role.description,
        rolePermissions: asPermissionMap(granted),
        roleScope: scopeOf(role),
        roleIsBuiltin: role.builtin ?? false,
        bianServiceDomain: 'Party Authentication',
        bianControlRecordType: 'PartyAuthenticationRole',
      });
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  /**
   * The people in the directory, from SCIM.
   *
   * SCIM is the standard the authority publishes its directory through (RFC 7644), so this is a
   * translation of a standard shape into the one the screens already read, and not a second
   * directory. The principal extension carries the parts SCIM has no field for: the roles the
   * person holds and the business record they own.
   */
  fastify.get('/users', {
    schema: {
      tags: ['auth'],
      summary: 'People in this realm',
      description: 'Read from the authority\'s SCIM directory with the caller\'s own token.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { q, limit } = request.query as { q?: string; limit?: number };
    try {
      const listed = await callAuthority<{ Resources?: ScimUser[]; totalResults?: number }>(
        request,
        '/scim/v2/Users',
        { query: { count: limit ?? 50, ...(q ? { filter: `userName co "${q}"` } : {}) } },
      );
      return reply.send({
        users: (listed.Resources ?? []).map(asManagedUser),
        total: listed.totalResults ?? (listed.Resources ?? []).length,
      });
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  fastify.get('/users/:id', {
    schema: {
      tags: ['auth'],
      summary: 'One person',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const user = await callAuthority<ScimUser>(request, `/scim/v2/Users/${encodeURIComponent(id)}`);
      return reply.send(asManagedUser(user));
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  /**
   * The sign-in options, for a picker that has to render before anybody is signed in.
   *
   * PUBLIC, and it has to be: this is what a person chooses from in order to authenticate, so
   * requiring authentication to read it would be circular. It carries only what a sign-in screen
   * needs, which is why the authority's roster and branding are not passed through.
   *
   * `protocol` becomes `type` and `internal` becomes `local`: the authority names the mechanism and
   * this console has always named the KIND of directory. One translation, at the edge, rather than
   * a vocabulary change rippling through a screen that does not care.
   */
  fastify.get('/auth/domains', {
    schema: {
      tags: ['auth'],
      summary: 'Where a person may sign in',
      description: 'The realm enabled authentication providers, from the identity authority. Public.',
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const context = await callAuthority<LoginContext>(request, '/login-context');
      const domains = (context.providers ?? [])
        // A provider that is configured but not active is not somewhere anybody can sign in.
        .filter((provider) => provider.enabled)
        .map((provider) => ({
          name: provider.name,
          displayName: provider.displayName ?? provider.name,
          type: provider.protocol === 'internal' ? 'local' : provider.protocol === 'saml' ? 'saml' : 'oidc',
          /**
           * The local directory takes a credential at the authority's own form; a federated one
           * bounces. The console reads this to decide which of the two it offers.
           */
          flowType: provider.protocol === 'internal' ? 'client_credentials' : 'authorization_code',
          ...(provider.notice ? { alertMessage: provider.notice } : {}),
          ...(provider.protocol === 'internal' ? { selfRegistration: context.registrationEnabled === true } : {}),
        }));
      return reply.send({ domains });
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  /**
   * Self-registration, forwarded.
   *
   * The credential is created AT THE AUTHORITY and never passes through a collection here. This
   * route exists because the console's contract points at it, and it holds nothing: no password is
   * read, hashed, logged or stored on the way through.
   */
  fastify.post('/auth/register', {
    schema: {
      tags: ['auth'],
      summary: 'Register an account',
      description: 'Forwarded to the identity authority, which owns the credential. Public.',
      body: {
        type: 'object',
        required: ['email', 'name', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          password: { type: 'string' },
          phone: { type: 'string' },
          domain: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { email: string; name: string; password: string; phone?: string };
    try {
      const created = await callAuthority<{ lifecycleState?: string }>(request, '/register', {
        method: 'POST',
        body: {
          userName: body.name,
          email: body.email,
          password: body.password,
          ...(body.phone ? { phoneNumber: body.phone } : {}),
        },
      });
      // A realm that holds new accounts for review returns one that is not yet usable, and the
      // console shows a different screen for each, so the distinction is passed on rather than flattened.
      const status = created.lifecycleState === 'active' ? 'active' : 'pending';
      return reply.status(201).send({
        status,
        message: status === 'active'
          ? 'Your account is ready. You can sign in now.'
          : 'Your account was created and is awaiting review.',
      });
    } catch (error) {
      return relayFailure(reply, error);
    }
  });
}
const PRINCIPAL_EXTENSION = 'urn:mongodb:params:scim:schemas:extension:principal:2.0:Principal';

function statusOf(active: boolean | undefined, lifecycleState: string | undefined): 'active' | 'suspended' | 'pending' {
  if (lifecycleState === 'pending' || lifecycleState === 'provisioned') return 'pending';
  if (active === false || lifecycleState === 'suspended' || lifecycleState === 'retired') return 'suspended';
  return 'active';
}

interface ScimUser {
  id: string;
  userName?: string;
  active?: boolean;
  name?: { formatted?: string };
  emails?: Array<{ value?: string; primary?: boolean }>;
  /** RFC 7643 core attribute. The authority emits only the holdings actually in force. */
  roles?: Array<{ value?: string; display?: string; primary?: boolean }>;
  meta?: { created?: string; lastModified?: string; location?: string };
  [extension: string]: unknown;
}

function asManagedUser(user: ScimUser) {
  const extension = (user[PRINCIPAL_EXTENSION] ?? {}) as {
    accountHolderRef?: string;
    lifecycleState?: string;
  };
  const primary = user.emails?.find((email) => email.primary) ?? user.emails?.[0];

  /**
   * The role, from SCIM's own `roles` attribute rather than the vendor extension.
   *
   * It is a core attribute (RFC 7643), so any SCIM client gets it, and the authority emits only
   * the holdings in force. Collapsed to one the same way every other surface here collapses it.
   */
  const held = user.roles ?? [];
  const role = (held.find((entry) => entry.primary) ?? held[0])?.value ?? '';

  /**
   * The realm, from the resource location.
   *
   * SCIM has no field for it, and it is not the vendor extension's to invent: the location is a
   * standard part of `meta` and already names the realm the resource belongs to.
   */
  const domain = user.meta?.location?.match(/\/realms\/([^/]+)\//)?.[1] ?? '';

  return {
    id: user.id,
    email: primary?.value ?? '',
    name: user.name?.formatted ?? user.userName ?? '',
    role,
    domain,
    /**
     * `suspended` and `pending` are distinguishable, which SCIM's boolean alone is not.
     *
     * The lifecycle state carries the difference and the extension publishes it, so a suspended
     * principal and one that has never been activated do not read as the same thing.
     */
    status: statusOf(user.active, extension.lifecycleState),
    ...(extension.accountHolderRef ? { partyReference: extension.accountHolderRef } : {}),
    ...(user.meta?.created ? { createdAt: user.meta.created } : {}),
  };
}