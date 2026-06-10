// BIAN SD-89 + SD-64 + SD-65 + SD-57: Payment Gateway Module
// Registers controller groups under /api/v1:
//   /merchants              → merchant.controller       (SD-89: Merchant Relations)
//   /gateway/payments       → payment.controller        (SD-64: Payment Order + SD-65: Execution)
//   /gateway/tokens         → token.controller          (SD-57: Card Etoken / Token Vault)
//   /checkout               → checkout.controller       (SD-64: Redirect Checkout sessions)
//   /payment-links          → paymentLink.controller    (SD-64: Shareable Payment Links)

import { FastifyInstance } from 'fastify';
import { merchantController }     from './controllers/merchant.controller';
import { paymentController }      from './controllers/payment.controller';
import { tokenController }        from './controllers/token.controller';
import { checkoutController }     from './controllers/checkout.controller';
import { paymentLinkController }  from './controllers/paymentLink.controller';

export async function gatewayModule(fastify: FastifyInstance) {
  // SD-89: Merchant Relations  -  top-level resource
  await fastify.register(merchantController, { prefix: '/merchants' });

  // SD-64 + SD-65: Payment Order + Execution  -  namespaced under /gateway/
  await fastify.register(paymentController,  { prefix: '/gateway/payments' });

  // SD-57: Card Etoken  -  namespaced under /gateway/
  await fastify.register(tokenController,    { prefix: '/gateway/tokens' });

  // SD-64: Redirect Checkout sessions (Method A)
  await fastify.register(checkoutController,    { prefix: '/checkout' });

  // SD-64: Shareable Payment Links (Method B)
  await fastify.register(paymentLinkController, { prefix: '/payment-links' });
}
