import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import { resolveConsent } from '../../consent/services/consent.service';
import { runIdempotent } from '../../../shared/services/idempotency';
import { PAYMENT_PRODUCTS, PaymentProduct } from '../models/paymentInitiation.model';
import { PERIODIC_FREQUENCIES } from '../models/periodicPayment.model';
import {
  createPeriodicPayment, findPeriodicPayment, cancelPeriodicPayment, toBerlinGroupPeriodicPayment,
} from '../services/periodicPayment.service';
import { CONSENT_SCOPED_HEADERS } from '../../../shared/standardHeaders';

// Standing orders, on the standard's own resource. A periodic payment is not a flag on a payment: it has a
// lifecycle of its own PLUS an outcome per execution, and the standard gives it its own path for that reason.
const ERROR = {
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

const ORDER_RESPONSE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    paymentId: { type: 'string' },
    transactionStatus: { type: 'string' },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    frequency: { type: 'string' },
    executionRule: { type: 'string' },
    dayOfExecution: { type: 'integer' },
    nextExecutionDate: { type: 'string' },
    executionCount: { type: 'integer' },
  },
} as const;

function messages(code: string, text: string) {
  return { tppMessages: [{ category: 'ERROR', code, text }] };
}

function consentIdOf(request: FastifyRequest): string | undefined {
  const header = request.headers['consent-id'];
  return Array.isArray(header) ? header[0] : header;
}

