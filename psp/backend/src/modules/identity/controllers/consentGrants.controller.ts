/**
 * Authorized Applications: what a user has allowed a merchant app to do.
 *
 * The page and its shape do not move. This is a person looking at their own data inside this
 * product, not an administrative screen, and the routes below answer exactly what they answered
 * before. What changed is where the data comes from: the authorisations now live at the identity
 * authority, and this application reads them by forwarding the caller's own token.
 *
 * Three rules make that safe rather than merely convenient:
 *
 * - Nothing is stored and nothing is cached here. A withdrawn authorisation has to be gone on the
 *   next render, and a cache is precisely what would keep a revoked one alive on screen.
 * - Who may see or withdraw what is decided at the authority. This service does not filter the
 *   result, because a filter applied after the fact by a client is a presentation choice and not an
 *   access control.
 * - The commercial record of the merchant stays here, because it is this product's data. The join is
 *   by client id, which is the one identifier both sides legitimately share.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { callAuthority, AuthorityError } from '../../../vendors/security/authorityApi';
import { findClientById } from '../../gateway/services/oauthClientRegistry.service';
import { listPartyAppActivity } from '../../provider/services/businessProcessEvent.service';

interface AuthorityGrant {
  grantId: string;
  clientId: string;
  clientName: string;
  logoUri?: string;
  scopes: string[];
  status: 'active' | 'revoked';
  grantedAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

/** The shape this product's screens already expect, filled from both sides. */
async function toView(fastify: FastifyInstance, grant: AuthorityGrant) {
  const commercial = await findClientById(fastify.db, grant.clientId);
  return {
    consentId: grant.grantId,
    oauthClientId: grant.clientId,
    merchantAgreementInstanceReference: commercial?.merchantAgreementInstanceReference,
    merchantName: commercial?.merchantName ?? grant.clientName,
    oauthLogoUri: commercial?.oauthLogoUri ?? grant.logoUri ?? null,
    grantedScopes: grant.scopes,
    consentStatus: grant.status,
    consentGrantedAt: grant.grantedAt,
    consentRevokedAt: grant.revokedAt ?? null,
    lastUsedAt: grant.lastUsedAt ?? null,
  };
}

/** The authority's refusal, propagated. Reinterpreting it here would make this a second policy point. */
function relayFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthorityError) {
    const body = error.body as { detail?: string; title?: string } | undefined;
    return reply.status(error.status).send({ error: body?.detail ?? body?.title ?? 'Request refused' });
  }
  throw error;
}

