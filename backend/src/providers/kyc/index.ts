import { FastifyInstance } from 'fastify';
import { kycController } from './controllers/kyc.controller';

export async function kycModule(fastify: FastifyInstance) {
  await fastify.register(kycController, { prefix: '/modules/kyc' });
}
