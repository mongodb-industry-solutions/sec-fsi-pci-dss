// BIAN SD-64: Payment Order + SD-65: Payment Execution  -  REST controller
// Routes mounted at /gateway/payments → /api/v1/gateway/payments

import { FastifyInstance } from 'fastify';
import {
  createPaymentOrder,
  confirmPaymentOrder,
  authorizePaymentOrder,
  capturePaymentOrder,
  voidPaymentOrder,
  refundPaymentOrder,
  getPaymentOrder,
} from '../services/paymentOrder.service';
import { validateMerchantToken } from '../../../vendors/middleware/validateMerchantToken';
import { createTransaction, CardIssuerDeclinedError, resolveAccountReferenceForParty } from '../../transaction/services/cardTransaction.service';
import { attributionFromMerchantContext, emitProcessEvent } from '../../provider/services/businessProcessEvent.service';
import { resolvePartyInstanceReference } from '../../identity/services/oauth.service';

const PAYMENT_STATUS_ENUM = [
  'initiated', 'confirmed', 'authorized', 'captured',
  'settled', 'voided', 'refunded', 'failed', 'expired',
];

export async function paymentController(fastify: FastifyInstance) {

  // POST /api/v1/gateway/payments
  // Item 2 (v18): SERVER-TO-SERVER merchant charge. Authenticated with the merchant's OAuth
  // client_credentials token (RS256, scope write:payments) — NOT a user session (HS256) and NOT the
  // user authorization_code token. `skipAuth` bypasses the global HS256 preHandler; validateMerchantToken
  // verifies the machine token in-handler and resolves the acquiring merchant, so the charge is always
  // attributed to that merchant and the commission fee (Item 1) is applied to it. No CHD ever reaches the
  // merchant: the PSP charges a tokenised card (test token vault), never a PAN/CVV.
  fastify.post('/', {
    config: { skipAuth: true },
    schema: {
      tags: ['gateway'],
      summary: 'Create a payment order (SD-64) — server-to-server merchant charge',
      description: `Creates a \`paymentOrder\` (BIAN SD-64) with initial status \`initiated\`.

**Idempotency:** The \`X-Idempotency-Key\` header is **required**. _(v5: duplicate-key detection and 409 enforcement are not yet implemented in this prototype.)_

**Payment lifecycle (SD-64 state machine):**
\`\`\`
initiated → confirmed → authorized → captured → settled
                                 → voided
              → voided
                                              → refunded
\`\`\`

**SD-65 routing:** On \`/authorize\`, the Payment Execution service selects a processor and records the routing decision.

**Fraud evaluation:** Authorization triggers \`shared/services/fraudTrigger\`  -  a \`fraudDiagnosisCase\` is opened automatically if the amount or MCC meets the risk criteria.

**PCI DSS:** No cardholder data is accepted at this endpoint. The payment order references the merchant and customer by UUID; card credentials never pass through the gateway API.

**v5 note:** This prototype returns a stub. Full v5 persists to \`paymentOrder\` with TTL index on \`paymentOrderExpiresAt\`.`,
      security: [{ bearerAuth: [] }],
      headers: {
        type: 'object',
        required: ['x-idempotency-key'],
        properties: {
          'x-idempotency-key': { type: 'string', description: 'Unique key per operation. (v5: duplicate-key enforcement not yet active in prototype.)' },
        },
      },
      body: {
        type: 'object',
        // merchantAgreementInstanceReference is NOT required: the merchant is derived from the
        // client_credentials OAuth token (merchantContext.merchantId). If supplied it must match
        // the authenticated client (enforced in-handler → 403 on mismatch).
        required: ['paymentOrderMerchantReference', 'amount', 'currency'],
        properties: {
          merchantAgreementInstanceReference: { type: 'string', description: 'Optional; must match the authenticated client if provided. Normally derived from the OAuth token.' },
          paymentOrderMerchantReference: { type: 'string', description: "Merchant's own order or cart ID." },
          amount: { type: 'number', description: 'Payment amount in the specified currency.' },
          currency: { type: 'string', description: 'ISO 4217 three-letter currency code.' },
          paymentOrderDescription: { type: 'string', description: 'Optional human-readable description.' },
          actingSubjectReference: { type: 'string', description: 'v18: OAuth subject (SD-91 login id) of the user the merchant app is acting for. Attribution only — the charge stays merchant-authenticated. Enables buyer-side traceability (payment history + operations view).' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            paymentOrderInstanceReference: { type: 'string', description: 'UUID of the created payment order.' },
            paymentOrderReference: { type: 'string', description: 'Human-readable reference (PO-YYYY-NNNNNN).' },
            paymentOrderStatus: { type: 'string', enum: PAYMENT_STATUS_ENUM },
            paymentOrderExpiresAt: { type: 'string', format: 'date-time', description: 'Order auto-expires if not confirmed by this time.' },
            cardTransactionInstanceReference: { type: 'string', description: 'SD-254 card transaction id created for this API payment (for tracking).' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        402: { description: 'Card issuer declined the tokenised charge.', $ref: 'Error#' },
        403: { description: 'Merchant token missing write:payments scope or merchant mismatch.', $ref: 'Error#' },
        409: { description: '(v5-only) Duplicate idempotency key  -  not yet enforced in this prototype.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    // S2S auth: verify the merchant machine token (client_credentials, scope write:payments). On failure
    // validateMerchantToken sends 401/403 and leaves merchantContext undefined → reject (no credential).
    await validateMerchantToken(request, reply, 'write:payments');
    if (!request.merchantContext) return;
    const { merchantId, merchantName } = request.merchantContext;

    const idempotencyKey = (request.headers as Record<string, string>)['x-idempotency-key'];
    if (!idempotencyKey) return reply.status(400).send({ error: 'X-Idempotency-Key header is required' });

    const body = request.body as {
      merchantAgreementInstanceReference?: string;
      paymentOrderMerchantReference: string;
      amount: number;
      currency: string;
      paymentOrderDescription?: string;
      actingSubjectReference?: string;
    };

    if (body.amount == null || !body.currency || !body.paymentOrderMerchantReference) {
      return reply.status(400).send({ error: 'paymentOrderMerchantReference, amount, and currency are required' });
    }
    // The acquiring merchant is bound to the token, never trusted from the body (a merchant cannot charge
    // on behalf of another). If a body reference is present it MUST match the authenticated merchant.
    if (body.merchantAgreementInstanceReference && body.merchantAgreementInstanceReference !== merchantId) {
      return reply.status(403).send({ error: 'access_denied', error_description: 'merchantAgreementInstanceReference does not match the authenticated client' });
    }

    // SD-64: persist the payment order (idempotent on X-Idempotency-Key).
    const order = await createPaymentOrder(fastify.db, {
      merchantAgreementInstanceReference: merchantId,
      paymentOrderMerchantReference: body.paymentOrderMerchantReference,
      amount: body.amount,
      currency: body.currency,
      paymentOrderDescription: body.paymentOrderDescription,
      idempotencyKey,
    });

    // Charge a TOKENISED card server-side (PCI DSS Req 3: no PAN/CVV in the merchant; the PSP holds the
    // token). The card transaction (SD-254) carries the acquiring merchant reference, so completeAuthorized
    // applies the commission fee (Item 1) and the merchant dashboard revenue reflects this API payment.
    const apiChargeToken = process.env.PSP_API_PAYMENT_TEST_TOKEN ?? 'pm_test_espresso_api';
    // v18 attribution: if the merchant forwarded the acting user's subject, resolve it to the payer's
    // party + canonical account so the charge lands in THEIR payment history. Falls back to the merchant
    // account key when no acting user is supplied (pure machine charge).
    const actingPartyReference = body.actingSubjectReference
      ? await resolvePartyInstanceReference(fastify.db, body.actingSubjectReference) ?? undefined
      : undefined;
    const actingAccountReference = actingPartyReference
      ? await resolveAccountReferenceForParty(fastify.db, actingPartyReference)
      : undefined;
    try {
      const tx = await createTransaction(fastify.db, {
        cardToken: apiChargeToken,
        accountReference: actingAccountReference ?? `${merchantId}:api`,
        amount: body.amount,
        currency: body.currency,
        cardTransactionMerchantName: merchantName,
        cardTransactionMerchantCategoryCode: '5812',
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: '****-****-****-4242',
        cardTransactionType: 'purchase',
        cardTransactionDescription: (body.paymentOrderDescription ?? 'API payment').slice(0, 22),
        cardTransactionNarrative: `API payment ${body.paymentOrderMerchantReference}`,
        merchantAgreementInstanceReference: merchantId,
        gatewayPayload: { source: 'api_payment', merchantReference: body.paymentOrderMerchantReference, paymentOrderInstanceReference: order.paymentOrderInstanceReference },
      });
      // Attribute the merchant-originated charge (SD-16 audit, PCI DSS Req 10).
      // Base attribution from the machine token (clientId + merchant). When the merchant forwarded an
      // acting user, override actingPartyReference with the user's OAuth subject so the charge lines up
      // with the self-scoped operations view (which matches on the subject).
      const baseAttribution = attributionFromMerchantContext(request.merchantContext);
      emitProcessEvent(fastify.db, {
        entityType: 'transaction', entityId: tx.cardTransactionInstanceReference,
        processType: 'payment_processing', processAction: 'merchant.payment.api', processOutcome: 'approved',
        performedByPartyReference: actingPartyReference ?? null, performedByRole: actingPartyReference ? 'customer' : null,
        eventSummary: { amount: body.amount, currency: body.currency, paymentOrderInstanceReference: order.paymentOrderInstanceReference, merchantReference: body.paymentOrderMerchantReference },
        bianServiceDomain: 'Payment Order', bianControlRecordType: 'PaymentOrderProcedure',
        attribution: baseAttribution
          ? { ...baseAttribution, ...(body.actingSubjectReference && { actingPartyReference: body.actingSubjectReference }) }
          : undefined,
      });
      return reply.status(201).send({ ...order, paymentOrderStatus: 'authorized', cardTransactionInstanceReference: tx.cardTransactionInstanceReference });
    } catch (err) {
      if (err instanceof CardIssuerDeclinedError) {
        return reply.status(402).send({ error: 'payment_declined', error_description: err.reason, responseCode: err.responseCode, ...order, paymentOrderStatus: 'failed' });
      }
      throw err;
    }
  });

  // GET /api/v1/gateway/payments/:id
  fastify.get('/:id', {
    schema: {
      tags: ['gateway'],
      summary: 'Get payment order status (SD-64)',
      description: `Returns the current state of a \`paymentOrder\` including lifecycle timestamps and routing decision.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: '`paymentOrderInstanceReference` UUID.' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentOrderInstanceReference: { type: 'string' },
            paymentOrderReference: { type: 'string' },
            paymentOrderStatus: { type: 'string', enum: PAYMENT_STATUS_ENUM },
            paymentOrderAmount: { $ref: 'MonetaryAmount#' },
            merchantAgreementInstanceReference: { type: 'string' },
            linkedCardTransactionReference: { type: 'string', description: 'Set after authorization.' },
            routingDecision: {
              type: 'object',
              properties: {
                processor: { type: 'string' },
                routedAt: { type: 'string', format: 'date-time' },
                routingReason: { type: 'string' },
              },
            },
            paymentOrderInitiatedDateTime: { type: 'string', format: 'date-time' },
            paymentOrderExpiresAt: { type: 'string', format: 'date-time' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getPaymentOrder(fastify.db, id);
    if (!result) return reply.status(404).send({ error: 'Payment order not found' });
    return reply.send(result);
  });

  // POST /api/v1/gateway/payments/:id/confirm
  fastify.post('/:id/confirm', {
    schema: {
      tags: ['gateway'],
      summary: 'Confirm payment order (SD-64: initiated → confirmed)',
      description: `Transitions the payment order from \`initiated\` to \`confirmed\`. Links the order to a \`customerAgreement\`.
_(v5: state validation and 422 enforcement are not yet implemented in this prototype.)_`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['customerAgreementInstanceReference'],
        properties: {
          customerAgreementInstanceReference: { type: 'string', description: 'UUID of the customer completing this payment.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentOrderInstanceReference: { type: 'string' },
            paymentOrderStatus: { type: 'string', enum: PAYMENT_STATUS_ENUM },
            customerAgreementInstanceReference: { type: 'string' },
            paymentOrderConfirmedDateTime: { type: 'string', format: 'date-time' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        422: { description: 'Invalid state transition.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { customerAgreementInstanceReference } = request.body as { customerAgreementInstanceReference: string };
    if (!customerAgreementInstanceReference) {
      return reply.status(400).send({ error: 'customerAgreementInstanceReference is required' });
    }
    const result = await confirmPaymentOrder(fastify.db, id, customerAgreementInstanceReference);
    return reply.send(result);
  });

  // POST /api/v1/gateway/payments/:id/authorize
  fastify.post('/:id/authorize', {
    schema: {
      tags: ['gateway'],
      summary: 'Authorize payment (SD-64: confirmed → authorized / SD-65: routing)',
      description: `Executes the payment authorization:
1. SD-65 routing selects a processor (\`routingDecision\` populated)
2. A linked \`cardTransaction\` (SD-254) is created
3. Fraud evaluation triggered via \`shared/services/fraudTrigger\`
4. Status transitions \`confirmed → authorized\`

_(v5: state validation and 422 enforcement are not yet implemented in this prototype.)_`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentOrderInstanceReference: { type: 'string' },
            paymentOrderStatus: { type: 'string', enum: PAYMENT_STATUS_ENUM },
            linkedCardTransactionReference: { type: 'string', description: 'UUID of the created cardTransaction.' },
            routingDecision: { type: 'object', properties: { processor: { type: 'string' }, routedAt: { type: 'string', format: 'date-time' }, routingReason: { type: 'string' } } },
            paymentOrderAuthorizedDateTime: { type: 'string', format: 'date-time' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        422: { description: 'Invalid state transition.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await authorizePaymentOrder(fastify.db, id);
    if (!result) return reply.status(422).send({ error: 'Payment order not found or cannot be authorized from current state' });
    return reply.send(result);
  });

  // POST /api/v1/gateway/payments/:id/capture
  fastify.post('/:id/capture', {
    schema: {
      tags: ['gateway'],
      summary: 'Capture authorized payment (SD-64: authorized → captured)',
      description: `Captures the funds from an authorized payment. Allowed only from \`authorized\` status.
In card-not-present flows, capture may be deferred from authorization (e.g., ship-then-capture).
_(v5: state validation and 422 enforcement are not yet implemented in this prototype.)_`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentOrderInstanceReference: { type: 'string' },
            paymentOrderStatus: { type: 'string', enum: PAYMENT_STATUS_ENUM },
            paymentOrderCapturedDateTime: { type: 'string', format: 'date-time' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        422: { description: 'Invalid state transition.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await capturePaymentOrder(fastify.db, id);
    if (!result) return reply.status(422).send({ error: 'Payment order not found or cannot be captured from current state' });
    return reply.send(result);
  });

  // DELETE /api/v1/gateway/payments/:id  → void
  fastify.delete('/:id', {
    schema: {
      tags: ['gateway'],
      summary: 'Void a payment order (SD-64: authorized|confirmed → voided)',
      description: `Voids a payment order. Allowed from \`authorized\` or \`confirmed\` status.
A voided order cannot be captured or refunded. _(v5: updating the linked \`cardTransaction\` to \`declined\` is not yet implemented in this prototype.)_`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentOrderInstanceReference: { type: 'string' },
            paymentOrderStatus: { type: 'string', enum: PAYMENT_STATUS_ENUM },
            paymentOrderVoidedDateTime: { type: 'string', format: 'date-time' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        422: { description: 'Invalid state transition (e.g. cannot void a captured payment).', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await voidPaymentOrder(fastify.db, id);
    if (!result) return reply.status(422).send({ error: 'Payment order not found or cannot be voided from current state' });
    return reply.send(result);
  });

  // POST /api/v1/gateway/payments/:id/refund
  fastify.post('/:id/refund', {
    schema: {
      tags: ['gateway'],
      summary: 'Refund a captured payment (SD-64: captured → refunded)',
      description: `Issues a partial or full refund for a captured payment. Allowed only from \`captured\` status.
Partial refunds are supported: \`refundAmount\` must be ≤ original payment amount.
_(v5: state validation, refund amount check, and 422 enforcement are not yet implemented in this prototype.)_`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['refundAmount', 'refundReason'],
        properties: {
          refundAmount: { type: 'number', description: 'Amount to refund. Must be ≤ original amount.' },
          refundReason: { type: 'string', description: 'Human-readable reason for the refund.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentOrderInstanceReference: { type: 'string' },
            paymentOrderStatus: { type: 'string', enum: PAYMENT_STATUS_ENUM },
            refundRecord: {
              type: 'object',
              properties: {
                refundAmount: { type: 'number' },
                refundDateTime: { type: 'string', format: 'date-time' },
                refundReason: { type: 'string' },
              },
            },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        422: { description: 'Invalid state transition or refund amount exceeds original.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { refundAmount, refundReason } = request.body as { refundAmount: number; refundReason: string };
    if (!refundAmount || !refundReason) {
      return reply.status(400).send({ error: 'refundAmount and refundReason are required' });
    }
    const result = await refundPaymentOrder(fastify.db, id, refundAmount, refundReason);
    if (!result) return reply.status(422).send({ error: 'Payment order not found or cannot be refunded from current state' });
    return reply.send(result);
  });
}
