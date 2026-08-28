import { FastifyInstance } from 'fastify';

// Two different things, kept apart: a grant is a principal consenting to a client's scopes, a
// delegation is a principal authorising an agent to act on their behalf, purpose bound and revocable.
export async function consentModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}
