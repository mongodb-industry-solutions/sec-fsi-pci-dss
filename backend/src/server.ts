import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import corsPlugin from './plugins/cors';
import mongodbPlugin from './plugins/mongodb';
import { authMiddleware } from './middleware/auth';
import { authController } from './controllers/auth.controller';
import { cardTransactionController } from './controllers/cardTransaction.controller';
import { customerAgreementController } from './controllers/customerAgreement.controller';
import { paymentCardController } from './controllers/paymentCard.controller';
import { fraudDiagnosisController } from './controllers/fraudDiagnosis.controller';
import { demoController } from './controllers/demo.controller';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });

  await fastify.register(corsPlugin);
  await fastify.register(mongodbPlugin);

  fastify.addHook('preHandler', authMiddleware);

  // Health (public)
  fastify.get('/health', async (_request, reply) => {
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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
