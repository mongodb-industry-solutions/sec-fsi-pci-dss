/**
 * OAuth Consent Grant API (SD-16 Party Authentication — ADR-038)
 * Lets authenticated users view and revoke their consent grants to merchant OAuth clients.
 *
 * Routes (all require internal PSP JWT — the user's own session):
 *   GET  /api/v1/auth/grants          — list active grants for the calling user
 *   DELETE /api/v1/auth/grants/:consentId — revoke a grant (tokens immediately invalidated)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { listUserConsentGrants, revokeConsentGrant } from '../services/oauth.service';

function getSubFromRequest(request: FastifyRequest): string | null {
  const user = (request as any).user as { sub?: string; partyAuthenticationInstanceReference?: string } | undefined;
  return user?.sub ?? user?.partyAuthenticationInstanceReference ?? null;
}

export async function consentGrantsController(fastify: FastifyInstance) {
  // GET /api/v1/auth/grants — list the calling user's active OAuth consent grants
  fastify.get('/grants', {
    schema: {
      tags: ['oauth'],
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
                  merchantName: { type: 'string' },
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
        grantedScopes: g.grantedScopes,
        consentStatus: g.consentStatus,
        consentGrantedAt: g.consentGrantedAt,
        lastUsedAt: g.lastUsedAt ?? null,
      })),
    };
  });

  // DELETE /api/v1/auth/grants/:consentId — revoke a specific consent grant
  fastify.delete('/grants/:consentId', {
    schema: {
      tags: ['oauth'],
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
