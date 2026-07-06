import { FastifyInstance } from 'fastify';
import { domainController } from './controllers/domain.controller';

// Auth Domains internal Module (no Provider counterpart) — full CRUD over authenticationDomain.
export async function domainModule(fastify: FastifyInstance) {
  await fastify.register(domainController, { prefix: '/modules/domains' });
}
