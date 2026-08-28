import { FastifyInstance } from 'fastify';

// The decision point: resource servers declare their enforcement points, GIAM grants them through
// roles, policies and relationships. The application never stores an assignment.
export async function authorizationModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}
