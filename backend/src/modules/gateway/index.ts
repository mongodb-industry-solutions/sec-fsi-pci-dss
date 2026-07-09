// BIAN SD-89 + SD-64 + SD-65 + SD-57 + SD-66 + SD-54: PSP Payment Processing Module
// Registers controller groups under /api/v1:
//   /merchants              → merchant.controller              (SD-89: Merchant Relations)
//   /gateway/payments       → payment.controller               (SD-64: Payment Order + SD-65: Execution)
//   /gateway/tokens         → token.controller                 (SD-57: Card Etoken / Token Vault)
//   /checkout               → checkout.controller              (SD-64: Redirect Checkout sessions)
//   /payment/links          → paymentLink.controller           (SD-64: Shareable Payment Links)
//   /accounts               → payoutAccount.controller         (SD-66: Payout Account Arrangement)
//   /executions             → paymentExecution.controller      (SD-65: Payment Execution Procedure)
//   /beneficiaries          → beneficiary.controller           (SD-54: Counterparty Admin — dual-auth: staff JWT + merchant OAuth)

import { FastifyInstance } from 'fastify';
import { merchantController }             from './controllers/merchant.controller';
import { paymentController }              from './controllers/payment.controller';
import { tokenController }                from './controllers/token.controller';
import { checkoutController }             from './controllers/checkout.controller';
import { paymentLinkController }          from './controllers/paymentLink.controller';
import { payoutAccountController }        from './controllers/payoutAccount.controller';
import { paymentExecutionController }     from './controllers/paymentExecution.controller';
import { beneficiaryController }          from './controllers/beneficiary.controller';
import { transferController }             from './controllers/transfer.controller';

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
  await fastify.register(paymentLinkController, { prefix: '/payment/links' });

  // SD-66: Payout Account Arrangement  (v17)
  await fastify.register(payoutAccountController,       { prefix: '/accounts' });

  // SD-65: Payment Execution Procedure  (v17)
  await fastify.register(paymentExecutionController,    { prefix: '/executions' });

  // SD-54: Counterparty Admin — dual-auth capability surface (v23). One home for beneficiaries:
  // first-party staff/customer (session JWT + RBAC) AND merchant OAuth on-behalf-of (scope + subject
  // binding). No separate /merchant/* tree; auth is a cross-cutting concern, not a forked API.
  await fastify.register(beneficiaryController,         { prefix: '/beneficiaries' });

  // SD-65 + SD-66: Bank transfers (ACH/SEPA/SWIFT rail engine)  (v17.1)
  await fastify.register(transferController,            { prefix: '/gateway/transfers' });
}
