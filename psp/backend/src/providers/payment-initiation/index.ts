import { FastifyInstance } from 'fastify';
import { paymentInitiationController } from './controllers/paymentInitiation.controller';

export async function paymentInitiationModule(fastify: FastifyInstance) {
  await fastify.register(paymentInitiationController, { prefix: '/modules/payment-initiation' });
}
