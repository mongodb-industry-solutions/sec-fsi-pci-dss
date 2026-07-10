/**
 * CIBA (OIDC Client-Initiated Backchannel Authentication) API (tag auth:ciba).
 *
 * Routes:
 *   POST /api/v1/auth/bc-authorize                 — start a backchannel request (client-authenticated)
 *   GET  /api/v1/auth/bc-authorize/pending          — decoupled in-app AD list (SESSION-gated)
 *   GET  /api/v1/auth/bc-authorize/:authReqId        — fetch the challenge (public by reference)
 *   POST /api/v1/auth/bc-authorize/:authReqId/approve — approve (assertion-authenticated)
 *   POST /api/v1/auth/bc-authorize/:authReqId/deny    — deny (assertion or session)
 *
 * The ciba grant on POST /api/v1/auth/token lives in oauth.controller.ts (shared token endpoint).
 *
 * Public routes use `config: { skipAuth: true }` (they authenticate themselves in-handler via client
 * credentials or a signed assertion, not the PSP session JWT). `pending` omits skipAuth so it stays
 * session-gated by the global authMiddleware.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as jwt from 'jsonwebtoken';
import {
  initiateBackchannelAuth,
  getChallenge,
  listPending,
  recordApproval,
  recordDenial,
  InitiateBackchannelInput,
} from '../services/ciba.service';
import { resolveOAuthClient } from '../services/oauth.service';
import { getCurrentSessionEpoch } from '../services/auth.service';
import { Db } from 'mongodb';

function parseBasicAuth(header?: string): { id: string; secret: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
  } catch { return null; }
}

async function getSubFromRequest(request: FastifyRequest, db: Db): Promise<string | null> {
  const user = (request as any).user as { sub?: string; partyAuthenticationInstanceReference?: string } | undefined;
  const fromMiddleware = user?.sub ?? user?.partyAuthenticationInstanceReference ?? null;
  if (fromMiddleware) return fromMiddleware; // middleware already verified signature AND session epoch
  // The deny route uses skipAuth, so the global middleware does not populate request.user. Verify an
  // optional Bearer session JWT here so "deny via the owner's session" actually works.
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const secret = process.env.PSP_JWT_SECRET ?? 'demo-local-secret-change-in-production';
    const payload = jwt.verify(auth.slice(7), secret) as jwt.JwtPayload;
    const sub = (payload.sub as string) ?? null;
    if (!sub) return null;
    // Enforce the same server-side logout / session-epoch invalidation the global middleware applies,
    // so a token that is stale after logout (epoch bumped) cannot be used as the owner factor.
    const currentEpoch = await getCurrentSessionEpoch(db, sub);
    const tokenEpoch = typeof payload.epoch === 'number' ? payload.epoch : 0;
    if (tokenEpoch < currentEpoch) return null;
    return sub;
  } catch {
    return null;
  }
}

function replyError(reply: FastifyReply, err: unknown) {
  const e = err as { statusCode?: number; oauthError?: string; message?: string };
  return reply.status(e.statusCode ?? 500).send({ error: e.oauthError ?? 'server_error', error_description: e.message });
}

export async function cibaController(fastify: FastifyInstance) {
  // POST /bc-authorize — client-authenticated backchannel request
  fastify.post('/bc-authorize', {
    config: { skipAuth: true },
    schema: {
      tags: ['auth:ciba'],
      summary: 'Start a CIBA backchannel authentication request',
      description: 'Client-authenticated (client_secret_basic). Body: exactly one of login_hint/login_hint_token/id_token_hint, scope, optional binding_message/requested_expiry. client_notification_token is REQUIRED when the client uses ping/push delivery. Returns auth_req_id, expires_in, interval.',
      consumes: ['application/x-www-form-urlencoded', 'application/json'],
      body: {
        type: 'object',
        properties: {
          login_hint: { type: 'string' },
          login_hint_token: { type: 'string' },
          id_token_hint: { type: 'string' },
          scope: { type: 'string' },
          binding_message: { type: 'string' },
          requested_expiry: { type: 'integer' },
          client_notification_token: { type: 'string' },
          client_id: { type: 'string' },
          client_secret: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = (request.body ?? {}) as InitiateBackchannelInput & { client_id?: string; client_secret?: string };
    const auth = parseBasicAuth(request.headers.authorization);
    const clientId = auth?.id ?? body.client_id;
    const clientSecret = auth?.secret ?? body.client_secret;
    if (!clientId) return reply.status(401).send({ error: 'invalid_client', error_description: 'client authentication required' });
    try {
      await resolveOAuthClient(fastify.db, clientId, clientSecret || undefined, { requireClientAuthentication: true });
      const result = await initiateBackchannelAuth(fastify.db, clientId, body);
      reply.header('Cache-Control', 'no-store');
      return result;
    } catch (err) { return replyError(reply, err); }
  });

  // GET /bc-authorize/pending — decoupled in-app AD, session-gated (NOT skipAuth)
  fastify.get('/bc-authorize/pending', {
    schema: {
      tags: ['auth:ciba'],
      summary: 'List my pending backchannel requests (decoupled in-app AD)',
      description: 'Session-gated. Returns only the logged-in user\'s pending CIBA requests, for a PSP/bank app already authenticated on a second device.',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const sub = await getSubFromRequest(request, fastify.db);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      return { pending: await listPending(fastify.db, sub) };
    } catch (err) { return replyError(reply, err); }
  });

  // GET /bc-authorize/:authReqId — fetch the challenge (public by reference; approval needs the signature)
  fastify.get('/bc-authorize/:authReqId', {
    config: { skipAuth: true },
    schema: {
      tags: ['auth:ciba'],
      summary: 'Fetch the challenge for a backchannel request',
      description: 'Returns the challenge + binding_message + client name for a known auth_req_id. No PSP session required (the AD holds the auth_req_id). Safe because approval is gated by the signature, not by holding this reference.',
      params: { type: 'object', required: ['authReqId'], properties: { authReqId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { authReqId } = request.params as { authReqId: string };
    try {
      return await getChallenge(fastify.db, authReqId);
    } catch (err) { return replyError(reply, err); }
  });

  // POST /bc-authorize/:authReqId/approve — assertion-authenticated
  fastify.post('/bc-authorize/:authReqId/approve', {
    config: { skipAuth: true },
    schema: {
      tags: ['auth:ciba'],
      summary: 'Approve a backchannel request (assertion-authenticated)',
      description: 'Submit the authenticator\'s signature over the challenge. The assertion IS the authentication (proof of possession of the enrolled private key). No PSP session required (passwordless login happens when logged out).',
      params: { type: 'object', required: ['authReqId'], properties: { authReqId: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['credentialId', 'signature'],
        properties: {
          credentialId: { type: 'string' },
          signature: { type: 'string', description: 'base64url signature over the challenge string.' },
        },
      },
    },
  }, async (request, reply) => {
    const { authReqId } = request.params as { authReqId: string };
    const { credentialId, signature } = (request.body ?? {}) as { credentialId: string; signature: string };
    try {
      return await recordApproval(fastify.db, authReqId, { credentialId, signature });
    } catch (err) { return replyError(reply, err); }
  });

  // POST /bc-authorize/:authReqId/deny — assertion or session (anti-DoS)
  fastify.post('/bc-authorize/:authReqId/deny', {
    config: { skipAuth: true },
    schema: {
      tags: ['auth:ciba'],
      summary: 'Deny a backchannel request',
      description: 'Deny → token endpoint returns access_denied. Requires a signed assertion OR the owner\'s session, so a mere auth_req_id holder cannot deny (anti-DoS).',
      params: { type: 'object', required: ['authReqId'], properties: { authReqId: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          credentialId: { type: 'string' },
          signature: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { authReqId } = request.params as { authReqId: string };
    const { credentialId, signature } = (request.body ?? {}) as { credentialId?: string; signature?: string };
    // A session token (if present) is honored as the owner factor. skipAuth means the global
    // middleware did not populate request.user, so re-read the optional bearer here.
    const sessionSub = (await getSubFromRequest(request, fastify.db)) ?? undefined;
    try {
      return await recordDenial(fastify.db, authReqId, { credentialId, signature, sessionSub });
    } catch (err) { return replyError(reply, err); }
  });
}
