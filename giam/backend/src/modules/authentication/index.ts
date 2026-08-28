import { FastifyInstance } from 'fastify';

// How a principal proves who it is, and the session that results. One pipeline: an employee signing
// in and a microservice presenting a credential differ only in the authentication method they use.
export async function authenticationModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}
