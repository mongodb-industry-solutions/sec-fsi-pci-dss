/**
 * OAuth Consent Grant API (SD-16 Party Authentication — ADR-038)
 * Lets authenticated users view and revoke their consent grants to merchant OAuth clients.
 *
 * Routes (all require internal PSP JWT — the user's own session):
 *   GET  /api/v1/auth/grants          — list active grants for the calling user
 *   GET  /api/v1/auth/grants/:consentId — detail of one grant owned by the caller (v18 D-01)
 *   GET  /api/v1/auth/grants/:consentId/operations — the caller's operations via that app (v18 D-02)
 *   DELETE /api/v1/auth/grants/:consentId — revoke a grant (tokens immediately invalidated)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { listUserConsentGrants, getUserConsentGrantDetail, revokeConsentGrant } from '../services/oauth.service';
import { listPartyAppActivity } from '../../provider/services/businessProcessEvent.service';

function getSubFromRequest(request: FastifyRequest): string | null {
  const user = (request as any).user as { sub?: string; partyAuthenticationInstanceReference?: string } | undefined;
  return user?.sub ?? user?.partyAuthenticationInstanceReference ?? null;
}

export async function consentGrantsController(fastify: FastifyInstance) {
  // GET /api/v1/auth/grants — list the calling user's active OAuth consent grants
  fastify.get('/grants', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'List my authorized apps (OAuth consent grants)',
      description: 'Returns all active OAuth consent grants for the authenticated user — the merchant apps the user has authorized via OIDC. Supports revocation per grant. Requires a valid PSP session token (any role).',
      security: [{ bearerAuth: [] }],
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
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });

    const grants = await listUserConsentGrants(fastify.db, sub);
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
        lastUsedAt: g.lastUsedAt ?? null,
      })),
    };
  });

  // GET /api/v1/auth/grants/:consentId — detail of ONE authorized app owned by the caller (D-01)
  fastify.get('/grants/:consentId', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Get one of my authorized apps (detail)',
      description: 'Returns the detail of a single OAuth consent grant owned by the authenticated user: merchant branding (name, logo_uri, client_uri), granted scopes with human-readable descriptions, approval date/time, last use and status. Self-scoped — a consentId that is not the caller\'s returns 404 (existence is not leaked).',
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
    const detail = await getUserConsentGrantDetail(fastify.db, sub, consentId);
    if (!detail) return reply.status(404).send({ error: 'Consent grant not found' });
    return {
      ...detail,
      oauthLogoUri: detail.oauthLogoUri ?? null,
      oauthClientUri: detail.oauthClientUri ?? null,
      lastUsedAt: detail.lastUsedAt ?? null,
    };
  });

  // GET /api/v1/auth/grants/:consentId/operations — the caller's operations executed via this app (D-02)
  fastify.get('/grants/:consentId/operations', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Operations I executed through this app',
      description: 'Returns the businessProcessEvent operations the authenticated user executed through this authorized app (attributed by clientId / merchantAgreementReference AND actingPartyReference === caller). Paginated, free-text searchable, date-range filterable. Display-safe — never returns CHD or raw IBAN. Self-scoped: a foreign consentId returns 404.',
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
        },
      },
      response: { 401: { $ref: 'Error#' }, 404: { $ref: 'Error#' } },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });

    const { consentId } = request.params as { consentId: string };
    // Verify ownership (and resolve the app's clientId + merchant ref) before querying activity.
    const detail = await getUserConsentGrantDetail(fastify.db, sub, consentId);
    if (!detail) return reply.status(404).send({ error: 'Consent grant not found' });

    const { q, dateFrom, dateTo, page, limit } = request.query as {
      q?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number;
    };
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

  // DELETE /api/v1/auth/grants/:consentId — revoke a specific consent grant
  fastify.delete('/grants/:consentId', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Revoke an OAuth consent grant',
      description: 'Revokes a specific consent grant. All active access tokens and refresh tokens for this user + merchant client are immediately invalidated. The merchant receives an `oauth.authorization_revoked` webhook.',
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
            revoked: { type: 'boolean' },
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
      await revokeConsentGrant(fastify.db, sub, consentId, 'user');
      return { revoked: true, consentId };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
  });
}
