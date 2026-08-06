// + + + + + PSP Payment Processing Module
// Registers controller groups under /api/v1:
//   /merchants              → merchant.controller              (Merchant Relations)
//   /gateway/payments       → payment.controller               (Payment Order + Execution)
//   /gateway/tokens         → token.controller                 (Card Etoken / Token Vault)
//   /checkout               → checkout.controller              (Redirect Checkout sessions)
//   /payment/links          → paymentLink.controller           (Shareable Payment Links)
//   /accounts               → payoutAccount.controller         (Payout Account Arrangement)
//   /executions             → paymentExecution.controller      (Payment Execution Procedure)
//   /beneficiaries          → beneficiary.controller           (Counterparty Admin, dual-auth: staff JWT + merchant OAuth)

import { FastifyInstance } from 'fastify';
import { merchantController }             from './controllers/merchant.controller';
import { merchantKybController }          from './controllers/merchantKyb.controller';
import { paymentController }              from './controllers/payment.controller';
import { tokenController }                from './controllers/token.controller';
import { checkoutController }             from './controllers/checkout.controller';
import { paymentLinkController }          from './controllers/paymentLink.controller';
import { payoutAccountController }        from './controllers/payoutAccount.controller';
import { paymentExecutionController }     from './controllers/paymentExecution.controller';
import { beneficiaryController }          from './controllers/beneficiary.controller';
import { transferController }             from './controllers/transfer.controller';
import { rtpController }                  from './controllers/rtp.controller';
import { qrController }                   from './controllers/qr.controller';
import { config }                         from '../../config';

export async function gatewayModule(fastify: FastifyInstance) {
  // Merchant Relations  -  top-level resource
  await fastify.register(merchantController, { prefix: '/merchants' });
  // v31: KYB administration surface (KYB data correction + beneficial owners + process timeline).
  // Same /merchants prefix (one merchant surface, no forked API). requirePermission-gated per route.
  await fastify.register(merchantKybController, { prefix: '/merchants' });

  // + Payment Order + Execution  -  namespaced under /gateway/
  await fastify.register(paymentController,  { prefix: '/gateway/payments' });

  // Card Etoken  -  namespaced under /gateway/
  await fastify.register(tokenController,    { prefix: '/gateway/tokens' });

  // Redirect Checkout sessions (Method A)
  await fastify.register(checkoutController,    { prefix: '/checkout' });

  // Shareable Payment Links (Method B)
  await fastify.register(paymentLinkController, { prefix: '/payment/links' });

  // Payout Account Arrangement  (v17)
  await fastify.register(payoutAccountController,       { prefix: '/accounts' });

  // Payment Execution Procedure  (v17)
  await fastify.register(paymentExecutionController,    { prefix: '/executions' });

  // Counterparty Admin, dual-auth capability surface (v23). One home for beneficiaries:
  // first-party staff/customer (session JWT + RBAC) AND merchant OAuth on-behalf-of (scope + subject
  // binding). No separate /merchant/* tree; auth is a cross-cutting concern, not a forked API.
  await fastify.register(beneficiaryController,         { prefix: '/beneficiaries' });

  // + Bank transfers (ACH/SEPA/SWIFT rail engine)  (v17.1)
  await fastify.register(transferController,            { prefix: '/gateway/transfers' });

  // Request to Pay (RTP) intent domain + shared QR capability (v28). Gated by config.rtp.enabled.
  if (config.rtp.enabled) {
    await fastify.register(rtpController,               { prefix: '/gateway/rtp' });
    await fastify.register(qrController,                { prefix: '/gateway/qr' });
  }
}
