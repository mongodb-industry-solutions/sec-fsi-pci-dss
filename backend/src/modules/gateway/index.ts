// BIAN SD-89 + SD-64 + SD-65 + SD-57: Payment Gateway Module
// Registers three controller groups under /api/v1:
//   /merchants              → merchant.controller  (SD-89: Merchant Relations)
//   /gateway/payments       → payment.controller   (SD-64: Payment Order + SD-65: Execution)
//   /gateway/tokens         → token.controller     (SD-57: Card Etoken / Token Vault)

import { FastifyInstance } from 'fastify';
import { merchantController } from './controllers/merchant.controller';
import { paymentController }  from './controllers/payment.controller';
import { tokenController }    from './controllers/token.controller';

export async function gatewayModule(fastify: FastifyInstance) {
  // SD-89: Merchant Relations  -  top-level resource (merchants have identity independent of payments)
  await fastify.register(merchantController, { prefix: '/merchants' });

  // SD-64 + SD-65: Payment Order + Execution  -  namespaced under /gateway/
  await fastify.register(paymentController,  { prefix: '/gateway/payments' });

  // SD-57: Card Etoken  -  namespaced under /gateway/
  await fastify.register(tokenController,    { prefix: '/gateway/tokens' });
}
