import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import { resolveConsent } from '../../consent/services/consent.service';
import { ConsentAccessKind } from '../../consent/models/bankConsent.model';
import {
  findAccount, listAccountsForHolder, listTransactions, toBerlinGroupAccount,
} from '../services/accountInformation.service';
import { CONSENT_SCOPED_HEADERS } from '../../../shared/standardHeaders';

// Berlin Group NextGenPSD2 Account Information Service, mounted at /v1.
//
// Every endpoint requires a TPP access token carrying the scope of its operation group and the AISP
// role, plus a consent in `valid` that covers the account being read. The consent is what says WHOSE
// accounts these are, so there is no holder parameter: a caller cannot name the account holder, and a
// read is scoped to whoever the consent belongs to.
//
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

const CONSENT_NOTE =
  'Requires a consent in `valid` covering this account. A consent that is unknown, not valid, expired '
  + 'or does not cover the account is refused: enforcement fails closed, so a status this bank does not '
  + 'recognise is treated as unusable rather than assumed benign.';

function consentIdOf(request: { headers: Record<string, unknown> }): string | undefined {
  const value = request.headers['consent-id'];
  return Array.isArray(value) ? String(value[0]) : (value as string | undefined);
}

/**
 * Resolves the consent for a request, answering the standard refusal itself when it does not hold.
 * Returns undefined once a reply has been sent, so a handler cannot continue by accident.
 */
async function authorise(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  kind: ConsentAccessKind,
  accountReference?: string,
): Promise<{ holderReference: string; permittedAccounts: string[] } | undefined> {
  const consentId = consentIdOf(request as never);
  if (!consentId) {
    reply.status(400).send({
      tppMessages: [{ category: 'ERROR', code: 'CONSENT_INVALID', text: 'Consent-ID header is required' }],
    });
    return undefined;
  }
  const resolution = await resolveConsent(fastify.db, {
    consentId,
    tppClientId: request.tpp!.clientId,
    kind,
    accountReference,
    correlationId: request.correlationId,
  });
  if (!resolution.ok) {
    const { status, code, text } = resolution.refusal;
    reply.status(status).send({ tppMessages: [{ category: 'ERROR', code, text }] });
    return undefined;
  }
  return {
    holderReference: resolution.consent.bankConsentAccountHolderInstanceReference,
    permittedAccounts: resolution.consent.bankConsentAccess[kind] ?? [],
  };
}

export async function accountInformationController(fastify: FastifyInstance) {
  // ── GET /v1/accounts ─────────────────────────────────────────────────────────────────────────
  fastify.get('/accounts', {
    preValidation: requireTpp('accounts', 'AISP'),
    schema: {
      tags: ['accounts'],
      summary: 'Read the accounts a consent gives access to',
      description:
        'Berlin Group AIS. Scoped to the account holder the consent covers: there is no unscoped list, '
        + 'since that would be a data leak dressed as a convenience, and no holder parameter, since the '
        + 'consent is what identifies the holder. Only the accounts inside the consent are returned. '
        + '`withBalance=true` embeds balances so a caller needs one round trip instead of one per '
        + 'account, and it requires the consent to grant balance access as well.\n\n'
        + CONSENT_NOTE,
      security: [{ tppToken: [] }],
      headers: CONSENT_SCOPED_HEADERS,
      querystring: {
        type: 'object',
        properties: {
          withBalance: { type: 'boolean', description: 'Embed the balances of each account.' },
        },
      },
      response: {
        200: { type: 'object', properties: { accounts: { type: 'array', items: ACCOUNT } } },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { withBalance } = request.query as { withBalance?: boolean };
    // Embedding balances IS balance access, so it is authorised as such rather than riding on the list.
    const authorised = await authorise(fastify, request, reply, withBalance === true ? 'balances' : 'accounts');
    if (!authorised) return reply;

    const permitted = new Set(authorised.permittedAccounts);
    const records = (await listAccountsForHolder(fastify.db, authorised.holderReference))
      // The holder may hold accounts this consent does not cover, and those are not this TPP's to see.
      .filter((record) => permitted.has(record.accountArrangementInstanceReference));
    return { accounts: records.map((record) => toBerlinGroupAccount(record, withBalance === true)) };
  });

  // ── GET /v1/accounts/{accountId} ─────────────────────────────────────────────────────────────
  fastify.get('/accounts/:accountId', {
    preValidation: requireTpp('accounts', 'AISP'),
    schema: {
      tags: ['accounts'],
      summary: 'Read one account',
      description: `Berlin Group AIS. The account detail, including its IBAN and BIC.\n\n${CONSENT_NOTE}`,
      security: [{ tppToken: [] }],
      headers: CONSENT_SCOPED_HEADERS,
      params: { type: 'object', properties: { accountId: { type: 'string' } }, required: ['accountId'] },
      response: {
        200: ACCOUNT, 400: ERROR_RESPONSE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    if (!await authorise(fastify, request, reply, 'accounts', accountId)) return reply;

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
    preValidation: requireTpp('balances', 'AISP'),
    schema: {
      tags: ['accounts'],
      summary: 'Read the balances of an account',
      description:
        'Berlin Group AIS. `interimAvailable` is the spendable figure the PSP projects as its own '
        + 'available amount; `expected` includes what is booked but not settled; `blocked` appears only '
        + 'when something is reserved. Amounts are decimal STRINGS per ISO 20022, since a JSON number '
        + `would lose cents on a large value.\n\n${CONSENT_NOTE}`,
      security: [{ tppToken: [] }],
      headers: CONSENT_SCOPED_HEADERS,
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
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    if (!await authorise(fastify, request, reply, 'balances', accountId)) return reply;

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
    preValidation: requireTpp('transactions', 'AISP'),
    schema: {
      tags: ['accounts'],
      summary: 'Read the movements of an account',
      description:
        'Berlin Group AIS. Each entry carries `endToEndId`, the PSP\'s own payment id, so one query '
        + `correlates a payment across both systems. Debits are negative, per the standard.\n\n${CONSENT_NOTE}`,
      security: [{ tppToken: [] }],
      headers: CONSENT_SCOPED_HEADERS,
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
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    if (!await authorise(fastify, request, reply, 'transactions', accountId)) return reply;

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
