import { FastifyInstance } from 'fastify';
import { getByEmail, getByPhone, getByAccountRef } from '../services/customerAgreement.service';

export async function customerAgreementController(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    const { email, phone, accountRef } = request.query as {
      email?: string;
      phone?: string;
      accountRef?: string;
    };

    if (email) {
      const result = await getByEmail(fastify.db, email);
      if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
      return reply.send(result);
    }

    if (phone) {
      const result = await getByPhone(fastify.db, phone);
      if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
      return reply.send(result);
    }

    if (accountRef) {
      const result = await getByAccountRef(fastify.db, accountRef);
      if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
      return reply.send(result);
    }

    return reply.status(400).send({ error: 'Provide email, phone, or accountRef query parameter' });
  });
}
