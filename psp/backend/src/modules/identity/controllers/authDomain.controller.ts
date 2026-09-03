import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { callAuthority, AuthorityError } from '../../../vendors/security/authorityApi';

/**
 * Administering the realm's authentication paths, from this console.
 *
 * The console has had this whole surface since before the identity extraction: a paged list, a
 * detail page, create, update, delete and a role mapping panel, eighteen call sites, every one of
 * them pointed at `/api/v1/modules/domains`. That route existed in no service and never failed
 * loudly, because each caller wraps the request in a catch and the page renders a shell around an
 * empty list.
 *
 * The records live at the authority (ADR-002 there). This is the translation layer and nothing more:
 * it forwards the caller's own token, so who may administer what is decided there, and it converts
 * between two vocabularies for the same thing.
 *
 * WHY TRANSLATE AT ALL. The authority calls these `domain` records with a `protocol`; forty console
 * screens call them `partyAuthenticationDomain*`, which is the BIAN name for the same concept.
 * Neither side should adopt the other's word: the authority serves several applications and should
 * not learn one product's vocabulary, and rewriting forty screens buys nothing a mapping in one
 * file does not. So the mapping is here, once, at the edge, exactly like `partyRef`.
 */

/** What the authority publishes. Already secret-free: its read is an allowlist. */
interface AuthorityDomain {
  providerId: string;
  name: string;
  displayName: string;
  protocol: 'internal' | 'oidc' | 'saml' | 'ldap' | 'spiffe';
  adapter?: string;
  enabled: boolean;
  notice?: string;
  config?: Record<string, unknown>;
  claimMappings?: Array<{ claim: string; value: string; roleName: string }>;
  registration?: { selfServiceEnabled: boolean; autoApprove: boolean };
  hasClientSecret?: boolean;
  createdAt?: string;
  lastModifiedAt?: string;
}

/**
 * `internal` is what the authority calls its own directory; `local` is what these screens call it.
 *
 * The other protocols keep their names because both sides already agree on them. `ldap` and
 * `spiffe` have no console word, so they pass through rather than being flattened into `oidc`,
 * which would tell a screen a path speaks a protocol it does not.
 */
function consoleType(protocol: AuthorityDomain['protocol']): string {
  return protocol === 'internal' ? 'local' : protocol;
}

function authorityProtocol(type: unknown): AuthorityDomain['protocol'] | undefined {
  if (type === 'local' || type === 'internal') return 'internal';
  if (type === 'oidc' || type === 'saml' || type === 'ldap' || type === 'spiffe') return type;
  return undefined;
}

/**
 * How a screen should behave, derived rather than stored.
 *
 * The internal directory collects a credential at the authority's own form; every federated path
 * bounces the browser. That is a consequence of the protocol, so deriving it keeps one fact in one
 * place instead of letting a stored flag drift away from the protocol it describes.
 */
function flowType(protocol: AuthorityDomain['protocol']): string {
  return protocol === 'internal' ? 'client_credentials' : 'authorization_code';
}

function view(domain: AuthorityDomain): Record<string, unknown> {
  return {
    partyAuthenticationDomainInstanceReference: domain.providerId,
    partyAuthenticationDomainName: domain.name,
    partyAuthenticationDomainDisplayName: domain.displayName,
    partyAuthenticationDomainType: consoleType(domain.protocol),
    partyAuthenticationDomainFlowType: flowType(domain.protocol),
    partyAuthenticationDomainEnabled: domain.enabled,
    ...(domain.notice ? { partyAuthenticationDomainAlertMessage: domain.notice } : {}),
    partyAuthenticationDomainRoleMappings: (domain.claimMappings ?? []).map((mapping) => ({
      externalClaimOrGroup: mapping.value,
      claim: mapping.claim,
      roleName: mapping.roleName,
    })),
    // Absent upstream means no self-service, which is the reading for a federated path that has none.
    partyAuthenticationDomainSelfRegistrationEnabled: domain.registration?.selfServiceEnabled === true,
    partyAuthenticationDomainSelfRegistrationAutoApprove: domain.registration?.autoApprove === true,
    // Passed through so a screen can distinguish a provider that is misconfigured from one that is
    // merely turned off. Still a boolean: the secret itself is never published.
    partyAuthenticationDomainHasClientSecret: domain.hasClientSecret === true,
    ...(domain.config && Object.keys(domain.config).length > 0 ? { partyAuthenticationDomainConfig: domain.config } : {}),
    recordCreatedDateTime: domain.createdAt,
    recordUpdatedDateTime: domain.lastModifiedAt,
    bianServiceDomain: 'Party Authentication',
    bianControlRecordType: 'PartyAuthenticationDomain',
  };
}

/**
 * The console's words into the authority's, for a write.
 *
 * Only the fields present are sent. A console that changed one toggle must not send back a whole
 * record, because that would let a field it never rendered be overwritten with whatever it guessed.
 */
function writeBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (typeof body.partyAuthenticationDomainName === 'string') out.name = body.partyAuthenticationDomainName;
  if (typeof body.partyAuthenticationDomainDisplayName === 'string') out.displayName = body.partyAuthenticationDomainDisplayName;
  if (typeof body.partyAuthenticationDomainEnabled === 'boolean') out.enabled = body.partyAuthenticationDomainEnabled;
  if (typeof body.partyAuthenticationDomainAlertMessage === 'string') out.notice = body.partyAuthenticationDomainAlertMessage;

  const protocol = authorityProtocol(body.partyAuthenticationDomainType);
  if (protocol) out.protocol = protocol;

  if (Array.isArray(body.partyAuthenticationDomainRoleMappings)) {
    out.claimMappings = (body.partyAuthenticationDomainRoleMappings as Array<Record<string, unknown>>)
      // A mapping with no upstream group matches nothing, and one with no role grants nothing.
      // Either way it is a row somebody left half-filled, so it is dropped rather than stored.
      .filter((mapping) => String(mapping.externalClaimOrGroup ?? '').trim() && String(mapping.roleName ?? '').trim())
      .map((mapping) => ({
        claim: String(mapping.claim ?? 'groups'),
        value: String(mapping.externalClaimOrGroup),
        roleName: String(mapping.roleName),
      }));
  }

  /**
   * Self-registration is sent ONLY when the screen offered it.
   *
   * It is a property of the internal directory (ADR-002), and the console renders the two toggles
   * only for a local path. Sending `false` for a federated one would write a rule that path cannot
   * honour, and the authority would be right to keep it.
   */
  const enabled = body.partyAuthenticationDomainSelfRegistrationEnabled;
  const autoApprove = body.partyAuthenticationDomainSelfRegistrationAutoApprove;
  if (typeof enabled === 'boolean' || typeof autoApprove === 'boolean') {
    out.registration = {
      selfServiceEnabled: enabled === true,
      autoApprove: autoApprove === true,
    };
  }

  if (body.partyAuthenticationDomainConfig && typeof body.partyAuthenticationDomainConfig === 'object') {
    out.config = body.partyAuthenticationDomainConfig;
  }
  return out;
}

/** The authority's refusal, propagated. Reinterpreting it would make this a second policy point. */
function relayFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthorityError) {
    const body = error.body as { detail?: string; title?: string } | undefined;
    return reply.status(error.status).send({ error: body?.detail ?? body?.title ?? 'Request refused' });
  }
  throw error;
}

export async function authDomainController(fastify: FastifyInstance) {
  const base = '/domains';

  fastify.get(base, {
    schema: {
      tags: ['modules'],
      summary: 'Authentication domains',
      description:
        'Every way a person can prove who they are in this realm, read from the identity authority '
        + 'with the caller\'s own token. No provider secret is published.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { q, page, limit } = request.query as { q?: string; page?: number; limit?: number };
    try {
      const listed = await callAuthority<{ items: AuthorityDomain[]; total: number; page: number; limit: number }>(
        request,
        '/domains',
        { query: { ...(q ? { q } : {}), page: page ?? 1, limit: limit ?? 50 } },
      );
      return reply.send({
        items: listed.items.map(view),
        total: listed.total,
        page: listed.page,
        limit: listed.limit,
      });
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  fastify.get(`${base}/:id`, {
    schema: {
      tags: ['modules'],
      summary: 'One authentication domain',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(view(await callAuthority<AuthorityDomain>(request, `/domains/${encodeURIComponent(id)}`)));
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  fastify.post(base, {
    schema: {
      tags: ['modules'],
      summary: 'Add an authentication domain',
      description: 'Created DISABLED by the authority, so it authenticates nobody before its settings are checked.',
      security: [{ bearerAuth: [] }],
      body: { type: 'object', additionalProperties: true },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const mapped = writeBody(body);
    if (!mapped.name || !mapped.displayName || !mapped.protocol) {
      return reply.status(400).send({ error: 'A domain needs a name, a display name and a type.' });
    }
    try {
      const created = await callAuthority<AuthorityDomain>(request, '/domains', { method: 'POST', body: mapped });
      return reply.status(201).send(view(created));
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  /**
   * PUT, because that is the verb the console already uses, forwarded as a PATCH.
   *
   * The console sends the fields it changed and not the whole record, so what it means is a partial
   * update whatever the verb says. Forwarding it as a replacement would delete every field the
   * screen does not render, which for an authentication path includes the password policy, the
   * lockout and the session limit.
   */
  fastify.put(`${base}/:id`, {
    schema: {
      tags: ['modules'],
      summary: 'Change an authentication domain',
      description: 'A partial update: only the fields present are changed.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', additionalProperties: true },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const updated = await callAuthority<AuthorityDomain>(
        request,
        `/domains/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: writeBody(request.body as Record<string, unknown>) },
      );
      return reply.send(view(updated));
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  fastify.delete(`${base}/:id`, {
    schema: {
      tags: ['modules'],
      summary: 'Remove an authentication domain',
      description: 'Refused by the authority when it is the last enabled path, which would leave the realm unreachable.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      await callAuthority<{ deleted: boolean }>(request, `/domains/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return reply.send({ deleted: true });
    } catch (error) {
      return relayFailure(reply, error);
    }
  });
}
