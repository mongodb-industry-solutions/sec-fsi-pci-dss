import { FastifyInstance } from 'fastify';
import { cardTransactionController } from './controllers/cardTransaction.controller';

export async function transactionsModule(fastify: FastifyInstance) {
  // card transaction event log  -  /api/v1/transactions
  await fastify.register(cardTransactionController, { prefix: '/transactions' });
}
