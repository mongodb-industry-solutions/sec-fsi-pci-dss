import { FastifyInstance } from 'fastify';
import { createCard, getCardsByCustomer } from '../services/paymentCard.service';
import type { PaymentCardManagementControlRecord } from '../models';

export async function paymentCardController(fastify: FastifyInstance) {
  fastify.post('/', async (request, reply) => {
    const body = request.body as {
      customerAgreementInstanceReference: string;
      cardToken: string;
      cardExpirationDate: string;
      maskedPanDisplay: string;
      cardNetwork: PaymentCardManagementControlRecord['cardNetwork'];
      isPreferredCard: boolean;
    };

    if (!body.customerAgreementInstanceReference || !body.cardToken || !body.cardExpirationDate) {
      return reply.status(400).send({
        error: 'customerAgreementInstanceReference, cardToken, and cardExpirationDate are required',
      });
    }

    const result = await createCard(fastify.db, body);
    return reply.status(201).send(result);
  });

  fastify.get('/', async (request, reply) => {
    const { customerRef } = request.query as { customerRef?: string };
    if (!customerRef) {
      return reply.status(400).send({ error: 'customerRef query parameter is required' });
    }
    const result = await getCardsByCustomer(fastify.db, customerRef);
    return reply.send(result);
  });
}
