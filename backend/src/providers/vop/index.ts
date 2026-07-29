import { FastifyInstance } from 'fastify';
import { vopController } from './controllers/vop.controller';

// VoP capability module (internal Verification of Payee engine). Additional to FDS/AML/HRP (v28).
export async function vopModule(fastify: FastifyInstance) {
  await fastify.register(vopController, { prefix: '/modules/vop' });
}
