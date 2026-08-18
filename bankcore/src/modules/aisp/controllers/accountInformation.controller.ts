import { FastifyInstance } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import {
  findAccount, listAccountsForHolder, listTransactions, toBerlinGroupAccount,
} from '../services/accountInformation.service';

// Berlin Group NextGenPSD2 Account Information Service, mounted at /v1.
//
// Every endpoint requires a TPP access token carrying the scope of its operation group and the AISP
// role, which the bank issues only through the client credentials grant.
//
// Consent enforcement arrives in P3: the endpoints already require the Consent-ID header the standard
// defines and reject a call without one, so a TPP integrates against the real contract now and only the
// verification behind it deepens. Answering without a consent reference would teach the wrong shape.
// `additionalProperties: true` is not laziness: a strict response schema silently DROPS anything it
// does not declare, and this platform has already shipped an empty error body that way. An error the
// caller cannot read is worse than no schema at all.
const ERROR_RESPONSE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    tppMessages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          category: { type: 'string' },
          code: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
  },
} as const;

const AMOUNT = {
  type: 'object',
  properties: { currency: { type: 'string' }, amount: { type: 'string' } },
} as const;

const ACCOUNT = {
  type: 'object',
  additionalProperties: true,
  properties: {
    resourceId: { type: 'string' },
    iban: { type: 'string' },
    currency: { type: 'string' },
    name: { type: 'string' },
    product: { type: 'string' },
    cashAccountType: { type: 'string' },
    status: { type: 'string' },
    bic: { type: 'string' },
  },
} as const;

// The standard's headers. Consent-ID scopes the read, X-Request-ID correlates it end to end.
const STANDARD_HEADERS = {
  type: 'object',
  properties: {
    'consent-id': { type: 'string', description: 'Consent that authorises this access (Berlin Group).' },
    'x-request-id': { type: 'string', description: 'Caller correlation id, echoed on the response.' },
  },
  // Deliberately NOT `required`. Fastify's own header validation answers with its generic
  // {statusCode, error, message} body, which is not the Berlin Group error shape, so a TPP would get a
  // non-standard error for the most common mistake. The handler returns `tppMessages` instead.
} as const;

function consentIdOf(request: { headers: Record<string, unknown> }): string | undefined {
  const value = request.headers['consent-id'];
  return Array.isArray(value) ? String(value[0]) : (value as string | undefined);
}

