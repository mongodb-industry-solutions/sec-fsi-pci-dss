/**
 * Key Management endpoints for manager / system_admin roles (Phase C, ADR-036)
 * Routes: GET /keys, POST /keys/generate, POST /keys/rotate, POST /keys/upload, GET /keys/:keyId/public.pem
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Db } from 'mongodb';
import {
  generateAndActivateKey,
  rotateKey,
  revokeKey,
  uploadKey,
  getPublicPemByKid,
} from '../services/oidcKeys.service';
import { PARTY_AUTHENTICATION_KEY_COLLECTION, PartyAuthenticationKeyRecord } from '../models/partyAuthenticationKey.model';

function requireManagerRole(req: FastifyRequest, reply: FastifyReply): boolean {
  const user = (req as any).user as { role?: string } | undefined;
  if (!user?.role || !['manager', 'system_admin'].includes(user.role)) {
    reply.status(403).send({ error: 'Forbidden', message: 'manager or system_admin role required' });
    return false;
  }
  return true;
}

export async function keyManagementController(fastify: FastifyInstance) {
  const db = (): Db => (fastify as any).db as Db;

  // GET /api/v1/auth/keys: list all keys (no private material)
  fastify.get('/keys', {
    schema: {
      tags: ['auth:kms'],
      summary: 'List RSA Signing Keys',
      description: 'Lists all OAuth RS256 signing keys with status. Returns public key metadata only, no private key material. Requires manager or system_admin role.',
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManagerRole(req, reply)) return;
    const keys = await db()
      .collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION)
      .find({}, { projection: { publicKeyPem: 0 } })
      .sort({ keyCreatedDateTime: -1 })
      .toArray();
    return { keys };
  });

  // POST /api/v1/auth/keys/generate: generate new keypair
  fastify.post('/keys/generate', {
    schema: {
      tags: ['auth:kms'],
      summary: 'Generate New RSA-2048 Keypair',
      description: 'Generates a new RSA-2048 keypair, registers the public key in Atlas, and sets it as active. The current active key is deprecated (remains valid during grace period). Requires manager or system_admin role.',
      body: {
        type: 'object',
        properties: { label: { type: 'string' } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManagerRole(req, reply)) return;
    const user = (req as any).user as { sub?: string };
    const result = await generateAndActivateKey(db(), user?.sub);
    return { kid: result.kid, message: 'New keypair generated. Old active key deprecated.' };
  });

  // POST /api/v1/auth/keys/rotate: explicit rotation (alias for generate)
  fastify.post('/keys/rotate', {
    schema: {
      tags: ['auth:kms'],
      summary: 'Rotate RSA Signing Key',
      description: 'Generates a new active key and deprecates the current one. During the grace period (default 24h), both keys are exposed in the JWKS endpoint so existing tokens remain valid. Requires manager or system_admin role.',
      body: {
        type: 'object',
        properties: { gracePeriodHours: { type: 'number', default: 24 } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManagerRole(req, reply)) return;
    const body = req.body as { gracePeriodHours?: number } | undefined;
    const user = (req as any).user as { sub?: string };
    const result = await rotateKey(db(), body?.gracePeriodHours ?? 24, user?.sub);
    return { kid: result.kid, message: 'Key rotated. Previous key deprecated.' };
  });

  // POST /api/v1/auth/keys/upload: upload external PEM pair
  fastify.post('/keys/upload', {
    schema: {
      tags: ['auth:kms'],
      summary: 'Upload External RSA Keypair',
      description: 'Uploads an externally generated PEM keypair. The private key is used to update the signing provider; only the public key is stored in Atlas. Requires manager or system_admin role.',
      body: {
        type: 'object',
        required: ['privateKeyPem', 'publicKeyPem'],
        properties: {
          privateKeyPem: { type: 'string' },
          publicKeyPem: { type: 'string' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManagerRole(req, reply)) return;
    const body = req.body as { privateKeyPem: string; publicKeyPem: string };
    const user = (req as any).user as { sub?: string };
    try {
      const result = await uploadKey(db(), body.privateKeyPem, body.publicKeyPem, user?.sub);
      return { kid: result.kid, message: 'Key uploaded and activated.' };
    } catch (err: any) {
      reply.status(400).send({ error: 'invalid_key', message: err.message });
    }
  });

  // POST /api/v1/auth/keys/:keyId/revoke, revoke deprecated key
  fastify.post('/keys/:keyId/revoke', {
    schema: {
      tags: ['auth:kms'],
      summary: 'Revoke a Deprecated Key',
      description: 'Marks a deprecated key as revoked. It is removed from the JWKS endpoint and tokens signed with it become invalid. Cannot revoke the currently active key, rotate first. Requires manager or system_admin role.',
      params: {
        type: 'object',
        required: ['keyId'],
        properties: { keyId: { type: 'string' } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireManagerRole(req, reply)) return;
    const { keyId } = req.params as { keyId: string };
    try {
      await revokeKey(db(), keyId);
      return { revoked: true, keyId };
    } catch (err: any) {
      reply.status(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  // GET /api/v1/auth/keys/:keyId/public.pem, download public key (no auth, for merchants)
  fastify.get('/keys/:keyId/public.pem', {
    schema: {
      tags: ['auth:kms'],
      summary: 'Download Public Key (PEM)',
      description: 'Returns the public key in PEM format for merchants who prefer to verify tokens client-side. No authentication required, public keys are safe to share.',
      params: {
        type: 'object',
        required: ['keyId'],
        properties: { keyId: { type: 'string' } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { keyId } = req.params as { keyId: string };
    // Served from the key provider (filesystem/KMS): the single source of truth (ADR-036).
    const publicKeyPem = await getPublicPemByKid(keyId);

    if (!publicKeyPem) {
      return reply.status(404).send({ error: 'Key not found or revoked' });
    }

    reply.header('Content-Type', 'application/x-pem-file');
    reply.header('Content-Disposition', `attachment; filename="oauth-public-${keyId}.pem"`);
    return reply.send(publicKeyPem);
  });
}
