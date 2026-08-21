import { FastifyInstance } from 'fastify';
import { authController } from './controllers/auth.controller';
import { aclController } from './controllers/acl.controller';
import { rolesController } from './controllers/roles.controller';
import { usersController } from './controllers/users.controller';
import { oauthController } from './controllers/oauth.controller';
import { tokenIntrospectionController } from './controllers/tokenIntrospection.controller';
import { keyManagementController } from './controllers/keyManagement.controller';
import { consentGrantsController } from './controllers/consentGrants.controller';
import { enrollmentController } from './controllers/enrollment.controller';
import { cibaController } from './controllers/ciba.controller';
import { cibaStubReceiverController } from './controllers/cibaStubReceiver.controller';

export async function identityModule(fastify: FastifyInstance) {
  await fastify.register(authController, { prefix: '/auth' });
  await fastify.register(aclController, { prefix: '/acl' });         // ADR-030: GET /api/v1/acl/effective
  await fastify.register(rolesController, { prefix: '/roles' });     // ADR-030: RBAC roles CRUD
  await fastify.register(usersController, { prefix: '/users' });     // ADR-030: local user CRUD
  // v16: OAuth 2.0 Authorization Server (ADR-033, ADR-034)
  await fastify.register(oauthController, { prefix: '/auth' });      // POST /api/v1/auth/token, etc.
  await fastify.register(tokenIntrospectionController, { prefix: '/auth' }); // POST /api/v1/auth/introspect
  await fastify.register(keyManagementController, { prefix: '/auth' }); // GET/POST /api/v1/auth/keys/*
  await fastify.register(consentGrantsController, { prefix: '/auth' }); // GET/DELETE /api/v1/auth/grants
  // passwordless enrollment (session-gated) + CIBA backchannel auth
  await fastify.register(enrollmentController, { prefix: '/auth' });  // /api/v1/auth/enroll*
  await fastify.register(cibaController, { prefix: '/auth' });        // /api/v1/auth/bc-authorize*
  // demo-only ping/push notification receiver (skipAuth, self-authenticated by Bearer token)
  await fastify.register(cibaStubReceiverController, { prefix: '/auth' }); // /api/v1/auth/ciba/notify
}
