import { FastifyInstance } from 'fastify';
import { paymentInitiationController } from './controllers/paymentInitiation.controller';

// Payment initiation, at /v1 with the rest of the standard surface. The payment product is a path
// segment, so the routes are registered under one prefix rather than one per product.
export async function pispModule(fastify: FastifyInstance) {
  await fastify.register(paymentInitiationController, { prefix: '/v1' });
}
