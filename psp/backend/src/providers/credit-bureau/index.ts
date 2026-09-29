import { FastifyInstance } from 'fastify';
import { creditBureauController } from './controllers/creditBureau.controller';

export async function creditBureauModule(fastify: FastifyInstance) {
  await fastify.register(creditBureauController, { prefix: '/modules/credit-bureau' });
}