export async function accountInformationController(fastify: FastifyInstance) {
  // ── GET /v1/accounts ─────────────────────────────────────────────────────────────────────────
  fastify.get('/accounts', {
    preHandler: requireTpp('accounts', 'AISP'),
    schema: {
      tags: ['accounts'],
      summary: 'Read the accounts a consent gives access to',
      description:
        'Berlin Group AIS. Scoped to the account holder the consent covers: there is no unscoped list, '
        + 'since that would be a data leak dressed as a convenience. `withBalance=true` embeds balances '
        + 'so a caller needs one round trip instead of one per account.',
      security: [{ tppToken: [] }],
      headers: STANDARD_HEADERS,
      querystring: {
        type: 'object',
        properties: {
          withBalance: { type: 'boolean', description: 'Embed the balances of each account.' },
          holderId: { type: 'string', description: 'Account holder at this bank. Derived from the consent once P3 lands.' },
        },
      },
      response: {
        200: { type: 'object', properties: { accounts: { type: 'array', items: ACCOUNT } } },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const consentId = consentIdOf(request as never);
    if (!consentId) {
      return reply.status(400).send({
        tppMessages: [{ category: 'ERROR', code: 'CONSENT_INVALID', text: 'Consent-ID header is required' }],
      });
    }
    const { withBalance, holderId } = request.query as { withBalance?: boolean; holderId?: string };
    if (!holderId) {
      return reply.status(400).send({
        tppMessages: [{ category: 'ERROR', code: 'PARAMETER_NOT_SUPPORTED', text: 'holderId is required until consent resolution lands (P3)' }],
      });
    }
    const records = await listAccountsForHolder(fastify.db, holderId);
    return { accounts: records.map((record) => toBerlinGroupAccount(record, withBalance === true)) };
  });

  // ── GET /v1/accounts/{accountId} ─────────────────────────────────────────────────────────────
  fastify.get('/accounts/:accountId', {
    preHandler: requireTpp('accounts', 'AISP'),
    schema: {
      tags: ['accounts'],
      summary: 'Read one account',
      description: 'Berlin Group AIS. The account detail, including its IBAN and BIC.',
      security: [{ tppToken: [] }],
      headers: STANDARD_HEADERS,
      params: { type: 'object', properties: { accountId: { type: 'string' } }, required: ['accountId'] },
      response: { 200: ACCOUNT, 400: ERROR_RESPONSE, 401: ERROR_RESPONSE, 404: ERROR_RESPONSE },
    },
  }, async (request, reply) => {
    if (!consentIdOf(request as never)) {
      return reply.status(400).send({
        tppMessages: [{ category: 'ERROR', code: 'CONSENT_INVALID', text: 'Consent-ID header is required' }],
      });
    }
    const { accountId } = request.params as { accountId: string };
    const record = await findAccount(fastify.db, accountId);
    if (!record) {
      return reply.status(404).send({
        tppMessages: [{ category: 'ERROR', code: 'RESOURCE_UNKNOWN', text: 'No such account' }],
      });
    }
    return toBerlinGroupAccount(record);
  });

  // ── GET /v1/accounts/{accountId}/balances ────────────────────────────────────────────────────
  fastify.get('/accounts/:accountId/balances', {
    preHandler: requireTpp('balances', 'AISP'),
    schema: {
      tags: ['accounts'],
      summary: 'Read the balances of an account',
      description:
        'Berlin Group AIS. `interimAvailable` is the spendable figure the PSP projects as its own '
        + 'available amount; `expected` includes what is booked but not settled; `blocked` appears only '
        + 'when something is reserved. Amounts are decimal STRINGS per ISO 20022, since a JSON number '
        + 'would lose cents on a large value.',
      security: [{ tppToken: [] }],
      headers: STANDARD_HEADERS,
      params: { type: 'object', properties: { accountId: { type: 'string' } }, required: ['accountId'] },
      response: {
        200: {
          type: 'object',
          properties: {
            account: { type: 'object', properties: { iban: { type: 'string' }, resourceId: { type: 'string' } } },
            balances: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  balanceAmount: AMOUNT,
                  balanceType: { type: 'string' },
                  lastChangeDateTime: { type: 'string' },
                },
              },
            },
          },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    if (!consentIdOf(request as never)) {
      return reply.status(400).send({
        tppMessages: [{ category: 'ERROR', code: 'CONSENT_INVALID', text: 'Consent-ID header is required' }],
      });
    }
    const { accountId } = request.params as { accountId: string };
    const record = await findAccount(fastify.db, accountId);
    if (!record) {
      return reply.status(404).send({
        tppMessages: [{ category: 'ERROR', code: 'RESOURCE_UNKNOWN', text: 'No such account' }],
      });
    }
    const account = toBerlinGroupAccount(record, true);
    return {
      account: { iban: account.iban, resourceId: account.resourceId },
      balances: account.balances ?? [],
    };
  });

  // ── GET /v1/accounts/{accountId}/transactions ────────────────────────────────────────────────
  fastify.get('/accounts/:accountId/transactions', {
    preHandler: requireTpp('transactions', 'AISP'),
    schema: {
      tags: ['accounts'],
      summary: 'Read the movements of an account',
      description:
        'Berlin Group AIS. Each entry carries `endToEndId`, the PSP\'s own payment id, so one query '
        + 'correlates a payment across both systems. Debits are negative, per the standard.',
      security: [{ tppToken: [] }],
      headers: STANDARD_HEADERS,
      params: { type: 'object', properties: { accountId: { type: 'string' } }, required: ['accountId'] },
      querystring: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            account: { type: 'object', properties: { iban: { type: 'string' }, resourceId: { type: 'string' } } },
            transactions: {
              type: 'object',
              properties: { booked: { type: 'array', items: { type: 'object', additionalProperties: true } } },
            },
          },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    if (!consentIdOf(request as never)) {
      return reply.status(400).send({
        tppMessages: [{ category: 'ERROR', code: 'CONSENT_INVALID', text: 'Consent-ID header is required' }],
      });
    }
    const { accountId } = request.params as { accountId: string };
    const record = await findAccount(fastify.db, accountId);
    if (!record) {
      return reply.status(404).send({
        tppMessages: [{ category: 'ERROR', code: 'RESOURCE_UNKNOWN', text: 'No such account' }],
      });
    }
    const query = request.query as { dateFrom?: string; dateTo?: string; limit?: number };
    const booked = await listTransactions(fastify.db, accountId, query);
    return {
      account: { iban: record.accountIban, resourceId: record.accountArrangementInstanceReference },
      transactions: { booked },
    };
  });
}
