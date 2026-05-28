import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (two levels up from backend/src/).
// Works regardless of CWD — whether called via `npm run dev` from backend/
// or via `npm run dev:backend` from the workspace root.
dotenv.config({ path: resolve(__dirname, '../../.env') });
import Fastify, { FastifyInstance } from 'fastify';
import corsPlugin from './plugins/cors';
import mongodbPlugin from './plugins/mongodb';
import { swaggerPlugin } from './plugins/swagger';
import { authMiddleware } from './middleware/auth';
import { authController } from './controllers/auth.controller';
import { cardTransactionController } from './controllers/cardTransaction.controller';
import { customerAgreementController } from './controllers/customerAgreement.controller';
import { paymentCardController } from './controllers/paymentCard.controller';
import { fraudDiagnosisController } from './controllers/fraudDiagnosis.controller';
import { demoController } from './controllers/demo.controller';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: true,
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
  // This runs after auth so unauthenticated requests still get 401, not 503.
  fastify.addHook('preHandler', async (_request, reply) => {
    if (fastify.dbError !== null && _request.url.startsWith('/api/')) {
      return reply.status(503).send({
        error: 'Service unavailable',
        detail: fastify.dbError,
      });
    }
  });

  // Root redirect → /doc
  fastify.get('/', {
    schema: {
      tags: ['health'],
      summary: 'Redirect to Swagger UI',
      description: 'Redirects to `/doc` (Swagger UI).',
      response: {
        302: { type: 'null', description: 'Redirect to /doc' },
      },
    },
  }, async (_request, reply) => {
    return reply.redirect('/doc');
  });

  // Health check; always responds, even when MongoDB is unreachable
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Health check',
      description: `Returns the API and Atlas connectivity status.
Does not require authentication. Responds even when the database is unreachable;
check \`atlas\` and \`error\` fields to detect a degraded state.`,
      response: {
        200: {
          description: 'Healthy: Atlas reachable',
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] },
            atlas: { type: 'string', enum: ['connected'] },
            kmsProvider: { type: 'string', enum: ['aws', 'local'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        503: {
          description: 'Degraded: Atlas unreachable or connection failed at startup',
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['error'] },
            atlas: { type: 'string', enum: ['disconnected'] },
            error: { type: 'string', description: 'Error summary (no credentials)' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const timestamp = new Date().toISOString();

    // Connection failed at startup; skip ping, report stored error
    if (fastify.dbError !== null) {
      return reply.status(503).send({
        status: 'error',
        atlas: 'disconnected',
        error: fastify.dbError,
        timestamp,
      });
    }

    // Live ping to verify the connection is still healthy
    try {
      await fastify.db.command({ ping: 1 });
      return reply.send({
        status: 'ok',
        atlas: 'connected',
        kmsProvider: process.env.KMS_PROVIDER ?? 'aws',
        timestamp,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'ping failed';
      return reply.status(503).send({
        status: 'error',
        atlas: 'disconnected',
        error: reason,
        timestamp,
      });
    }
  });

  // API routes
  await fastify.register(authController, { prefix: '/api/v1/auth' });
  await fastify.register(cardTransactionController, { prefix: '/api/v1/card-transactions' });
  await fastify.register(customerAgreementController, { prefix: '/api/v1/customer-agreements' });
  await fastify.register(paymentCardController, { prefix: '/api/v1/payment-cards' });
  await fastify.register(fraudDiagnosisController, { prefix: '/api/v1/fraud-diagnosis-cases' });

  if (process.env.NODE_ENV !== 'production') {
    await fastify.register(demoController, { prefix: '/api/v1/demo' });
  }

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
