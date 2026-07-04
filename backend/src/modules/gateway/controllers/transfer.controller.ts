// v17.1 BIAN SD-65/66: Bank transfer REST controller (ACH / SEPA / SWIFT).
// Routes mounted at /gateway/transfers → /api/v1/gateway/transfers
//   POST /preview  → stateless rail derivation + validation + fee quote (no side effects)
//   POST /bank     → execute a transfer to a registered or unregistered external account
// Auth: JWT bearer + RBAC (beneficiaries:view / beneficiaries:manage). Customer scope.

import { FastifyInstance } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { requirePermission } from '../../../vendors/middleware/acl';
import { previewBankTransfer, executeBankTransfer } from '../services/bankTransfer.service';
import type { BankRail, RailDestination } from '../../../shared/services/bankTransfer';

function getUser(request: unknown): JwtUserPayload | undefined {
  return (request as { user?: JwtUserPayload }).user;
}

const destinationSchema = {
  type: 'object',
  required: ['countryCode', 'currency'],
  properties: {
    countryCode: { type: 'string', minLength: 2, maxLength: 2 },
    currency: { type: 'string', minLength: 3, maxLength: 3 },
    iban: { type: 'string' },
    accountNumber: { type: 'string' },
    routingNumber: { type: 'string' },
    bic: { type: 'string' },
    correspondentBic: { type: 'string' },
  },
} as const;

interface PreviewBody { destination: RailDestination; amountCurrency?: string; rail?: BankRail }
interface ExecuteBody {
  amount: number; currency: string; destination: RailDestination;
  rail?: BankRail; reference?: string; settlementSchedule?: 'T+0' | 'T+1' | 'T+2' | 'T+3';
}

export async function transferController(fastify: FastifyInstance) {

  // POST /api/v1/gateway/transfers/preview — derive rail, validate, quote fee.
  fastify.post('/preview', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['transfers'],
      summary: 'Preview a bank transfer: derive rail, validate details, quote fee (SD-65/66)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['destination'],
        properties: { destination: destinationSchema, amountCurrency: { type: 'string' }, rail: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const body = request.body as PreviewBody;
    const result = previewBankTransfer(body.destination, body.amountCurrency ?? body.destination.currency, body.rail);
    return reply.send(result);
  });

  // POST /api/v1/gateway/transfers/bank — execute the transfer via the payment_initiation provider.
  fastify.post('/bank', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: {
      tags: ['transfers'],
      summary: 'Execute a bank transfer to an external account (ACH/SEPA/SWIFT) (SD-65/66)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['amount', 'currency', 'destination'],
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          destination: destinationSchema,
          rail: { type: 'string' },
          reference: { type: 'string', maxLength: 140 },
          settlementSchedule: { type: 'string', enum: ['T+0', 'T+1', 'T+2', 'T+3'] },
        },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    if (!user?.partyRef) return reply.code(401).send({ error: 'Unauthenticated' });
    const body = request.body as ExecuteBody;
    const result = await executeBankTransfer(fastify.db, {
      initiatorPartyRef: user.partyRef,
      amount: body.amount,
      currency: body.currency,
      destination: body.destination,
      rail: body.rail,
      reference: body.reference,
      settlementSchedule: body.settlementSchedule,
    });
    const code = result.status === 'submitted' ? 202 : 422;
    return reply.code(code).send(result);
  });
}
