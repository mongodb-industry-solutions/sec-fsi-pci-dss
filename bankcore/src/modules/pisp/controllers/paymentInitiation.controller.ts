import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import { resolveConsent } from '../../consent/services/consent.service';
import { runIdempotent } from '../../../shared/services/idempotency';
import { PAYMENT_PRODUCTS, PaymentProduct } from '../models/paymentInitiation.model';
import {
  initiatePayment, findPayment, cancelPayment, toBerlinGroupPayment,
} from '../services/paymentInitiation.service';

// Berlin Group NextGenPSD2 Payment Initiation Service. The payment product is part of the path, exactly
// as the specification writes it, so the TPP selects the scheme and the bank decides how it actually
// reaches the creditor.
//
// `additionalProperties: true` on the error shapes is deliberate: a strict response schema silently DROPS
// what it does not declare, and this platform has already shipped an empty error body that way.
const ERROR_RESPONSE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    tppMessages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: { category: { type: 'string' }, code: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
} as const;

const AMOUNT = {
  type: 'object',
  required: ['currency', 'amount'],
  properties: {
    currency: { type: 'string', description: 'ISO 4217.' },
    // A decimal STRING per ISO 20022. A number would lose cents on a large value.
    amount: { type: 'string', description: 'Decimal string, e.g. "125.50".' },
  },
} as const;

const ACCOUNT_REFERENCE = {
  type: 'object',
  properties: { iban: { type: 'string' } },
} as const;

const PAYMENT_RESOURCE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    transactionStatus: { type: 'string' },
    paymentId: { type: 'string' },
    endToEndIdentification: { type: 'string' },
    debtorAccount: ACCOUNT_REFERENCE,
    creditorAccount: ACCOUNT_REFERENCE,
    creditorName: { type: 'string' },
    creditorAgent: { type: 'string' },
    instructedAmount: AMOUNT,
    remittanceInformationUnstructured: { type: 'string' },
    requestedExecutionDate: { type: 'string' },
  },
} as const;

const STANDARD_HEADERS = {
  type: 'object',
  properties: {
    'consent-id': { type: 'string', description: 'Consent that authorises this initiation (Berlin Group).' },
    'x-request-id': { type: 'string', description: 'Caller correlation id. Also the idempotency key on initiation.' },
  },
  // Deliberately NOT `required`: Fastify's own validation would answer with its generic body, which is
  // not the Berlin Group error shape, for the most common mistake a caller makes.
} as const;

// Deliberately NOT an `enum` in the schema. Fastify's own parameter validation would answer first with
// its generic {statusCode, error, message} body, which this route's error schema then strips to `{}`
// because it does not declare those fields: the caller gets an empty 400 for a mistyped product. The
// handler answers 404 with the standard error body instead, and the products are documented here.
const PRODUCT_PARAM = {
  type: 'string',
  description: 'One of `sepa-credit-transfers`, `instant-sepa-credit-transfers`, `cross-border-credit-transfers`.',
} as const;

const STATUS_DESCRIPTION =
  'ISO 20022 `transactionStatus`, which is what the standard carries: `RCVD` received, `ACTC` technically '
  + 'validated, `ACCP` accepted, `ACSP` settlement in process, `ACSC` settlement completed, `RJCT` '
  + 'rejected, `CANC` cancelled, `PDNG` pending.';

function messages(code: string, text: string) {
  return { tppMessages: [{ category: 'ERROR', code, text }] };
}

function consentIdOf(request: FastifyRequest): string | undefined {
  const value = request.headers['consent-id'];
  return Array.isArray(value) ? String(value[0]) : (value as string | undefined);
}

function productOf(request: FastifyRequest): PaymentProduct | undefined {
  const { paymentProduct } = request.params as { paymentProduct?: string };
  return PAYMENT_PRODUCTS.includes(paymentProduct as PaymentProduct) ? paymentProduct as PaymentProduct : undefined;
}

// ISO 20022 sends the amount as a decimal string, so it is parsed rather than assumed to be a number.
function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Resolves the consent for a payment operation, answering the standard refusal itself when it fails. */
async function authorisePayment(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ consentId: string; permittedAccounts: string[] } | undefined> {
  const consentId = consentIdOf(request);
  if (!consentId) {
    reply.status(400).send(messages('CONSENT_INVALID', 'Consent-ID header is required'));
    return undefined;
  }
  // The same gate the AIS reads go through, with the payment access kind. One implementation, so payment
  // authorisation cannot drift from account authorisation.
  const resolution = await resolveConsent(fastify.db, {
    consentId,
    tppClientId: request.tpp!.clientId,
    kind: 'payments',
    correlationId: request.correlationId,
  });
  if (!resolution.ok) {
    const { status, code, text } = resolution.refusal;
    reply.status(status).send(messages(code, text));
    return undefined;
  }
  return { consentId, permittedAccounts: resolution.consent.bankConsentAccess.payments ?? [] };
}

