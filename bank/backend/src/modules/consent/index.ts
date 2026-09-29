import { FastifyInstance } from 'fastify';
import { consentController } from './controllers/consent.controller';

// Consent, at /v1 like the rest of the standard surface. It is registered before the AIS module for the
// same reason the token endpoint is: nothing else here answers with data without a consent.
export async function consentModule(fastify: FastifyInstance) {
  await fastify.register(consentController, { prefix: '/v1' });
}
