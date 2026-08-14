/**
 * OAuth Consent Grant API (Party Authentication: ADR-038)
 * Lets authenticated users view and revoke their consent grants to merchant OAuth clients.
 *
 * Routes (all require internal PSP JWT: the user's own session):
 *   GET  /api/v1/auth/grants: list active grants for the calling user
 *   GET  /api/v1/auth/grants/:consentId, detail of one grant owned by the caller (v18 D-01)
 *   GET  /api/v1/auth/grants/:consentId/operations, the caller's operations via that app (v18 D-02)
 *   DELETE /api/v1/auth/grants/:consentId, revoke a grant (tokens immediately invalidated)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { listUserConsentGrants, getUserConsentGrantDetail, revokeConsentGrant, reactivateConsentGrant, resolveSubForParty } from '../services/oauth.service';
import { listPartyAppActivity, emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { extractUserRole, canStaffInvestigate, canStaffMutate } from '../../../vendors/middleware/rbac';

function getSubFromRequest(request: FastifyRequest): string | null {
  const user = (request as any).user as { sub?: string; partyAuthenticationInstanceReference?: string } | undefined;
  return user?.sub ?? user?.partyAuthenticationInstanceReference ?? null;
}

// Resolve the OAuth subject the request targets. When `partyRef` is present this is a staff view of
// another party's grants (gated to investigator/auditor); otherwise it is the caller's own sub.
// Returns { sub } on success, or { error, status } to send. A staff partyRef with no auth identity
// resolves to sub=null so the caller can return an empty payload without leaking existence.
export async function resolveTargetSub(
  fastify: FastifyInstance,
  request: FastifyRequest,
  partyRef: string | undefined,
): Promise<{ sub: string | null } | { error: string; status: number }> {
  if (partyRef) {
    if (!canStaffInvestigate(extractUserRole(request))) {
      return { error: 'Viewing another customer\'s authorized apps is restricted to investigator and auditor roles', status: 403 };
    }
    return { sub: await resolveSubForParty(fastify.db, partyRef) };
  }
  const sub = getSubFromRequest(request);
  if (!sub) return { error: 'Unauthorized', status: 401 };
  return { sub };
}

export async function consentGrantsController(fastify: FastifyInstance) {
  // GET /api/v1/auth/grants: list the calling user's active OAuth consent grants
  fastify.get('/grants', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'List my authorized apps (OAuth consent grants)',
      description: 'Returns the authenticated user\'s OAuth consent grants, the merchant apps authorized via OIDC. Revoked grants are kept (soft-revoke) so the user can review past apps/operations and re-approve; filter with `status` (active | revoked | all, default all). Requires a valid PSP session token (any role). **Staff view (v27):** pass `partyRef` (a found customer\'s `partyInstanceReference`) to list THAT party\'s grants; this is restricted to `level2_investigator` and `security_auditor` (else 403).',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'revoked', 'all'], default: 'all', description: 'Filter by consent status. Default all (active + revoked).' },
          partyRef: { type: 'string', description: 'Staff target: a customer\'s `partyInstanceReference`. When present, requires investigator/auditor and returns that party\'s grants instead of the caller\'s own.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            grants: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  consentId: { type: 'string' },
                  oauthClientId: { type: 'string' },
                  merchantAgreementInstanceReference: { type: 'string', description: 'v18: SD-89 merchant reference (for detail/activity views).' },
                  merchantName: { type: 'string' },
                  oauthLogoUri: { type: 'string', nullable: true, description: 'v18: OIDC logo_uri of the merchant app (branding).' },
                  grantedScopes: { type: 'array', items: { type: 'string' } },
                  consentStatus: { type: 'string', enum: ['active', 'revoked'] },
                  consentGrantedAt: { type: 'string', format: 'date-time' },
                  consentRevokedAt: { type: 'string', format: 'date-time', nullable: true, description: 'When the grant was revoked (soft-revoke); null while active.' },
                  lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
          },
        },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { status, partyRef } = request.query as { status?: 'active' | 'revoked' | 'all'; partyRef?: string };

    // Staff view: resolve the target party's OAuth subject server-side. Gated to investigator/auditor.
    let sub: string | null;
    if (partyRef) {
      if (!canStaffInvestigate(extractUserRole(request))) {
        return reply.status(403).send({ error: 'Viewing another customer\'s authorized apps is restricted to investigator and auditor roles' });
      }
      sub = await resolveSubForParty(fastify.db, partyRef);
      if (!sub) return { grants: [] }; // party has no auth identity → no grants (do not leak existence)
    } else {
      sub = getSubFromRequest(request);
      if (!sub) return reply.status(401).send({ error: 'Unauthorized' });
    }

    const grants = await listUserConsentGrants(fastify.db, sub, status ?? 'all');
    return {
      grants: grants.map((g) => ({
        consentId: g.consentId,
        oauthClientId: g.oauthClientId,
        merchantAgreementInstanceReference: g.merchantAgreementInstanceReference,
        merchantName: g.merchantName,
        oauthLogoUri: g.oauthLogoUri ?? null,
        grantedScopes: g.grantedScopes,
        consentStatus: g.consentStatus,
        consentGrantedAt: g.consentGrantedAt,
        consentRevokedAt: g.consentRevokedAt ?? null,
        lastUsedAt: g.lastUsedAt ?? null,
      })),
    };
  });

  // GET /api/v1/auth/grants/:consentId, detail of ONE authorized app owned by the caller (D-01)
  fastify.get('/grants/:consentId', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Get one of my authorized apps (detail)',
      description: 'Returns the detail of a single OAuth consent grant owned by the authenticated user: merchant branding (name, logo_uri, client_uri), granted scopes with human-readable descriptions, approval date/time, last use and status. Self-scoped: a consentId that is not the caller\'s returns 404 (existence is not leaked). **Staff view (v27):** pass `partyRef` (a found customer\'s `partyInstanceReference`) to read THAT party\'s grant detail; restricted to `level2_investigator` and `security_auditor` (else 403).',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['consentId'],
        properties: { consentId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          partyRef: { type: 'string', description: 'Staff target: a customer\'s `partyInstanceReference`. When present, requires investigator/auditor and returns that party\'s grant detail instead of the caller\'s own.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            consentId: { type: 'string' },
            oauthClientId: { type: 'string' },
            merchantAgreementInstanceReference: { type: 'string' },
            merchantName: { type: 'string' },
            oauthLogoUri: { type: 'string', nullable: true },
            oauthClientUri: { type: 'string', nullable: true },
            grantedScopes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  scope: { type: 'string' },
                  description: { type: 'string' },
                  required: { type: 'boolean' },
                },
              },
            },
            consentStatus: { type: 'string', enum: ['active', 'revoked'] },
            consentGrantedAt: { type: 'string', format: 'date-time' },
            lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
            cibaEnabled: { type: 'boolean', description: 'this client may initiate CIBA (passwordless) on the user\'s behalf.' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { partyRef } = request.query as { partyRef?: string };
    const resolved = await resolveTargetSub(fastify, request, partyRef);
    if ('error' in resolved) return reply.status(resolved.status).send({ error: resolved.error });
    if (!resolved.sub) return reply.status(404).send({ error: 'Consent grant not found' });

    const { consentId } = request.params as { consentId: string };
    const detail = await getUserConsentGrantDetail(fastify.db, resolved.sub, consentId);
    if (!detail) return reply.status(404).send({ error: 'Consent grant not found' });
    return {
      ...detail,
      oauthLogoUri: detail.oauthLogoUri ?? null,
      oauthClientUri: detail.oauthClientUri ?? null,
      lastUsedAt: detail.lastUsedAt ?? null,
    };
  });

  // GET /api/v1/auth/grants/:consentId/operations, the caller's operations executed via this app (D-02)
  fastify.get('/grants/:consentId/operations', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Operations I executed through this app',
      description: 'Returns the businessProcessEvent operations the authenticated user executed through this authorized app (attributed by clientId / merchantAgreementReference AND actingPartyReference === caller). Paginated, free-text searchable, date-range filterable. Display-safe: never returns CHD or raw IBAN. Self-scoped: a foreign consentId returns 404. **Staff view (v27):** pass `partyRef` (a found customer\'s `partyInstanceReference`) to read THAT party\'s operations through the app; restricted to `level2_investigator` and `security_auditor` (else 403).',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['consentId'],
        properties: { consentId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          partyRef: { type: 'string', description: 'Staff target: a customer\'s `partyInstanceReference`. When present, requires investigator/auditor and returns that party\'s operations instead of the caller\'s own.' },
        },
      },
      response: { 401: { $ref: 'Error#' }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' } },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { q, dateFrom, dateTo, page, limit, partyRef } = request.query as {
      q?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number; partyRef?: string;
    };
    const resolved = await resolveTargetSub(fastify, request, partyRef);
    if ('error' in resolved) return reply.status(resolved.status).send({ error: resolved.error });
    if (!resolved.sub) return reply.status(404).send({ error: 'Consent grant not found' });
    const sub = resolved.sub;

    const { consentId } = request.params as { consentId: string };
    // Verify the grant belongs to the target sub (and resolve clientId + merchant ref) before querying.
    const detail = await getUserConsentGrantDetail(fastify.db, sub, consentId);
    if (!detail) return reply.status(404).send({ error: 'Consent grant not found' });

    return listPartyAppActivity(fastify.db, {
      actingPartyReference: sub,
      clientId: detail.oauthClientId,
      merchantAgreementReference: detail.merchantAgreementInstanceReference,
      q: q || undefined,
      from: dateFrom ? new Date(dateFrom) : undefined,
      to: dateTo ? new Date(dateTo) : undefined,
      page, limit,
    });
  });

  // DELETE /api/v1/auth/grants/:consentId, revoke a specific consent grant
  fastify.delete('/grants/:consentId', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Revoke an OAuth consent grant',
      description: 'Revokes a specific consent grant. All active access tokens and refresh tokens for this user + merchant client are immediately invalidated. The merchant receives an `oauth.authorization_revoked` webhook. **Staff action (v27):** pass `partyRef` to revoke a grant the caller does NOT own; this is restricted to `level2_investigator` only (auditor is read-only, L1 has no reach → 403) and is audited.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['consentId'],
        properties: { consentId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          partyRef: { type: 'string', description: 'Staff target: the owning customer\'s `partyInstanceReference`. When present, this is a staff revoke (level2_investigator only).' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            revoked: { type: 'boolean' },
            consentId: { type: 'string' },
          },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });

    const { consentId } = request.params as { consentId: string };
    const { partyRef } = request.query as { partyRef?: string };
    const role = extractUserRole(request);

    // Staff revoke of a grant the caller does not own: investigator only, audited (PCI DSS).
    if (partyRef) {
      if (!canStaffMutate(role)) {
        return reply.status(403).send({ error: 'Revoking another customer\'s authorized app is restricted to level2_investigator' });
      }
      try {
        await revokeConsentGrant(fastify.db, sub, consentId, 'psp', { staffOverride: true });
        emitComplianceEvent(fastify.db, {
          entityType: 'customer',
          entityId: partyRef,
          processType: 'authentication',
          processAction: 'oauth.consent.revoked_by_staff',
          processOutcome: 'approved',
          performedByPartyReference: sub,
          performedByRole: role,
          eventSummary: { consentId, targetPartyReference: partyRef },
          bianServiceDomain: 'PartyAuthentication',
          bianControlRecordType: 'ConsentGrant',
        });
        return { revoked: true, consentId };
      } catch (err: any) {
        return reply.status(err.statusCode ?? 500).send({ error: err.message });
      }
    }

    // Self-revoke (unchanged).
    try {
      await revokeConsentGrant(fastify.db, sub, consentId, 'user');
      return { revoked: true, consentId };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  // POST /api/v1/auth/grants/:consentId/reactivate, re-approve a previously revoked grant
  fastify.post('/grants/:consentId/reactivate', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Re-approve a revoked OAuth consent grant',
      description: 'Reverts an earlier revocation from the Authorized Applications view: restores the consent record and its previously granted scopes. Mints NO tokens, the merchant must run the OAuth authorization_code flow again to obtain fresh tokens (the prior scopes now count as granted, so re-consent is smooth). Emits an oauth.authorization_granted webhook. Self-scoped; a foreign consentId returns 404. Idempotent when already active.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['consentId'],
        properties: { consentId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            reactivated: { type: 'boolean' },
            consentId: { type: 'string' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });

    const { consentId } = request.params as { consentId: string };
    try {
      await reactivateConsentGrant(fastify.db, sub, consentId);
      return { reactivated: true, consentId };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
  });
}
