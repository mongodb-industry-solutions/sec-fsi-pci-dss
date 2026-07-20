// BIAN SD-64: Payment Order - Checkout Session REST controller
// Routes mounted at /checkout → /api/v1/checkout

import { FastifyInstance } from 'fastify';
import {
  createCheckoutSession,
  getCheckoutSession,
  processCheckoutPayment,
  cancelCheckoutSession,
} from '../services/checkout.service';
import { getMerchantById } from '../services/merchant.service';
import { deliverWebhook } from '../services/webhook.service';
import { tryMerchantContext } from '../../../vendors/middleware/validateMerchantToken';
import { resolvePartyInstanceReference } from '../../identity/services/oauth.service';

const SESSION_STATUS_ENUM = ['pending', 'completed', 'expired', 'cancelled'];

export async function checkoutController(fastify: FastifyInstance) {

  // POST /api/v1/checkout/sessions
  fastify.post('/sessions', {
    schema: {
      tags: ['payment:checkout'],
      summary: 'Create a checkout session (Redirect Checkout)',
      description: `Creates a \`checkoutSession\` (BIAN SD-64) and returns a hosted payment page URL.

**Integration flow:**
1. Merchant calls this endpoint with payment details
2. Merchant redirects the buyer to \`paymentPageUrl\`
3. Buyer completes payment on the hosted page
4. Buyer is redirected back to \`returnUrl?status=success\` or \`cancelUrl?status=failed\`
5. Merchant optionally verifies via \`GET /checkout/sessions/:id\`

**PCI DSS:** The merchant never receives cardholder data. Only the hosted page on the PSP domain handles card entry. Qualifies for SAQ A compliance.`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['merchantAgreementInstanceReference', 'amount', 'currency', 'description', 'returnUrl', 'cancelUrl', 'merchantReference'],
        properties: {
          merchantAgreementInstanceReference: { type: 'string', description: 'Merchant UUID from SD-89.' },
          amount: { type: 'number', minimum: 0.01, description: 'Payment amount.' },
          currency: { type: 'string', minLength: 3, maxLength: 3, description: 'ISO 4217 currency code.' },
          description: { type: 'string', maxLength: 255, description: 'Human-readable payment description.' },
          returnUrl: { type: 'string', description: 'URL buyer is redirected to after successful payment.' },
          cancelUrl: { type: 'string', description: 'URL buyer is redirected to on cancellation or failure.' },
          merchantReference: { type: 'string', maxLength: 100, description: "Merchant's own order/cart ID (idempotency key)." },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            checkoutSessionInstanceReference: { type: 'string' },
            paymentPageUrl: { type: 'string', description: 'Redirect the buyer to this URL.' },
            expiresAt: { type: 'string', format: 'date-time', description: 'Session auto-expires at this time (30 min).' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { description: 'Merchant not found.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      merchantAgreementInstanceReference: string;
      amount: number;
      currency: string;
      description: string;
      returnUrl: string;
      cancelUrl: string;
      merchantReference: string;
    };

    const merchant = await getMerchantById(fastify.db, body.merchantAgreementInstanceReference);
    if (!merchant) {
      return reply.status(404).send({ error: 'Merchant not found' });
    }

    const baseUrl = process.env.PSP_URL_FRONTEND ?? 'http://localhost:8080';

    // On-behalf-of attribution (best-effort, public endpoint): if the merchant app forwarded the acting
    // user's OAuth Bearer, capture who created this session so the resulting purchase is attributed to the
    // payer (visible in their payment history) and audited in the connected-apps operations view. A missing
    // or invalid token simply leaves the session unattributed — the public flow is unchanged.
    // Fully best-effort: neither token resolution nor the subject→party lookup may fail this PUBLIC
    // endpoint. A DB blip during the party lookup must leave the session unattributed, not return 500.
    let merchantCtx: Awaited<ReturnType<typeof tryMerchantContext>>;
    let actingPartyReference: string | undefined;
    try {
      merchantCtx = await tryMerchantContext(request);
      if (merchantCtx?.sub) {
        actingPartyReference = await resolvePartyInstanceReference(fastify.db, merchantCtx.sub) ?? undefined;
      }
    } catch {
      merchantCtx = undefined;
      actingPartyReference = undefined;
    }

    const result = await createCheckoutSession(fastify.db, {
      merchantAgreementInstanceReference: body.merchantAgreementInstanceReference,
      merchantName: (merchant as Record<string, unknown>).merchantName as string,
      merchantCategoryCode: (merchant as Record<string, unknown>).merchantCategoryCode as string,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      returnUrl: body.returnUrl,
      cancelUrl: body.cancelUrl,
      merchantReference: body.merchantReference,
      ...(merchantCtx?.sub && { actingSubjectReference: merchantCtx.sub }),
      ...(actingPartyReference && { actingPartyReference }),
      ...(merchantCtx?.clientId && { actingClientId: merchantCtx.clientId }),
    }, baseUrl);

    return reply.status(201).send({
      checkoutSessionInstanceReference: result.checkoutSessionInstanceReference,
      paymentPageUrl: result.paymentPageUrl,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  // GET /api/v1/checkout/sessions/:id
  fastify.get('/sessions/:id', {
    config: { skipAuth: true }, // buyer/hosted page reads session status without a login
    schema: {
      tags: ['payment:checkout'],
      summary: 'Get checkout session (public status check)',
      description: 'Returns payment page display data and current session status. Used by the hosted payment page on load and by the merchant to verify payment after redirect.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'checkoutSessionInstanceReference UUID.' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            checkoutSessionInstanceReference: { type: 'string' },
            checkoutSessionAmount: { type: 'number' },
            checkoutSessionCurrency: { type: 'string' },
            checkoutSessionDescription: { type: 'string' },
            merchantName: { type: 'string' },
            checkoutSessionStatus: { type: 'string', enum: SESSION_STATUS_ENUM },
            checkoutSessionExpiresAt: { type: 'string', format: 'date-time' },
            checkoutSessionReturnUrl: { type: 'string' },
            checkoutSessionCancelUrl: { type: 'string' },
            hasActingUser: { type: 'boolean', description: 'True when the session was created on behalf of a logged-in user; the hosted page may then offer that payer\'s saved cards.' },
          },
        },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getCheckoutSession(fastify.db, id);
    if (!session) return reply.status(404).send({ error: 'Checkout session not found' });
    return reply.send(session);
  });

  // NOTE: there is deliberately NO session-scoped saved-cards endpoint. Cards are shown only for the
  // AUTHENTICATED viewer of the browser (GET /customer/me/cards, resolved from the PSP portal token).
  // Resolving cards from the session's stored acting party would reveal that user's cards to ANYONE who
  // opens the checkout URL without being logged in — a security/PCI/GDPR leak. Both the redirect
  // checkout and the payment link are browser-token-only: no logged-in viewer → new-card form only.

  // POST /api/v1/checkout/sessions/:id/pay
  fastify.post('/sessions/:id/pay', {
    config: { skipAuth: true }, // buyer pays on the hosted page without a login
    schema: {
      tags: ['payment:checkout'],
      summary: 'Process payment for a checkout session (public)',
      description: `Called by the hosted payment page after the buyer submits the card form.

**Card data:** Only a card token (client-side generated surrogate) is accepted. Raw PANs are never sent to this endpoint.

**PCI DSS:** This endpoint is in the CDE boundary. The hosted payment page tokenizes the card on the client side before calling this endpoint.`,
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'checkoutSessionInstanceReference UUID.' } },
      },
      body: {
        type: 'object',
        // Expiry is OPTIONAL: a saved/tokenized card pays by token and the issuer authorizes on the
        // token (not the expiry), so the payer only re-enters the CVV. New-card entry still sends expiry
        // (the patterns below validate it when present).
        required: ['cardToken', 'cardholderName'],
        properties: {
          cardToken: { type: 'string', description: 'Client-side generated card token (not the raw PAN).' },
          cardholderName: { type: 'string', minLength: 1, maxLength: 100 },
          cardExpiryMonth: { type: 'string', pattern: '^(0[1-9]|1[0-2])$' },
          cardExpiryYear: { type: 'string', pattern: '^20[2-9][0-9]$' },
          cardCvv: { type: 'string', pattern: '^[0-9]{3,4}$', description: 'Card verification value. Forwarded to the issuer for verification ONLY; never persisted (PCI DSS Req 3.2). A wrong/missing CVV declines.' },
          cardholderEmail: { type: 'string', format: 'email', description: 'Customer email — used as accountReference to link transaction to customer record.' },
          saveCard: { type: 'boolean', description: 'When true, saves the card token to the customer\'s SD-57 paymentCardManagement record.' },
          cardAuthOutcome: { type: 'string', enum: ['approved', 'declined', 'challenge'], description: 'Simulator-only: drives stub card auth result.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            declined: { type: 'boolean', description: 'True when the payment was declined (a normal outcome, not an error).' },
            cardTransactionInstanceReference: { type: 'string', nullable: true },
            fraudDiagnosisInstanceReference: { type: 'string', nullable: true },
            responseCode: { type: 'string', description: 'Issuer response code on a decline (e.g. 82).' },
            declineReason: { type: 'string', description: 'Human-readable decline reason.' },
            redirectUrl: { type: 'string', nullable: true, description: 'Buyer should be redirected to this URL.' },
          },
        },
        402: { description: 'Card authorization declined.', $ref: 'Error#' },
        404: { $ref: 'Error#' },
        409: { description: 'Session already completed.', $ref: 'Error#' },
        410: { description: 'Session expired or cancelled.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      cardToken: string;
      cardholderName: string;
      cardExpiryMonth?: string;
      cardExpiryYear?: string;
      cardCvv?: string;
      cardholderEmail?: string;
      saveCard?: boolean;
      cardAuthOutcome?: 'approved' | 'declined' | 'challenge';
    };

    const { result, cardTransactionInstanceReference, fraudDiagnosisInstanceReference, redirectUrl, responseCode, declineReason } = await processCheckoutPayment(
      fastify.db,
      {
        sessionId: id,
        cardToken: body.cardToken,
        cardholderName: body.cardholderName,
        cardExpiryMonth: body.cardExpiryMonth,
        cardExpiryYear: body.cardExpiryYear,
        cardCvv: body.cardCvv,
        customerEmail: body.cardholderEmail,
        saveCard: body.saveCard,
        cardAuthOutcome: body.cardAuthOutcome,
      }
    );

    if (result === 'not_found') return reply.status(404).send({ error: 'Checkout session not found' });
    if (result === 'expired' || result === 'cancelled') return reply.status(410).send({ error: `Session ${result}` });
    if (result === 'already_completed') return reply.status(409).send({ error: 'Session already completed' });
    // A declined payment is a normal outcome (not an error): return 200 with success:false + the
    // redirect so the buyer is shown "payment declined" and returned to the merchant.
    if (result === 'declined') {
      return reply.status(200).send({
        success: false,
        declined: true,
        cardTransactionInstanceReference: cardTransactionInstanceReference ?? null,
        responseCode: responseCode ?? '0190',
        declineReason: declineReason ?? 'Card declined',
        redirectUrl: redirectUrl ?? null,
      });
    }

    // Fire webhook asynchronously (non-blocking)
    if (result === 'ok') {
      const session = await getCheckoutSession(fastify.db, id);
      if (session) {
        const merchant = await getMerchantById(fastify.db, (session as unknown as Record<string, unknown>).merchantAgreementInstanceReference as string ?? '');
        const merchantDoc = merchant as Record<string, unknown> | null;
        if (merchantDoc?.merchantWebhookEndpoint && merchantDoc?.merchantWebhookSecret) {
          const maskedPan = `****-****-****-${body.cardToken.slice(-4).padStart(4, '0')}`;
          deliverWebhook(
            merchantDoc.merchantWebhookEndpoint as string,
            {
              event: 'checkout.completed',
              timestamp: new Date().toISOString(),
              data: {
                checkoutSessionInstanceReference: id,
                cardTransactionInstanceReference,
                fraudDiagnosisInstanceReference: fraudDiagnosisInstanceReference ?? null,
                fraudCaseCreated: !!fraudDiagnosisInstanceReference,
                cardToken: body.cardToken,
                maskedPan,
                amount: session.checkoutSessionAmount,
                currency: session.checkoutSessionCurrency,
              },
            },
            merchantDoc.merchantWebhookSecret as string
          ).catch(() => {});
        }
      }
    }

    return reply.send({
      success: true,
      cardTransactionInstanceReference,
      fraudDiagnosisInstanceReference: fraudDiagnosisInstanceReference ?? null,
      redirectUrl,
    });
  });

  // DELETE /api/v1/checkout/sessions/:id
  fastify.delete('/sessions/:id', {
    schema: {
      tags: ['payment:checkout'],
      summary: 'Cancel a checkout session',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          merchantAgreementInstanceReference: { type: 'string', description: 'Merchant must match the session owner.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            checkoutSessionInstanceReference: { type: 'string' },
            checkoutSessionStatus: { type: 'string', enum: ['cancelled'] },
          },
        },
        403: { description: 'Merchant does not own this session.', $ref: 'Error#' },
        404: { $ref: 'Error#' },
        409: { description: 'Session already completed - cannot cancel.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { merchantAgreementInstanceReference?: string };
    const merchantId = body.merchantAgreementInstanceReference ?? '';

    const result = await cancelCheckoutSession(fastify.db, id, merchantId);

    if (result === 'not_found') return reply.status(404).send({ error: 'Session not found' });
    if (result === 'already_completed') return reply.status(409).send({ error: 'Session already completed' });
    if (result === 'wrong_merchant') return reply.status(403).send({ error: 'Merchant does not own this session' });

    return reply.send({ checkoutSessionInstanceReference: id, checkoutSessionStatus: 'cancelled' });
  });
}
