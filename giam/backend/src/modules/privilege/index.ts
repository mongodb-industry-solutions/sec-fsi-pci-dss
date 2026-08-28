import { FastifyInstance } from 'fastify';

// Privileged access: an elevation is a time-bound role assignment with a justification and an
// approval, which is auditable and revocable in a way a stateless escalation token is not.
export async function privilegeModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}
