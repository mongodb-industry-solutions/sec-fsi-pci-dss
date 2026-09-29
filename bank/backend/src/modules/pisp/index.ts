import { FastifyInstance } from 'fastify';
import { paymentInitiationController } from './controllers/paymentInitiation.controller';
import { periodicPaymentController } from './controllers/periodicPayment.controller';

// Payment initiation, at /v1 with the rest of the standard surface. The payment product is a path
// segment, so the routes are registered under one prefix rather than one per product.
export async function pispModule(fastify: FastifyInstance) {
  await fastify.register(paymentInitiationController, { prefix: '/v1' });
  // Standing orders are their own resource in the standard, so their own controller on the same prefix.
  await fastify.register(periodicPaymentController, { prefix: '/v1' });
}
