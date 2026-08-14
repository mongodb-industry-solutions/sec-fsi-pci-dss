import { FastifyInstance } from 'fastify';
import { customerAgreementController } from './controllers/customerAgreement.controller';
import { customerKycController }        from './controllers/customerKyc.controller';
import { paymentCardController }        from './controllers/paymentCard.controller';
import { customerActivityController }   from './controllers/customerActivity.controller';

export async function customerModule(fastify: FastifyInstance) {
  // customer agreement search  -  /api/v1/customer?email=...
  await fastify.register(customerAgreementController, { prefix: '/customer' });
  // v31: KYC administration (list/detail/patch/re-screen/process). requirePermission-gated.
  await fastify.register(customerKycController,       { prefix: '/customer' });
  // payment cards as customer sub-resource  -  /api/v1/customer/:customerId/cards
  await fastify.register(paymentCardController,        { prefix: '/customer' });
  // staff transactions sub-resource  -  /api/v1/customer/:customerId/transactions
  await fastify.register(customerActivityController,   { prefix: '/customer' });
}
