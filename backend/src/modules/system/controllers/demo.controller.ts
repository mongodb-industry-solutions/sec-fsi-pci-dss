import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';
import { getRawClient } from '../../../vendors/encryption/rawClient';
import { getDemoUsers } from '../../identity/services/auth.service';
import { getDbForRole } from '../../../vendors/encryption/roleClients';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';

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
**Public  -  no JWT required.** Responds even when Atlas is unreachable; check the \`atlas\` field.`,
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
      summary: 'List demo users for quick login',
      description: `Returns active pre-seeded demo user accounts (DB-backed) for the local domain.
**Public  -  no JWT required.** The single, non-hardcoded roster shared by the login picker and the simulator.

Filters (combinable): \`featured=true\`, \`role=customer,merchant_officer\` (comma list), \`q=\`
(name/email substring), \`isMerchant=true\` (only customers who own a merchant). Deterministic order.`,
      querystring: {
        type: 'object',
        properties: {
          featured: { type: 'string', enum: ['true', 'false'], description: 'When "true", only customerAuthenticationDemoFeatured users.' },
          role: { type: 'string', description: 'Comma-separated role filter.' },
          q: { type: 'string', description: 'Case-insensitive substring on name or email.' },
          isMerchant: { type: 'string', enum: ['true', 'false'], description: 'When "true", only customers who own a merchant.' },
        },
      },
      response: {
        200: {
          description: 'List of available demo users.',
          type: 'object',
          properties: {
            users: {
              type: 'array',
              description: 'Active demo accounts matching the filters, in deterministic order.',
              items: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', description: 'Login email; submit to POST /api/v1/auth/login.' },
                  name: { type: 'string', description: 'Display name.' },
                  role: {
                    type: 'string',
                    enum: ['customer', 'level1_analyst', 'level2_investigator', 'security_auditor', 'merchant_officer', 'manager'],
                    description: 'Role encoded in the JWT on login.',
                  },
                  featured: { type: 'boolean', description: 'True if part of the curated demo roster.' },
                  partyRef: { type: 'string', description: 'partyInstanceReference (SD-13).' },
                  merchant: {
                    type: 'object',
                    nullable: true,
                    description: 'Present when this customer owns a merchant (customer + merchant).',
                    properties: {
                      id: { type: 'string', description: 'merchantAgreementInstanceReference.' },
                      name: { type: 'string', description: 'Merchant display name.' },
                      mcc: { type: 'string', nullable: true, description: 'Merchant Category Code (ISO 18245).' },
                    },
                  },
                },
              },
            },
          },
        },
        500: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    try {
      const db = (fastify as FastifyInstance & { db?: Db }).db as Db;
      const { featured, role, q, isMerchant } = request.query as { featured?: string; role?: string; q?: string; isMerchant?: string };
      const users = await getDemoUsers(db, {
        featured: featured === 'true',
        ...(role ? { role: role.split(',').map((r) => r.trim()).filter(Boolean) } : {}),
        ...(q ? { q } : {}),
        ...(isMerchant === 'true' ? { isMerchant: true } : {}),
      });
      return reply.send({ users });
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
      description: `**Non-production only  -  blocked in production (403).** Returns the MongoDB document exactly as stored on Atlas, bypassing QE auto-decryption.

QE-protected fields appear as BSON binary ciphertext  -  this is the core of the **"What does Atlas see?"** demo step.

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
              'party', 'customerAuthenticationAssessment',
              'cardTransactionLog',
              'customerAgreementProcedure',
              'paymentCardManagement', 'fraudDiagnosisCase',
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

    // v2: *Sensitive collections removed - sensitive fields live inline in their parent collection.
    const allowedCollections = new Set([
      'party', 'customerAuthenticationAssessment',
      'cardTransactionLog',
      'customerAgreementProcedure',
      'paymentCardManagement', 'fraudDiagnosisCase',
    ]);

    if (!allowedCollections.has(collection)) {
      return reply.status(400).send({ error: 'Unknown collection' });
    }

    try {
      // If the id for customerAgreementProcedure is not a UUID it may be an account
      // reference string (e.g. "ACC-LF-20240115") stored in legacy fraud cases created
      // before the UUID-resolution fix.  Resolve it to the real UUID via the L1 QE
      // client (which can equality-search the encrypted customerAgreementReference field)
      // before querying the raw client.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let resolvedId = id;
      if (collection === 'customerAgreementProcedure' && !UUID_RE.test(id)) {
        try {
          const l1Db = await getDbForRole('level1_analyst', false);
          const agreementDoc = await l1Db
            .collection<{ customerAgreementInstanceReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
            .findOne({ customerAgreementReference: id } as Record<string, unknown>);
          if (agreementDoc?.customerAgreementInstanceReference) {
            resolvedId = agreementDoc.customerAgreementInstanceReference;
          }
        } catch {
          // Resolution failed - fall through with original id, will 404 gracefully
        }
      }

      const rawClient = await getRawClient();
      const db = rawClient.db(process.env.MONGODB_DB_NAME!);
      const doc = await db.collection(collection).findOne({
        $or: [
          { partyInstanceReference: resolvedId },
          { customerAuthenticationInstanceReference: resolvedId },
          { cardTransactionInstanceReference: resolvedId },
          { customerAgreementInstanceReference: resolvedId },
          { paymentCardInstanceReference: resolvedId },
          { fraudDiagnosisInstanceReference: resolvedId },
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
