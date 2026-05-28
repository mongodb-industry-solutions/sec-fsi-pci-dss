import { FastifyInstance } from 'fastify';
import {
  createTransaction,
  getTransactionById,
  getTransactionsByCardToken,
} from '../services/cardTransaction.service';

export async function cardTransactionController(fastify: FastifyInstance) {
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      cardToken: string;
      accountReference: string;
      amount: number;
      currency: string;
      merchantName: string;
      merchantCategoryCode: string;
      transactionChannel: string;
      maskedPanDisplay: string;
      gatewayPayload: object;
    };

    if (!body.cardToken || !body.accountReference || body.amount == null) {
      return reply.status(400).send({ error: 'cardToken, accountReference, and amount are required' });
    }

    const result = await createTransaction(fastify.db, body);
    return reply.status(201).send(result);
  });

  fastify.get('/', async (request, reply) => {
    const { cardToken } = request.query as { cardToken?: string };
    if (!cardToken) {
      return reply.status(400).send({ error: 'cardToken query parameter is required' });
    }
    const result = await getTransactionsByCardToken(fastify.db, cardToken);
    return reply.send(result);
  });

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const txn = await getTransactionById(fastify.db, id);
    if (!txn) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send(txn);
  });
}