async function authorise(
  fastify: FastifyInstance, request: FastifyRequest, reply: FastifyReply,
): Promise<{ consentId: string; permittedAccounts: string[] } | undefined> {
  const consentId = consentIdOf(request);
  if (!consentId) {
    reply.status(400).send(messages('CONSENT_INVALID', 'Consent-ID header is required'));
    return undefined;
  }
  // The same gate, with the same access kind, as a single payment. A standing order is an authorisation to
  // make payments, so it is authorised as one rather than through a second path of its own.
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

export async function periodicPaymentController(fastify: FastifyInstance) {
  // ── POST /v1/periodic-payments/{payment-product} ─────────────────────────────────────────────
  fastify.post('/periodic-payments/:paymentProduct', {
    preValidation: requireTpp('payments', 'PISP'),
    schema: {
      tags: ['payments'],
      summary: 'Create a standing order',
      description:
        'One authorisation, many executions on a schedule. `frequency` is the ISO 20022 code set, not a '
        + 'bespoke enumeration, so a third party integrated against another bank already sends these.\n\n'
        + '**Nothing moves at creation.** The order lands `ACTC`, technically validated, and the first '
        + 'collection happens on its own date. There is deliberately no balance check either: a standing '
        + 'order authorises future payments, and today\'s balance says nothing about one due next month.\n\n'
        + '`nextExecutionDate` is DERIVED and cannot be supplied. A caller able to set it could make the bank '
        + 'collect whenever it liked. `dayOfExecution` on a month that is shorter clamps to the last day that '
        + 'month has, rather than rolling into the next one and moving the payment out of its period.',
      security: [{ tppToken: [] }],
      headers: CONSENT_SCOPED_HEADERS,
      params: {
        type: 'object',
        required: ['paymentProduct'],
        properties: { paymentProduct: { type: 'string', enum: PAYMENT_PRODUCTS } },
      },
      body: {
        type: 'object',
        required: ['debtorAccount', 'creditorAccount', 'creditorName', 'instructedAmount', 'startDate', 'frequency'],
        properties: {
          debtorAccount: { type: 'object', required: ['iban'], properties: { iban: { type: 'string' } } },
          creditorAccount: { type: 'object', required: ['iban'], properties: { iban: { type: 'string' } } },
          creditorName: { type: 'string' },
          instructedAmount: {
            type: 'object',
            required: ['currency', 'amount'],
            properties: {
              currency: { type: 'string' },
              amount: { type: 'string', description: 'Decimal string per ISO 20022, not a number.' },
            },
          },
          remittanceInformationUnstructured: { type: 'string', maxLength: 140 },
          endToEndIdentification: { type: 'string', maxLength: 35 },
          startDate: { type: 'string', description: 'YYYY-MM-DD. The first collection is on or after this.' },
          endDate: { type: 'string', description: 'YYYY-MM-DD. Absent means open-ended.' },
          frequency: { type: 'string', enum: PERIODIC_FREQUENCIES },
          executionRule: { type: 'string', enum: ['following', 'preceding'], description: 'Where a weekend moves to.' },
          dayOfExecution: { type: 'integer', minimum: 1, maximum: 31 },
        },
      },
      response: { 201: ORDER_RESPONSE, 400: ERROR, 401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR },
    },
  }, async (request, reply) => {
    const authorised = await authorise(fastify, request, reply);
    if (!authorised) return reply;

    const { paymentProduct } = request.params as { paymentProduct: PaymentProduct };
    const body = request.body as {
      debtorAccount: { iban: string };
      creditorAccount: { iban: string };
      creditorName: string;
      instructedAmount: { currency: string; amount: string };
      remittanceInformationUnstructured?: string;
      endToEndIdentification?: string;
      startDate: string;
      endDate?: string;
      frequency: string;
      executionRule?: string;
      dayOfExecution?: number;
    };

    // The stored outcome is a status plus a body, so a replay answers exactly as the first attempt did
    // rather than being re-derived from a record that may have moved on since.
    const create = async () => {
      const result = await createPeriodicPayment(fastify.db, {
        paymentProduct,
        tppClientId: request.tpp!.clientId,
        consentReference: authorised.consentId,
        permittedAccountReferences: authorised.permittedAccounts,
        debtorIban: body.debtorAccount?.iban,
        creditorIban: body.creditorAccount?.iban,
        creditorName: body.creditorName,
        amount: Number.parseFloat(body.instructedAmount?.amount ?? ''),
        currency: body.instructedAmount?.currency,
        remittanceInformation: body.remittanceInformationUnstructured,
        endToEndIdentification: body.endToEndIdentification,
        startDate: body.startDate,
        endDate: body.endDate,
        frequency: body.frequency,
        executionRule: body.executionRule,
        dayOfExecution: body.dayOfExecution,
        correlationId: request.correlationId,
      });
      return result.ok
        ? { status: 201, body: toBerlinGroupPeriodicPayment(result.order) }
        : { status: result.status, body: messages(result.code, result.text) };
    };

    // Keyed on the correlation id, as the single payment is: a retried creation must not leave two standing
    // orders collecting the same money.
    const outcome = await runIdempotent(fastify.db, `periodic:${request.correlationId}`, create);
    if (outcome.kind === 'in_progress') {
      return reply.status(409).send(messages(
        'RESOURCE_BLOCKED', 'A standing order with this X-Request-ID is already being created',
      ));
    }
    return reply.status(outcome.outcome.status as 201).send(outcome.outcome.body);
  });

  // ── GET /v1/periodic-payments/{payment-product}/{paymentId} ──────────────────────────────────
  fastify.get('/periodic-payments/:paymentProduct/:paymentId', {
    preValidation: requireTpp('payments', 'PISP'),
    schema: {
      tags: ['payments'],
      summary: 'Read a standing order',
      description:
        'The order as it stands, including the next date it will collect and how many times it has. Scoped to '
        + 'the third party that created it: another one\'s order is not found rather than refused, so this '
        + 'cannot be used to discover that a reference exists.',
      security: [{ tppToken: [] }],
      headers: CONSENT_SCOPED_HEADERS,
      params: {
        type: 'object',
        required: ['paymentProduct', 'paymentId'],
        properties: { paymentProduct: { type: 'string' }, paymentId: { type: 'string' } },
      },
      response: { 200: ORDER_RESPONSE, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    const order = await findPeriodicPayment(fastify.db, paymentId, request.tpp!.clientId);
    if (!order) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such standing order'));
    return toBerlinGroupPeriodicPayment(order);
  });

  // ── GET /v1/periodic-payments/{payment-product}/{paymentId}/status ───────────────────────────
  fastify.get('/periodic-payments/:paymentProduct/:paymentId/status', {
    preValidation: requireTpp('payments', 'PISP'),
    schema: {
      tags: ['payments'],
      summary: 'Read the status of a standing order',
      description:
        'The order\'s own status, which is not the same question as the status of any one collection: an '
        + 'active order can have had a failed execution, and a single status field could not say both. The '
        + 'per-execution outcomes are on the resource.',
      security: [{ tppToken: [] }],
      headers: CONSENT_SCOPED_HEADERS,
      params: {
        type: 'object',
        required: ['paymentProduct', 'paymentId'],
        properties: { paymentProduct: { type: 'string' }, paymentId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            transactionStatus: { type: 'string' },
            periodicPaymentStatus: { type: 'string', description: 'active, suspended, cancelled or completed.' },
            nextExecutionDate: { type: 'string' },
            executionCount: { type: 'integer' },
          },
        },
        401: ERROR, 403: ERROR, 404: ERROR,
      },
    },
  }, async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    const order = await findPeriodicPayment(fastify.db, paymentId, request.tpp!.clientId);
    if (!order) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such standing order'));
    return {
      transactionStatus: order.transactionStatus,
      periodicPaymentStatus: order.periodicPaymentStatus,
      nextExecutionDate: order.periodicNextExecutionDate,
      executionCount: order.periodicExecutions.length,
    };
  });

  // ── DELETE /v1/periodic-payments/{payment-product}/{paymentId} ───────────────────────────────
  fastify.delete('/periodic-payments/:paymentProduct/:paymentId', {
    preValidation: requireTpp('payments', 'PISP'),
    schema: {
      tags: ['payments'],
      summary: 'Cancel a standing order',
      description:
        'Stops future collections. Executions already presented are untouched, because only the future is '
        + 'revocable: unlike a single payment there is no point of no return for the ORDER, just for each '
        + 'collection it has already made.',
      security: [{ tppToken: [] }],
      headers: CONSENT_SCOPED_HEADERS,
      params: {
        type: 'object',
        required: ['paymentProduct', 'paymentId'],
        properties: { paymentProduct: { type: 'string' }, paymentId: { type: 'string' } },
      },
      response: { 200: ORDER_RESPONSE, 401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR },
    },
  }, async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    const order = await findPeriodicPayment(fastify.db, paymentId, request.tpp!.clientId);
    if (!order) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such standing order'));

    const cancelled = await cancelPeriodicPayment(fastify.db, order);
    if (!cancelled.ok) return reply.status(409).send(messages('CANCELLATION_INVALID', cancelled.reason));
    return toBerlinGroupPeriodicPayment(cancelled.order);
  });
}
