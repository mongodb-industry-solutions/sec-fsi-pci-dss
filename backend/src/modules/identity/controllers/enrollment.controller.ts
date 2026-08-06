/**
 * Passwordless credential enrollment API (SD-91/SD-16, tag auth:enrollment).
 * WebAuthn-style registration ceremony. All routes are SESSION-GATED (the global authMiddleware
 * protects everything not in PUBLIC_EXACT; enrollment is intentionally NOT public). Owner-scoped:
 * every operation is bound to the caller's own sub.
 *
 * Routes:
 *   POST   /api/v1/auth/enroll/challenge: issue a registration challenge to sign
 *   POST   /api/v1/auth/enroll: register a public key (signed challenge proves possession)
 *   GET    /api/v1/auth/enroll: list the caller's enrolled credentials
 *   POST   /api/v1/auth/enroll/:credentialId/rotate, rotate (register replacement, revoke old)
 *   DELETE /api/v1/auth/enroll/:credentialId, revoke a credential
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  issueRegistrationChallenge,
  registerCredential,
  listCredentials,
  revokeCredential,
  rotateCredential,
  RegisterCredentialInput,
} from '../services/enrollment.service';

function getSubFromRequest(request: FastifyRequest): string | null {
  const user = (request as any).user as { sub?: string; partyAuthenticationInstanceReference?: string } | undefined;
  // dualAuth (v25): a first-party portal session populates request.user; a third-party merchant OAuth
  // Bearer (user-delegated authorization_code token) populates request.merchantContext with the acting
  // user's sub. Enrollment stays owner-scoped either way (bound to the resolved sub).
  return user?.sub ?? user?.partyAuthenticationInstanceReference ?? request.merchantContext?.sub ?? null;
}

function replyError(reply: FastifyReply, err: unknown) {
  const e = err as { statusCode?: number; oauthError?: string; message?: string };
  return reply.status(e.statusCode ?? 500).send({ error: e.oauthError ?? 'server_error', error_description: e.message });
}

const registerBody = {
  type: 'object',
  required: ['challenge', 'publicKeyPem', 'alg', 'signature'],
  properties: {
    challenge: { type: 'string', description: 'The challenge returned by /enroll/challenge.' },
    publicKeyPem: { type: 'string', description: 'SPKI PEM public key (public material only).' },
    alg: { type: 'string', enum: ['RS256', 'ES256'] },
    signature: { type: 'string', description: 'base64url signature over the challenge string.' },
    credentialId: { type: 'string' },
    authenticatorMetadata: {
      type: 'object',
      properties: {
        deviceName: { type: 'string' },
        aaguid: { type: 'string' },
        transports: { type: 'array', items: { type: 'string' } },
        createdVia: { type: 'string' },
      },
    },
  },
} as const;

export async function enrollmentController(fastify: FastifyInstance) {
  fastify.post('/enroll/challenge', {
    config: { dualAuth: true },
    schema: {
      tags: ['auth:enrollment'],
      summary: 'Issue a passwordless registration challenge',
      description: 'Returns a short-lived, HMAC-bound challenge the device signs during registration. Authenticated by a first-party portal session OR a user-delegated merchant OAuth Bearer (dualAuth).',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      return issueRegistrationChallenge(sub);
    } catch (err) { return replyError(reply, err); }
  });

  fastify.post('/enroll', {
    config: { dualAuth: true },
    schema: {
      tags: ['auth:enrollment'],
      summary: 'Register a passwordless credential (public key)',
      description: 'Stores the public key + credential metadata after verifying the signed challenge (proof of possession). Public material only (PCI Req.3). Portal session OR user-delegated merchant OAuth Bearer (dualAuth).',
      security: [{ bearerAuth: [] }],
      body: registerBody,
    },
  }, async (request, reply) => {
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      return await registerCredential(fastify.db, sub, request.body as RegisterCredentialInput);
    } catch (err) { return replyError(reply, err); }
  });

  fastify.get('/enroll', {
    config: { dualAuth: true },
    schema: {
      tags: ['auth:enrollment'],
      summary: 'List my passwordless credentials',
      description: 'Returns the calling user\'s enrolled credentials (owner-scoped). Never returns another user\'s credentials. Portal session OR user-delegated merchant OAuth Bearer (dualAuth).',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });
    try {
      return { credentials: await listCredentials(fastify.db, sub) };
    } catch (err) { return replyError(reply, err); }
  });

  fastify.post('/enroll/:credentialId/rotate', {
    config: { dualAuth: true },
    schema: {
      tags: ['auth:enrollment'],
      summary: 'Rotate a passwordless credential',
      description: 'Registers a replacement key (validates possession) then revokes the old credential. Owner-scoped. Portal session OR user-delegated merchant OAuth Bearer (dualAuth).',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['credentialId'], properties: { credentialId: { type: 'string' } } },
      body: registerBody,
    },
  }, async (request, reply) => {
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });
    const { credentialId } = request.params as { credentialId: string };
    try {
      return await rotateCredential(fastify.db, sub, credentialId, request.body as RegisterCredentialInput);
    } catch (err) { return replyError(reply, err); }
  });

  fastify.delete('/enroll/:credentialId', {
    config: { dualAuth: true },
    schema: {
      tags: ['auth:enrollment'],
      summary: 'Revoke a passwordless credential',
      description: 'Revokes an enrolled credential (forces re-enroll). Owner-scoped (a foreign credentialId 404s). Portal session OR user-delegated merchant OAuth Bearer (dualAuth).',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['credentialId'], properties: { credentialId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const sub = getSubFromRequest(request);
    if (!sub) return reply.status(401).send({ error: 'Unauthorized' });
    const { credentialId } = request.params as { credentialId: string };
    try {
      await revokeCredential(fastify.db, sub, credentialId);
      return { revoked: true, credentialId };
    } catch (err) { return replyError(reply, err); }
  });
}
