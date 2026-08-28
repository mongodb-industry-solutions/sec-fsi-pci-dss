import { FastifyInstance } from 'fastify';

// Security events and the streams that deliver them. Identity evidence only: a consumer's business
// action outcome belongs to the consumer, and recording it here would duplicate two sources of truth.
export async function auditModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}
