import { FastifyInstance } from 'fastify';
import { customerAgreementController } from './controllers/customerAgreement.controller';
import { paymentCardController }        from './controllers/paymentCard.controller';

export async function customerModule(fastify: FastifyInstance) {
  // SD-53: customer agreement search  -  /api/v1/customer?email=...
  await fastify.register(customerAgreementController, { prefix: '/customer' });
  // SD-88: payment cards as customer sub-resource  -  /api/v1/customer/:customerId/cards
  await fastify.register(paymentCardController,        { prefix: '/customer' });
}
