import { FastifyInstance } from 'fastify';
import { authController } from './controllers/auth.controller';
import { aclController } from './controllers/acl.controller';
import { rolesController } from './controllers/roles.controller';
import { usersController } from './controllers/users.controller';

export async function identityModule(fastify: FastifyInstance) {
  await fastify.register(authController, { prefix: '/auth' });
  await fastify.register(aclController, { prefix: '/acl' });   // ADR-030: GET /api/v1/acl/effective
  await fastify.register(rolesController, { prefix: '/roles' }); // ADR-030: RBAC roles CRUD
  await fastify.register(usersController, { prefix: '/users' }); // ADR-030: local user CRUD
}