// `preValidation`, not `preHandler`: schema validation runs BEFORE preHandler, so an unauthenticated
// caller would be told about the body format instead of being refused. Authorisation is the first gate,
// then the format, then the consent.
export async function paymentInitiationController(fastify: FastifyInstance) {
  // ── POST /v1/payments/{payment-product} ──────────────────────────────────────────────────────
  fastify.post('/payments/:paymentProduct', {
    preValidation: requireTpp('payments', 'PISP'),
    schema: {
      tags: ['payments'],
      summary: 'Initiate a credit transfer',
      description:
        'Berlin Group PIS. The payment product is the scheme the TPP selects; how the bank reaches the '
        + 'creditor is its own business, so the same request works for an account at this bank and for one '
        + 'elsewhere.\n\n'
        + 'The bank re-validates everything the TPP already validated. That is not duplication: an ASPSP '
        + 'does not trust a client\'s checks. IBANs are checked with mod-97, the debtor must be an active '
        + 'account at this bank whose currency matches, the consent must authorise payments from it, and '
        + 'the funds must be there.\n\n'
        + '**This accepts a payment, it does not execute it.** The response is `ACTC`, technically '
        + 'validated. The debit and the settlement leg belong to the payment hub, and keeping that '
        + 'crossing separate is what makes the irrevocable step identifiable.\n\n'
        + '`X-Request-ID` is the idempotency key: a retry returns the SAME `paymentId` rather than '
        + `creating a second payment.\n\n${STATUS_DESCRIPTION}`,
      security: [{ tppToken: [] }],
      headers: STANDARD_HEADERS,
      params: {
        type: 'object',
        required: ['paymentProduct'],
        properties: { paymentProduct: PRODUCT_PARAM },
      },
      body: {
        type: 'object',
        required: ['instructedAmount', 'debtorAccount', 'creditorAccount', 'creditorName'],
        properties: {
          instructedAmount: AMOUNT,
          debtorAccount: ACCOUNT_REFERENCE,
          creditorAccount: ACCOUNT_REFERENCE,
          creditorName: { type: 'string' },
          creditorAgent: { type: 'string', description: 'BIC of the creditor institution, where known.' },
          endToEndIdentification: { type: 'string', description: 'The caller\'s own payment id, carried through.' },
          remittanceInformationUnstructured: { type: 'string' },
          requestedExecutionDate: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: true,
          properties: {
            transactionStatus: { type: 'string', description: STATUS_DESCRIPTION },
            paymentId: { type: 'string' },
            _links: { type: 'object', additionalProperties: true },
          },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const product = productOf(request);
    if (!product) {
      return reply.status(404).send(messages('PRODUCT_UNKNOWN', 'No such payment product at this bank'));
    }
    const authorised = await authorisePayment(fastify, request, reply);
    if (!authorised) return reply;

    const body = request.body as {
      instructedAmount?: { currency?: string; amount?: unknown };
      debtorAccount?: { iban?: string };
      creditorAccount?: { iban?: string };
      creditorName?: string;
      creditorAgent?: string;
      endToEndIdentification?: string;
      remittanceInformationUnstructured?: string;
      requestedExecutionDate?: string;
    };

    const initiate = async () => {
      const result = await initiatePayment(fastify.db, {
        product,
        tppClientId: request.tpp!.clientId,
        consentReference: authorised.consentId,
        debtorIban: body.debtorAccount?.iban ?? '',
        creditorIban: body.creditorAccount?.iban ?? '',
        creditorName: body.creditorName ?? '',
        creditorAgentBic: body.creditorAgent,
        amount: parseAmount(body.instructedAmount?.amount),
        currency: body.instructedAmount?.currency ?? '',
        remittanceInformation: body.remittanceInformationUnstructured,
        endToEndIdentification: body.endToEndIdentification,
        requestedExecutionDate: body.requestedExecutionDate,
        correlationId: request.correlationId,
        permittedAccountReferences: authorised.permittedAccounts,
      });
      if (!result.ok) {
        return { status: result.status, body: messages(result.code, result.text) };
      }
      const paymentId = result.payment.paymentInitiationInstanceReference;
      return {
        status: 201,
        body: {
          transactionStatus: result.payment.transactionStatus,
          paymentId,
          _links: {
            self: { href: `/v1/payments/${product}/${paymentId}` },
            status: { href: `/v1/payments/${product}/${paymentId}/status` },
          },
        },
      };
    };

    // Keyed on the correlation id, which is the caller's X-Request-ID when it sends one and generated
    // when it does not. A caller that omits it gets no idempotency, which is its own choice.
    const outcome = await runIdempotent(fastify.db, `pis:${request.correlationId}`, initiate);
    if (outcome.kind === 'in_progress') {
      return reply.status(409).send(messages(
        'RESOURCE_BLOCKED',
        'A payment with this X-Request-ID is already being processed',
      ));
    }
    // The stored outcome carries its own status, replay included, so a retry answers exactly as the
    // first attempt did rather than being re-derived.
    return reply.status(outcome.outcome.status as 201).send(outcome.outcome.body);
  });

  // ── GET /v1/payments/{payment-product}/{paymentId} ───────────────────────────────────────────
  fastify.get('/payments/:paymentProduct/:paymentId', {
    preValidation: requireTpp('payments', 'PISP'),
    schema: {
      tags: ['payments'],
      summary: 'Read a payment',
      description:
        'Berlin Group PIS. Scoped to the TPP that initiated it, and to the product in the path: a payment '
        + 'read under the wrong product is not this payment, and answering anyway would make the path '
        + 'decorative.',
      security: [{ tppToken: [] }],
      headers: STANDARD_HEADERS,
      params: {
        type: 'object',
        required: ['paymentProduct', 'paymentId'],
        properties: { paymentProduct: PRODUCT_PARAM, paymentId: { type: 'string' } },
      },
      response: {
        200: PAYMENT_RESOURCE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const product = productOf(request);
    const { paymentId } = request.params as { paymentId: string };
    const payment = product
      ? await findPayment(fastify.db, paymentId, request.tpp!.clientId, product)
      : null;
    if (!payment) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such payment for this client'));
    return toBerlinGroupPayment(payment);
  });

  // ── GET /v1/payments/{payment-product}/{paymentId}/status ────────────────────────────────────
  fastify.get('/payments/:paymentProduct/:paymentId/status', {
    preValidation: requireTpp('payments', 'PISP'),
    schema: {
      tags: ['payments'],
      summary: 'Read the status of a payment',
      description:
        'Berlin Group PIS. The polling counterpart to the push notification: a TPP that missed a delivery '
        + `finds the truth here, which is the specification's own answer to that problem.\n\n${STATUS_DESCRIPTION}`,
      security: [{ tppToken: [] }],
      headers: STANDARD_HEADERS,
      params: {
        type: 'object',
        required: ['paymentProduct', 'paymentId'],
        properties: { paymentProduct: PRODUCT_PARAM, paymentId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: { transactionStatus: { type: 'string' } },
        },
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const product = productOf(request);
    const { paymentId } = request.params as { paymentId: string };
    const payment = product
      ? await findPayment(fastify.db, paymentId, request.tpp!.clientId, product)
      : null;
    if (!payment) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such payment for this client'));
    return { transactionStatus: payment.transactionStatus };
  });

  // ── DELETE /v1/payments/{payment-product}/{paymentId} ────────────────────────────────────────
  fastify.delete('/payments/:paymentProduct/:paymentId', {
    preValidation: requireTpp('payments', 'PISP'),
    schema: {
      tags: ['payments'],
      summary: 'Cancel a payment',
      description:
        'Berlin Group PIS, "cancellation where applicable". Applicable means not yet presented for '
        + 'settlement: past that point a payment is irrevocable and what exists is a recall or a return '
        + 'that the creditor\'s bank may refuse. Reporting that as a cancellation would promise something '
        + 'the rails do not deliver, so it is refused with the reason instead.',
      security: [{ tppToken: [] }],
      headers: STANDARD_HEADERS,
      params: {
        type: 'object',
        required: ['paymentProduct', 'paymentId'],
        properties: { paymentProduct: PRODUCT_PARAM, paymentId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: { transactionStatus: { type: 'string' } },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const product = productOf(request);
    const { paymentId } = request.params as { paymentId: string };
    const payment = product
      ? await findPayment(fastify.db, paymentId, request.tpp!.clientId, product)
      : null;
    if (!payment) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such payment for this client'));

    const result = await cancelPayment(fastify.db, payment);
    if (!result.ok) return reply.status(result.status).send(messages(result.code, result.text));
    // 200 with the resulting status, not 204: the caller needs to see that it is CANC.
    return { transactionStatus: result.payment.transactionStatus };
  });
}
