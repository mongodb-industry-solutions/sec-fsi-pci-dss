import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (two levels up from backend/src/).
// Works regardless of CWD  -  whether called via `npm run dev` from backend/
// or via `npm run dev:backend` from the workspace root.
dotenv.config({ path: resolve(__dirname, '../../.env') });
import Fastify, { FastifyInstance } from 'fastify';
import corsPlugin from './plugins/cors';
import mongodbPlugin from './plugins/mongodb';
import { swaggerPlugin } from './plugins/swagger';
import { authMiddleware } from './vendors/middleware/auth';
import { appendLog }          from './shared/logBuffer';
import { identityModule }     from './modules/identity';
import { customerModule }     from './modules/customer';
import { transactionsModule } from './modules/transactions';
import { fraudModule }        from './modules/fraud';
import { gatewayModule }      from './modules/gateway';
import { systemModule }       from './modules/system';
import { adminModule }        from './modules/admin';
import { integrationsModule } from './modules/integrations';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: true,
    pluginTimeout: 60000,
    ajv: {
      customOptions: {
        // Allow OpenAPI keywords that are not part of JSON Schema draft-07.
        // AJV runs in strict mode by default in Fastify 4; without this it
        // rejects 'example' and other OpenAPI annotations in route schemas.
        keywords: ['example'],
      },
    },
  });

  // Shared schemas registered on the root scope so all controllers can resolve
  // $ref references. Must come before any plugin or route registration.
  fastify.addSchema({ $id: 'Error', type: 'object', properties: { error: { type: 'string' } }, required: ['error'] });
  fastify.addSchema({ $id: 'MonetaryAmount', type: 'object', properties: { amount: { type: 'number' }, currency: { type: 'string' } }, required: ['amount', 'currency'] });
  fastify.addSchema({ $id: 'TransactionSnapshot', type: 'object', properties: { cardTransactionAmount: { $ref: 'MonetaryAmount#' }, cardTransactionMerchantName: { type: 'string' }, cardTransactionDateTime: { type: 'string', format: 'date-time' }, cardTransactionStatus: { type: 'string' }, cardTransactionMaskedPanDisplay: { type: 'string' } }, required: ['cardTransactionAmount', 'cardTransactionMerchantName', 'cardTransactionDateTime', 'cardTransactionStatus', 'cardTransactionMaskedPanDisplay'] });
  fastify.addSchema({ $id: 'FraudDiagnosisAssessment', type: 'object', properties: { riskIndicators: { type: 'array', items: { type: 'string' } }, fraudDiagnosisScore: { type: 'number' }, fraudDiagnosisConclusion: { type: 'string' } }, required: ['riskIndicators'] });

  // Swagger must be registered before routes so schemas are captured in the spec
  await fastify.register(swaggerPlugin);

  await fastify.register(corsPlugin);

  // MongoDB plugin is fault-tolerant: if connection fails the server still starts.
  // fastify.dbError is set to a non-null string on failure (credentials stripped).
  await fastify.register(mongodbPlugin);

  // Auth: skip JWT check for public routes and Swagger UI
  fastify.addHook('preHandler', authMiddleware);

  // DB availability guard: return 503 for all /api/* routes when the DB is down.
  // Excludes /api/v1/system/health so it can report degraded status even when Atlas is unreachable.
  // This runs after auth so unauthenticated requests still get 401, not 503.
  fastify.addHook('preHandler', async (_request, reply) => {
    const url = _request.url;
    const isHealthCheck = url.startsWith('/api/v1/system/health');
    const isAdminRoute = url.startsWith('/api/v1/admin');
    if (fastify.dbError !== null && url.startsWith('/api/') && !isHealthCheck && !isAdminRoute) {
      return reply.status(503).send({
        error: 'Service unavailable',
        detail: fastify.dbError,
      });
    }
  });

  // Populate the admin log buffer with request/response summaries
  fastify.addHook('onResponse', (request, reply, done) => {
    const line = `[${new Date().toISOString()}] ${request.method} ${request.url} -> ${reply.statusCode}`;
    appendLog(line);
    done();
  });

  // Root redirect -> /doc
  fastify.get('/', {
    schema: {
      tags: ['system'],
      summary: 'Redirect to Swagger UI',
      description: 'Redirects to `/doc` (Swagger UI).',
      response: { 302: { type: 'null', description: 'Redirect to /doc' } },
    },
  }, async (_request, reply) => reply.redirect('/doc'));

  // API routes  -  each module registers its own routes internally
  await fastify.register(identityModule,     { prefix: '/api/v1' });
  await fastify.register(customerModule,     { prefix: '/api/v1' });
  await fastify.register(transactionsModule, { prefix: '/api/v1' });
  await fastify.register(fraudModule,        { prefix: '/api/v1' });
  await fastify.register(gatewayModule,      { prefix: '/api/v1' });
  // system module always registered: /api/v1/system/health is available in all envs
  // /api/v1/system/raw returns 403 in production (enforced inside the controller)
  await fastify.register(systemModule,       { prefix: '/api/v1' });
  await fastify.register(adminModule,        { prefix: '/api/v1' });
  await fastify.register(integrationsModule, { prefix: '/api/v1' });

  return fastify;
}

async function start() {
  const app = await buildApp();
  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  const host = process.env.API_HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`Backend listening on http://${host}:${port}`);
    console.log(`Swagger UI: http://${host}:${port}/doc`);

    if (app.dbError !== null) {
      console.warn(`[mongodb] Running in degraded mode: ${app.dbError}`);
      console.warn('[mongodb] API routes will return 503 until the database becomes reachable.');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
