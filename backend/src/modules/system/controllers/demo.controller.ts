import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';
import { getRawClient } from '../../../vendors/encryption/rawClient';
import { getDemoUsers } from '../../identity/services/auth.service';

// Mounted at /system → /api/v1/system
// - GET /api/v1/system/health       public, always available (bypasses DB guard)
// - GET /api/v1/system/raw/:col/:id JWT required, non-production only
export async function demoController(fastify: FastifyInstance) {

  // GET /api/v1/system/health
  fastify.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'API and Atlas health check',
      description: `Returns the API server status and MongoDB Atlas connectivity.
**Public — no JWT required.** Responds even when Atlas is unreachable; check the \`atlas\` field.`,
      response: {
        200: {
          description: 'Healthy: Atlas reachable',
          type: 'object',
          properties: {
            status:      { type: 'string', enum: ['ok'] },
            atlas:       { type: 'string', enum: ['connected'] },
            kmsProvider: { type: 'string', enum: ['aws', 'local'] },
            timestamp:   { type: 'string', format: 'date-time' },
          },
        },
        503: {
          description: 'Degraded: Atlas unreachable',
          type: 'object',
          properties: {
            status:    { type: 'string', enum: ['error'] },
            atlas:     { type: 'string', enum: ['disconnected'] },
            error:     { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const timestamp = new Date().toISOString();

    if ((fastify as FastifyInstance & { dbError?: string | null }).dbError) {
      return reply.status(503).send({
        status: 'error',
        atlas: 'disconnected',
        error: (fastify as FastifyInstance & { dbError?: string | null }).dbError,
        timestamp,
      });
    }

    try {
      await (fastify as FastifyInstance & { db?: { command: (cmd: object) => Promise<unknown> } }).db?.command({ ping: 1 });
      return reply.send({ status: 'ok', atlas: 'connected', kmsProvider: process.env.KMS_PROVIDER ?? 'aws', timestamp });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'ping failed';
      return reply.status(503).send({ status: 'error', atlas: 'disconnected', error: reason, timestamp });
    }
  });

  // GET /api/v1/system/users
  fastify.get('/users', {
    schema: {
      tags: ['system'],
      summary: 'List demo users for quick login (max 5)',
      description: `Returns up to 5 active pre-seeded demo user accounts for the local authentication domain.
**Public — no JWT required.** Intended for the login UI to populate the user selector. Passwords are never returned.`,
      response: {
        200: {
          description: 'List of available demo users (max 5).',
          type: 'object',
          properties: {
            users: {
              type: 'array',
              maxItems: 5,
              description: 'Active demo accounts for the local domain.',
              items: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', description: 'Login email; submit to POST /api/v1/auth/login.' },
                  name: { type: 'string', description: 'Display name.' },
                  role: {
                    type: 'string',
                    enum: ['customer', 'level1_analyst', 'level2_investigator', 'security_auditor'],
                    description: 'Role encoded in the JWT on login.',
                  },
                },
              },
            },
          },
        },
        500: { $ref: 'Error#' },
      },
    },
  }, async (_request, reply) => {
    try {
      const db = (fastify as FastifyInstance & { db?: Db }).db as Db;
      const users = await getDemoUsers(db);
      return reply.send({ users: users.slice(0, 5) });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to load demo users' });
    }
  });

  // GET /api/v1/system/raw/:collection/:id
  fastify.get('/raw/:collection/:id', {
    schema: {
      tags: ['system'],
      summary: 'Raw (undecrypted) document from Atlas',
      description: `**Non-production only — blocked in production (403).** Returns the MongoDB document exactly as stored on Atlas, bypassing QE auto-decryption.

QE-protected fields appear as BSON binary ciphertext — this is the core of the **"What does Atlas see?"** demo step.

**JWT required.** The plain \`MongoClient\` (no \`autoEncryption\`) is used, so ciphertext is returned as-is.`,
      'x-internal': true,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['collection', 'id'],
        properties: {
          collection: {
            type: 'string',
            enum: [
              'cardTransaction', 'cardTransactionSensitive',
              'customerAgreement', 'customerAgreementSensitive',
              'paymentCard', 'partyAuthentication', 'fraudDiagnosisCase',
            ],
            description: 'Collection name (allowed list enforced server-side)',
          },
          id: { type: 'string', description: 'Primary key UUID (*InstanceReference)' },
        },
      },
      response: {
        200: {
          description: 'Raw document (QE fields appear as binary ciphertext)',
          type: 'object',
          properties: {
            collection: { type: 'string' },
            document: { type: 'object', additionalProperties: true },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        403: { description: 'Blocked in production.', $ref: 'Error#' },
        404: { $ref: 'Error#' },
        500: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Not available in production' });
    }

    const { collection, id } = request.params as { collection: string; id: string };

    const allowedCollections = new Set([
      'cardTransaction', 'cardTransactionSensitive',
      'customerAgreement', 'customerAgreementSensitive',
      'paymentCard', 'partyAuthentication', 'fraudDiagnosisCase',
    ]);

    if (!allowedCollections.has(collection)) {
      return reply.status(400).send({ error: 'Unknown collection' });
    }

    try {
      const rawClient = await getRawClient();
      const db = rawClient.db(process.env.MONGODB_DB_NAME!);
      const doc = await db.collection(collection).findOne({
        $or: [
          { cardTransactionInstanceReference: id },
          { customerAgreementInstanceReference: id },
          { paymentCardInstanceReference: id },
          { fraudDiagnosisInstanceReference: id },
          { partyAuthenticationInstanceReference: id },
        ],
      });

      if (!doc) return reply.status(404).send({ error: 'Document not found' });
      return reply.send({ collection, document: doc });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch raw document' });
    }
  });
}
