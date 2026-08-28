import { FastifyInstance } from 'fastify';

// SCIM 2.0 in and out, extended to agents, applications and service identities. A provisioning event
// creates a principal; it never activates one.
export async function provisioningModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}
