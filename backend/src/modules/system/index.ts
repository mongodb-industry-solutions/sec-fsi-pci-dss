import { FastifyInstance } from 'fastify';
import { demoController } from './controllers/demo.controller';
import { servicesController } from './controllers/services.controller';

// v28: the open (no-JWT) simulator endpoints were removed. The simulator frontend now authenticates
// as the selected demo persona and calls the real authenticated endpoints (checkout, payment links,
// transactions), so it behaves identically in local and production with no open attack surface.
export async function systemModule(fastify: FastifyInstance) {
  await fastify.register(demoController, { prefix: '/system' });
  // v37: platform service list, including the bank as a monitored service.
  await fastify.register(servicesController, { prefix: '/system' });
}
