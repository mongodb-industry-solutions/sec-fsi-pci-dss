import { FastifyInstance } from 'fastify';
import { loginController } from './controllers/login.controller';

// How a principal proves who it is, and the session that results. One pipeline: an employee signing
// in and a microservice presenting a credential differ only in the authentication method they use.
export async function authenticationModule(fastify: FastifyInstance) {
  await fastify.register(loginController);
}
