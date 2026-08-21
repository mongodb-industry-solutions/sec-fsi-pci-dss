import { FastifyInstance } from 'fastify';
import { creditBureauController } from './controllers/creditBureau.controller';

// The bank as credit bureau for the parties it banks. On the /v1 surface because the PSP calls it, but
// deliberately not Open Banking framed: no standard covers a credit assessment.
export async function creditBureauModule(fastify: FastifyInstance) {
  await fastify.register(creditBureauController, { prefix: '/v1' });
}
