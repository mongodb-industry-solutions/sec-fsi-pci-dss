import 'dotenv/config';
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
  const fastify = Fastify({ logger: true });

  // Swagger must be registered before routes so schemas are captured in the spec
  await fastify.register(swaggerPlugin);

  await fastify.register(corsPlugin);
  await fastify.register(mongodbPlugin);

  fastify.addHook('preHandler', authMiddleware);

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

  // Health (public)
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Health check',
      description: 'Returns the API and Atlas connectivity status. Does not require authentication.',
      response: {
        200: {
          description: 'Healthy',
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] },
            atlas: { type: 'string', enum: ['connected'] },
            kmsProvider: { type: 'string', enum: ['aws', 'local'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        503: {
          description: 'Atlas unreachable',
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['error'] },
            atlas: { type: 'string', enum: ['disconnected'] },
          },
        },
      },
    },
  }, async (_request, reply) => {
    try {
      await fastify.db.command({ ping: 1 });
      return reply.send({
        status: 'ok',
        atlas: 'connected',
        kmsProvider: process.env.KMS_PROVIDER ?? 'aws',
        timestamp: new Date().toISOString(),
      });
    } catch {
      return reply.status(503).send({ status: 'error', atlas: 'disconnected' });
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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
