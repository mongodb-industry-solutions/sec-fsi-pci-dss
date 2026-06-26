import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { getRawClient } from '../../../vendors/encryption/rawClient';
import { getDemoUsers } from '../../identity/services/auth.service';
import { getDbForRole } from '../../../vendors/encryption/roleClients';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';

// ── Health check helpers (IETF draft-inadarei-api-health-check) ─────────────

const PKG_VERSION = (() => {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version as string;
  } catch { return '0.0.0'; }
})();

const SERVICE_ID = 'fsi-pci-dss-backend';
const SERVICE_DESC = 'Leafy Pay PSP Platform — Backend API';

type CheckStatus = 'pass' | 'fail' | 'warn';
interface CheckEntry {
  status: CheckStatus;
  componentType: string;
  observedValue?: unknown;
  observedUnit?: string;
  time?: string;
  output?: string;
}

function serverChecks(): Record<string, CheckEntry[]> {
  const cryptPath = process.env.MONGODB_CRYPT_SHARED_LIB_PATH ?? '';
  const cryptExists = cryptPath ? fs.existsSync(cryptPath) : false;
  const mem = process.memoryUsage();
  return {
    'server:uptime': [{
      status: 'pass',
      componentType: 'system',
      observedValue: Math.floor(process.uptime()),
      observedUnit: 's',
    }],
    'server:memory': [{
      status: 'pass',
      componentType: 'system',
      observedValue: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, heapTotalBytes: mem.heapTotal },
    }],
    'server:node': [{
      status: 'pass',
      componentType: 'system',
      observedValue: { version: process.version, platform: os.platform(), arch: os.arch() },
    }],
    'server:env': [{
      status: 'pass',
      componentType: 'system',
      observedValue: process.env.NODE_ENV ?? 'development',
    }],
    'server:cryptSharedLib': [{
      status: cryptPath && cryptExists ? 'pass' : cryptPath ? 'fail' : 'warn',
      componentType: 'system',
      observedValue: { path: cryptPath || null, exists: cryptExists },
      output: !cryptPath ? 'MONGODB_CRYPT_SHARED_LIB_PATH not set' : !cryptExists ? 'File not found' : undefined,
    }],
    'server:kmsProvider': [{
      status: 'pass',
      componentType: 'system',
      observedValue: process.env.KMS_PROVIDER ?? 'local',
    }],
  };
}

function resolveMongoType(modules: string[], host: string): 'Atlas' | 'Enterprise Advanced' | 'Community' {
  const isEnterprise = modules.some((m) => m.toLowerCase() === 'enterprise');
  if (isEnterprise && host.includes('.mongodb.net')) return 'Atlas';
  if (isEnterprise) return 'Enterprise Advanced';
  return 'Community';
}

async function dbChecks(db: Db): Promise<Record<string, CheckEntry[]>> {
  const checks: Record<string, CheckEntry[]> = {};
  try {
    const buildInfo = await db.admin().command({ buildInfo: 1 }) as { version?: string; modules?: string[] };
    const host = (process.env.MONGODB_URI ?? '').replace(/^mongodb(\+srv)?:\/\/[^@]*@/, '').split('/')[0].split('?')[0];
    const mongoType = resolveMongoType(buildInfo.modules ?? [], host);
    checks['db:server'] = [{
      status: 'pass',
      componentType: 'datastore',
      observedValue: {
        host,
        database: process.env.MONGODB_DB_NAME ?? db.databaseName,
        serverVersion: buildInfo.version ?? 'unknown',
        type: mongoType,
        modules: buildInfo.modules ?? [],
      },
    }];
  } catch (err) {
    checks['db:server'] = [{
      status: 'fail',
      componentType: 'datastore',
      output: err instanceof Error ? err.message : 'buildInfo failed',
    }];
  }

  try {
    const cols = await db.listCollections({}, { nameOnly: false }).toArray();
    const collNames = cols
      .filter((c) => !c.name.startsWith('system.'))
      .map((c) => c.name)
      .sort();
    checks['db:collections'] = [{
      status: 'pass',
      componentType: 'datastore',
      observedValue: collNames,
      observedUnit: `${collNames.length} collections`,
    }];
  } catch (err) {
    checks['db:collections'] = [{
      status: 'warn',
      componentType: 'datastore',
      output: err instanceof Error ? err.message : 'listCollections failed',
    }];
  }
  return checks;
}

// Mounted at /system → /api/v1/system
// - GET /api/v1/system/health       public, always available (bypasses DB guard)
// - GET /api/v1/system/raw/:col/:id JWT required, non-production only
export async function demoController(fastify: FastifyInstance) {

  // GET /api/v1/system/health
  fastify.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'Health check (IETF draft format)',
      description: `Returns system health following the IETF Health Check Response Format (draft-inadarei-api-health-check).
**Public — no JWT required.** Use \`?detail=server|db|all\` for extended component checks (heavier; use on-demand only).`,
      querystring: {
        type: 'object',
        properties: {
          detail: { type: 'string', enum: ['server', 'db', 'all'], description: 'Include extended checks for the given component.' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Healthy (status=pass)' },
        503: { type: 'object', additionalProperties: true, description: 'Degraded (status=fail)' },
      },
    },
  }, async (request, reply) => {
    const detail = (request.query as { detail?: string }).detail;
    const now = new Date().toISOString();

    const checks: Record<string, CheckEntry[]> = {};
    let overallStatus: CheckStatus = 'pass';

    // Core connectivity check (always runs — lightweight ping)
    if (fastify.dbError) {
      overallStatus = 'fail';
      checks['mongodb:connectivity'] = [{
        status: 'fail',
        componentType: 'datastore',
        output: fastify.dbError,
        time: now,
      }];
    } else {
      try {
        const t0 = Date.now();
        await fastify.db.command({ ping: 1 });
        checks['mongodb:connectivity'] = [{
          status: 'pass',
          componentType: 'datastore',
          observedValue: Date.now() - t0,
          observedUnit: 'ms',
          time: now,
        }];
      } catch (err) {
        overallStatus = 'fail';
        checks['mongodb:connectivity'] = [{
          status: 'fail',
          componentType: 'datastore',
          output: err instanceof Error ? err.message : 'ping failed',
          time: now,
        }];
      }
    }

    // Extended: server details (no DB cost)
    if (detail === 'server' || detail === 'all') {
      Object.assign(checks, serverChecks());
    }

    // Extended: database details (moderate cost — buildInfo + listCollections)
    if ((detail === 'db' || detail === 'all') && !fastify.dbError) {
      Object.assign(checks, await dbChecks(fastify.db));
    }

    // Derive overall status from ALL check entries (not just the mongo ping).
    // IETF precedence: fail > warn > pass. HTTP 503 only for fail.
    for (const entries of Object.values(checks)) {
      for (const e of entries) {
        if (e.status === 'fail') overallStatus = 'fail';
        else if (e.status === 'warn' && overallStatus === 'pass') overallStatus = 'warn';
      }
    }

    reply.header('Content-Type', 'application/health+json; charset=utf-8');
    const body = {
      status: overallStatus,
      version: PKG_VERSION,
      serviceId: SERVICE_ID,
      description: SERVICE_DESC,
      checks,
    };
    return reply.status(overallStatus === 'fail' ? 503 : 200).send(body);
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