export async function consentGrantsController(fastify: FastifyInstance) {
  // The staff view names the customer by this product's own reference. The authority resolves which
  // principal is bound to it and decides whether the caller may look, so no mapping is held here.
  const onBehalf = (partyRef?: string) => (partyRef ? { accountHolderRef: partyRef } : {});

  fastify.get('/grants', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'List my authorized apps',
      description:
        'The authenticated user\'s authorizations, read from the identity authority with the '
        + 'caller\'s own token. Revoked grants are kept so past apps and operations can still be '
        + 'reviewed and re-approved; filter with `status`. Pass `partyRef` to view another customer\'s, '
        + 'which the authority permits only for a role that grants it.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'revoked', 'all'], default: 'all' },
          partyRef: { type: 'string', description: 'The customer to view instead of the caller.' },
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
                  merchantAgreementInstanceReference: { type: 'string' },
                  merchantName: { type: 'string' },
                  oauthLogoUri: { type: 'string', nullable: true },
                  grantedScopes: { type: 'array', items: { type: 'string' } },
                  consentStatus: { type: 'string', enum: ['active', 'revoked'] },
                  consentGrantedAt: { type: 'string' },
                  consentRevokedAt: { type: 'string', nullable: true },
                  lastUsedAt: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { status, partyRef } = request.query as { status?: string; partyRef?: string };
    try {
      const { grants } = await callAuthority<{ grants: AuthorityGrant[] }>(request, '/grants', {
        query: { status: status ?? 'all', ...onBehalf(partyRef) },
      });
      return { grants: await Promise.all(grants.map((grant) => toView(fastify, grant))) };
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  fastify.get('/grants/:consentId', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Get one of my authorized apps',
      description:
        'One authorization, read from the identity authority with the caller\'s own token. A grant '
        + 'belonging to somebody else is not found rather than found and refused.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['consentId'],
        properties: { consentId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: { partyRef: { type: 'string' } },
      },
      response: { 401: { $ref: 'Error#' }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' } },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { consentId } = request.params as { consentId: string };
    const { partyRef } = request.query as { partyRef?: string };
    try {
      const grant = await callAuthority<AuthorityGrant>(request, `/grants/${encodeURIComponent(consentId)}`, {
        query: onBehalf(partyRef),
      });
      return toView(fastify, grant);
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  fastify.get('/grants/:consentId/operations', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Operations I executed through this app',
      description:
        'What the user actually DID through this app: payments, transfers, beneficiary changes. These '
        + 'are this product\'s business events and they stay here, because a business outcome is not '
        + 'an identity event and recording it at the authority would create a second source of truth '
        + 'for it. Ownership of the authorization is confirmed at the authority first. Display-safe: '
        + 'never returns card data or a raw account number.',
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
          partyRef: { type: 'string' },
        },
      },
      response: { 401: { $ref: 'Error#' }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' } },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { consentId } = request.params as { consentId: string };
    const { q, dateFrom, dateTo, page, limit, partyRef } = request.query as {
      q?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number; partyRef?: string;
    };

    let grant: AuthorityGrant;
    try {
      // Confirms both that the authorization exists and that this caller may see it, at the
      // authority, before any business record is read here.
      grant = await callAuthority<AuthorityGrant>(request, `/grants/${encodeURIComponent(consentId)}`, {
        query: onBehalf(partyRef),
      });
    } catch (error) {
      return relayFailure(reply, error);
    }

    const commercial = await findClientById(fastify.db, grant.clientId);
    const actingParty = partyRef ?? ((request as unknown as { user?: { sub?: string } }).user?.sub ?? '');
    return listPartyAppActivity(fastify.db, {
      actingPartyReference: actingParty,
      clientId: grant.clientId,
      merchantAgreementReference: commercial?.merchantAgreementInstanceReference,
      q: q || undefined,
      from: dateFrom ? new Date(dateFrom) : undefined,
      to: dateTo ? new Date(dateTo) : undefined,
      page,
      limit,
    });
  });

  fastify.delete('/grants/:consentId', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Revoke an authorization',
      description:
        'Withdraws the authorization at the identity authority, which invalidates what was issued '
        + 'under it. Pass `partyRef` to withdraw on another customer\'s behalf; the authority permits '
        + 'that only for a role that grants it, and records who did it.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['consentId'],
        properties: { consentId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: { partyRef: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { revoked: { type: 'boolean' }, consentId: { type: 'string' } },
        },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { consentId } = request.params as { consentId: string };
    const { partyRef } = request.query as { partyRef?: string };
    try {
      await callAuthority(request, `/grants/${encodeURIComponent(consentId)}`, {
        method: 'DELETE',
        query: onBehalf(partyRef),
      });
      return { revoked: true, consentId };
    } catch (error) {
      return relayFailure(reply, error);
    }
  });

  fastify.post('/grants/:consentId/reactivate', {
    schema: {
      tags: ['auth:oauth'],
      summary: 'Re-approve a revoked authorization',
      description:
        'Restores a previously withdrawn authorization and its scopes at the identity authority. '
        + 'Mints no tokens: the app runs the authorization flow again, and the prior scopes now count '
        + 'as granted so re-consent is smooth. The owner\'s own action and nobody else\'s, because it '
        + 'gives access back without anyone approving it afresh.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['consentId'],
        properties: { consentId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { reactivated: { type: 'boolean' }, consentId: { type: 'string' } },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { consentId } = request.params as { consentId: string };
    try {
      await callAuthority(request, `/grants/${encodeURIComponent(consentId)}/reactivate`, { method: 'POST' });
      return { reactivated: true, consentId };
    } catch (error) {
      return relayFailure(reply, error);
    }
  });
}
