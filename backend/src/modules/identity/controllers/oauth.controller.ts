/**
 * OAuth 2.0 endpoints (ADR-033, ADR-034)
 * All under /api/v1/auth/ prefix (registered in identityModule)
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  initiateAuthorization,
  issueAuthorizationCode,
  exchangeAuthorizationCode,
  issueClientCredentialsToken,
  refreshAccessToken,
  getUserinfo,
  revokeToken,
  resolveOAuthClient,
  verifyAccessToken,
  applyUserScopeSelection,
  getPriorConsentScopes,
} from '../services/oauth.service';
import { redeemCibaGrant } from '../services/ciba.service';
import { auditOAuth, auditOAuthWithMerchantLookup, classifyOAuthFailure, stateForCode } from '../services/oauthAudit.service';

function parseBasicAuth(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { id: decoded.slice(0, colon), secret: decoded.slice(colon + 1) };
}

function oauthErrorReply(reply: FastifyReply, err: any) {
  const status = err.statusCode ?? 500;
  const error = err.oauthError ?? 'server_error';
  reply.status(status).send({ error, error_description: err.message });
}

export async function oauthController(fastify: FastifyInstance) {
  const db = () => (fastify as any).db;

  // ── GET /api/v1/auth/authorize ──────────────────────────────────────────────
  fastify.get('/authorize', {
    schema: {
      tags: ['auth:oidc'],
      summary: 'OAuth 2.0 Authorization Endpoint',
      description: `Initiates the Authorization Code flow (RFC 6749 §4.1).\n\nFor browser flows, the user is redirected here from the merchant app. The PSP frontend consent page renders the login + consent UI. On grant/deny, the endpoint redirects back to redirect_uri with code or error.\n\nRequired query params: client_id, redirect_uri, response_type=code, scope (must include openid)\n\nOptional: state, code_challenge (S256), code_challenge_method=S256, nonce`,
      querystring: {
        type: 'object',
        required: ['client_id', 'redirect_uri', 'response_type', 'scope'],
        properties: {
          client_id: { type: 'string' },
          redirect_uri: { type: 'string' },
          response_type: { type: 'string' },
          scope: { type: 'string' },
          state: { type: 'string' },
          code_challenge: { type: 'string' },
          code_challenge_method: { type: 'string' },
          nonce: { type: 'string' },
          // Internal: consent form submission flags
          _psp_action: { type: 'string', enum: ['grant', 'deny'] },
          _psp_sub: { type: 'string' }, // user sub after login
          _psp_scopes: { type: 'string' }, // v18: user's granular scope selection (space/comma separated)
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string>;

    try {
      const validated = await initiateAuthorization(db(), {
        clientId: q.client_id,
        redirectUri: q.redirect_uri,
        responseType: q.response_type,
        scope: q.scope,
        state: q.state,
        codeChallenge: q.code_challenge,
        codeChallengeMethod: q.code_challenge_method,
        nonce: q.nonce,
      });

      // If consent action submitted (from PSP frontend consent form).
      // Always redirect to the registered redirect_uri returned by initiateAuthorization
      // (validated.redirectUri), never the raw query value: prevents open redirect.
      if (q._psp_action === 'deny') {
        auditOAuth(db(), 'oauth.authorize.denied', {
          clientId: q.client_id, sub: q._psp_sub, state: q.state, outcome: 'rejected', reason: 'access_denied',
        });
        const redirectUrl = new URL(validated.redirectUri);
        redirectUrl.searchParams.set('error', 'access_denied');
        if (q.state) redirectUrl.searchParams.set('state', q.state);
        return reply.redirect(redirectUrl.toString());
      }

      if (q._psp_action === 'grant' && q._psp_sub) {
        // v18 E-04/E-05: apply the user's granular selection (force-including required scopes).
        // Falls back to the full allowed set if no selection was submitted (backward compatible).
        if (q._psp_scopes !== undefined) {
          const userSelected = q._psp_scopes.split(/[\s,]+/).filter(Boolean);
          validated.scopes = applyUserScopeSelection(validated.scopes, userSelected);
        }
        const { code, state } = await issueAuthorizationCode(db(), q.client_id, q._psp_sub, validated);
        const redirectUrl = new URL(validated.redirectUri);
        redirectUrl.searchParams.set('code', code);
        if (state) redirectUrl.searchParams.set('state', state);
        return reply.redirect(redirectUrl.toString());
      }

      // No action yet: return validated params so frontend can render consent page.
      // v18 E-03/E-10: include scope metadata, merchant branding, and (post-login) the scopes
      // already granted to this client so the UI can highlight newly-requested permissions.
      const previouslyGranted = q._psp_sub
        ? await getPriorConsentScopes(db(), q._psp_sub, q.client_id)
        : [];
      return {
        client_name: validated.client.merchantName,
        client_id: validated.client.clientId,
        scopes: validated.scopes,
        scope_details: validated.scopeDescriptors,
        logo_uri: validated.client.oauthLogoUri,
        client_uri: validated.client.oauthClientUri,
        previously_granted_scopes: previouslyGranted,
        redirect_uri: q.redirect_uri,
        state: q.state,
        code_challenge: q.code_challenge,
        nonce: q.nonce,
      };
    } catch (err: any) {
      // Per RFC 6749 §4.1.2.1: if redirect_uri or client_id is invalid, do NOT redirect
      if (err.oauthError === 'invalid_request' && err.message?.includes('redirect_uri')) {
        return oauthErrorReply(reply, err);
      }
      // All other errors: redirect to redirect_uri?error=..., but ONLY after confirming the
      // redirect_uri is registered for this client. Some errors (e.g. unsupported response_type,
      // unknown client) are thrown before initiateAuthorization validates the redirect_uri, so we
      // must re-check the client allowlist here to avoid an open redirect (RFC 6749 §4.1.2.1).
      if (q.redirect_uri && q.client_id) {
        try {
          const client = await resolveOAuthClient(db(), q.client_id);
          if (client.redirectUris.includes(q.redirect_uri)) {
            const redirectUrl = new URL(q.redirect_uri);
            redirectUrl.searchParams.set('error', err.oauthError ?? 'server_error');
            redirectUrl.searchParams.set('error_description', err.message);
            if (q.state) redirectUrl.searchParams.set('state', q.state);
            return reply.redirect(redirectUrl.toString());
          }
        } catch {
          // Client not resolvable or redirect_uri malformed: fall through to direct error.
        }
      }
      return oauthErrorReply(reply, err);
    }
  });

  // ── POST /api/v1/auth/token ─────────────────────────────────────────────────
  fastify.post('/token', {
    schema: {
      tags: ['auth:oidc'],
      summary: 'OAuth 2.0 Token Endpoint',
      description: `Issues access tokens, ID tokens, and refresh tokens (RFC 6749).\n\nSupported grant_type values:\n- authorization_code: exchange code for tokens (with PKCE code_verifier if required)\n- client_credentials: service-to-service access (server auth required)\n- refresh_token: rotate access token using a refresh token\n\nClient authentication via Authorization: Basic base64(client_id:client_secret)`,
      consumes: ['application/x-www-form-urlencoded'],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // A POST with no form body leaves req.body undefined; without this the failure audit below
    // dereferences it off-request and surfaces as an unhandled rejection instead of a 400.
    const body = (req.body ?? {}) as Record<string, string>;
    const auth = parseBasicAuth(req.headers.authorization);

    try {
      const grantType = body.grant_type;
      const clientId = auth?.id ?? body.client_id;
      const clientSecret = auth?.secret ?? body.client_secret;

      if (!clientId) {
        return reply.status(400).send({ error: 'invalid_request', error_description: 'client_id required' });
      }

      let result;

      if (grantType === 'authorization_code') {
        if (!body.code || !body.redirect_uri) {
          return reply.status(400).send({ error: 'invalid_request', error_description: 'code and redirect_uri required' });
        }
        // Authenticate the client. A confidential client (secret provisioned) must present it here;
        // a public client (no secret) relies on PKCE. Enforced via requireClientAuthentication.
        await resolveOAuthClient(db(), clientId, clientSecret || undefined, { requireClientAuthentication: true });
        result = await exchangeAuthorizationCode(db(), clientId, body.code, body.redirect_uri, body.code_verifier);

      } else if (grantType === 'client_credentials') {
        if (!clientSecret) {
          return reply.status(401).send({ error: 'invalid_client', error_description: 'client authentication required for client_credentials' });
        }
        await resolveOAuthClient(db(), clientId, clientSecret, { requireClientAuthentication: true });
        const scopes = body.scope?.split(' ').filter(Boolean) ?? [];
        result = await issueClientCredentialsToken(db(), clientId, scopes);

      } else if (grantType === 'refresh_token') {
        if (!body.refresh_token) {
          return reply.status(400).send({ error: 'invalid_request', error_description: 'refresh_token required' });
        }
        // Confidential clients must re-authenticate to rotate tokens (previously the secret was optional).
        await resolveOAuthClient(db(), clientId, clientSecret || undefined, { requireClientAuthentication: true });
        result = await refreshAccessToken(db(), clientId, body.refresh_token);

      } else if (grantType === 'urn:openid:params:grant-type:ciba') {
        // CIBA: redeem an approved backchannel request. The client must re-authenticate and
        // redeemCibaGrant additionally verifies this client OWNS the auth_req_id (rejects cross-client).
        if (!body.auth_req_id) {
          return reply.status(400).send({ error: 'invalid_request', error_description: 'auth_req_id required' });
        }
        await resolveOAuthClient(db(), clientId, clientSecret || undefined, { requireClientAuthentication: true });
        result = await redeemCibaGrant(db(), clientId, body.auth_req_id);

      } else {
        return reply.status(400).send({ error: 'unsupported_grant_type', error_description: `grant_type '${grantType}' not supported` });
      }

      reply.header('Cache-Control', 'no-store');
      return result;
    } catch (err: any) {
      // Audit the failed token exchange with the classified CAUSE (bad secret / PKCE / redirect_uri /
      // expired code, …) and the merchant behind the clientId, so an auditor/manager can pinpoint the
      // failure: the merchant only sees a generic token_exchange_failed. No secret is emitted.
      const { cause, explanation } = classifyOAuthFailure(err.oauthError, err.message);
      // Recover the flow's `state` from the code (for authorization_code grants) so the failure shares
      // the SAME flowId as the rest of the flow and is filterable by it. Fully fire-and-forget.
      void (async () => {
        const state = await stateForCode(db(), body.code);
        await auditOAuthWithMerchantLookup(db(), 'oauth.token.failed', {
          clientId: auth?.id ?? body.client_id,
          grantType: body.grant_type,
          state,
          outcome: 'failed',
          reason: err.oauthError ?? err.message ?? 'server_error',
          failureCause: `${cause}: ${explanation}`,
        });
      })();
      return oauthErrorReply(reply, err);
    }
  });

  // ── GET /api/v1/auth/userinfo ───────────────────────────────────────────────
  fastify.get('/userinfo', {
    schema: {
      tags: ['auth:oidc'],
      summary: 'OIDC UserInfo Endpoint',
      description: 'Returns authenticated user claims. Requires Authorization: Bearer <access_token> with at minimum the openid scope.',
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const bearer = req.headers.authorization?.replace('Bearer ', '');
    if (!bearer) {
      return reply.status(401).send({ error: 'invalid_token', error_description: 'Missing Bearer token' });
    }
    try {
      const info = await getUserinfo(db(), bearer);
      return info;
    } catch (err: any) {
      auditOAuth(db(), 'oauth.userinfo.accessed', { outcome: 'failed', reason: err.oauthError ?? 'invalid_token' });
      return oauthErrorReply(reply, err);
    }
  });

  // ── POST /api/v1/auth/revoke ────────────────────────────────────────────────
  fastify.post('/revoke', {
    schema: {
      tags: ['auth:oidc'],
      summary: 'OAuth 2.0 Token Revocation (RFC 7009)',
      description: 'Revokes an access or refresh token. Always returns 200 (RFC 7009 §2.2, no information leakage).',
      consumes: ['application/x-www-form-urlencoded'],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, string>;
    try {
      await revokeToken(db(), body.token ?? '');
    } catch {
      // RFC 7009: always return 200
    }
    return {};
  });
}
