import { FastifyInstance } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import {
  createConsent, findConsent, changeConsentStatus, toBerlinGroupConsent,
} from '../services/consent.service';

// Berlin Group NextGenPSD2 consent endpoints. This is the resource the whole AIS and PIS surface hangs
// off: without a consent in `valid`, nothing else at this bank answers with data.
//
// `additionalProperties: true` on the error shapes is not laziness: a strict response schema silently
// DROPS what it does not declare, and this platform has already shipped an empty error body that way.
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

const ACCOUNT_LIST = {
  type: 'array',
  items: { type: 'object', additionalProperties: true, properties: { iban: { type: 'string' } } },
} as const;

const CONSENT_RESOURCE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    consentId: { type: 'string' },
    consentStatus: { type: 'string' },
    access: {
      type: 'object',
      additionalProperties: true,
      properties: { accounts: ACCOUNT_LIST, balances: ACCOUNT_LIST, transactions: ACCOUNT_LIST },
    },
    recurringIndicator: { type: 'boolean' },
    validUntil: { type: 'string' },
    frequencyPerDay: { type: 'integer' },
    lastActionDate: { type: 'string' },
  },
} as const;

const STATUS_DESCRIPTION =
  'Berlin Group `consentStatus`: `received` (created, not yet usable), `valid` (usable), `rejected`, '
  + '`revokedByPsu`, `expired`, `terminatedByTpp`. A client must switch on this enumeration and treat '
  + 'anything it does not recognise as unusable.';

function messages(code: string, text: string) {
  return { tppMessages: [{ category: 'ERROR', code, text }] };
}

export async function consentController(fastify: FastifyInstance) {
  // ── POST /v1/consents ────────────────────────────────────────────────────────────────────────
  fastify.post('/consents', {
    preValidation: requireTpp('accounts', 'AISP'),
    schema: {
      tags: ['consent'],
      summary: 'Create an account access consent',
      description:
        'Berlin Group AIS consent. The access object names the accounts by IBAN; omitting the balance or '
        + 'transaction lists grants those over the same accounts. The landing status depends on the bank\'s '
        + 'consent mode: `automatic` lands `valid` because the requesting TPP is registered, `manual` lands '
        + '`received` until an operator authorises it. **No SCA is performed, deliberately**, and the '
        + 'transition records its reason so that is visible rather than implicit.\n\n'
        + 'A consent covers the accounts of one account holder; mixing holders has no meaning under the '
        + 'standard and is refused.',
      security: [{ tppToken: [] }],
      body: {
        type: 'object',
        required: ['access'],
        properties: {
          access: {
            type: 'object',
            properties: { accounts: ACCOUNT_LIST, balances: ACCOUNT_LIST, transactions: ACCOUNT_LIST },
          },
          recurringIndicator: { type: 'boolean' },
          validUntil: { type: 'string', description: 'ISO date. Defaults to one year out.' },
          frequencyPerDay: { type: 'integer', minimum: 1 },
          combinedServiceIndicator: { type: 'boolean' },
        },
      },
      response: {
        201: {
          type: 'object',
          additionalProperties: true,
          properties: {
            consentId: { type: 'string' },
            consentStatus: { type: 'string', description: STATUS_DESCRIPTION },
            _links: { type: 'object', additionalProperties: true },
          },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      access?: { accounts?: Array<{ iban?: string }>; balances?: Array<{ iban?: string }>; transactions?: Array<{ iban?: string }> };
      recurringIndicator?: boolean;
      validUntil?: string;
      frequencyPerDay?: number;
    };
    const ibans = (list?: Array<{ iban?: string }>) => (list ?? [])
      .map((entry) => entry.iban)
      .filter((iban): iban is string => Boolean(iban));

    const result = await createConsent(fastify.db, {
      tppClientId: request.tpp!.clientId,
      accountIbans: ibans(body.access?.accounts),
      balanceIbans: ibans(body.access?.balances),
      transactionIbans: ibans(body.access?.transactions),
      recurringIndicator: body.recurringIndicator,
      frequencyPerDay: body.frequencyPerDay,
      validUntil: body.validUntil,
    });
    if (!result.ok) return reply.status(400).send(messages(result.code, result.text));

    const consentId = result.consent.bankConsentAgreementInstanceReference;
    return reply.status(201).send({
      consentId,
      consentStatus: result.consent.bankConsentStatus,
      // The standard's own links, so a client follows them instead of building paths.
      _links: {
        self: { href: `/v1/consents/${consentId}` },
        status: { href: `/v1/consents/${consentId}/status` },
        account: { href: '/v1/accounts' },
      },
    });
  });

  // ── GET /v1/consents/{consentId} ─────────────────────────────────────────────────────────────
  fastify.get('/consents/:consentId', {
    preValidation: requireTpp('accounts', 'AISP'),
    schema: {
      tags: ['consent'],
      summary: 'Read a consent',
      description:
        'Berlin Group AIS. Returns the access it grants, its validity and its `consentStatus`. Scoped to '
        + 'the TPP that holds it: another client\'s consent is indistinguishable from one that does not '
        + 'exist, since telling them apart would make this a way to probe for consents.',
      security: [{ tppToken: [] }],
      params: { type: 'object', properties: { consentId: { type: 'string' } }, required: ['consentId'] },
      response: { 200: CONSENT_RESOURCE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE },
    },
  }, async (request, reply) => {
    const { consentId } = request.params as { consentId: string };
    const consent = await findConsent(fastify.db, consentId, request.tpp!.clientId);
    if (!consent) return reply.status(404).send(messages('CONSENT_UNKNOWN', 'No such consent for this client'));
    return toBerlinGroupConsent(fastify.db, consent);
  });

  // ── GET /v1/consents/{consentId}/status ──────────────────────────────────────────────────────
  fastify.get('/consents/:consentId/status', {
    preValidation: requireTpp('accounts', 'AISP'),
    schema: {
      tags: ['consent'],
      summary: 'Read the status of a consent',
      description:
        'Berlin Group AIS. The specification\'s own polling fallback for a missed status notification, '
        + 'which is why it exists as a separate endpoint from the consent itself: a client checking '
        + '"is it usable yet" should not have to read the whole resource.\n\n'
        + STATUS_DESCRIPTION,
      security: [{ tppToken: [] }],
      params: { type: 'object', properties: { consentId: { type: 'string' } }, required: ['consentId'] },
      response: {
        200: { type: 'object', additionalProperties: true, properties: { consentStatus: { type: 'string' } } },
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { consentId } = request.params as { consentId: string };
    const consent = await findConsent(fastify.db, consentId, request.tpp!.clientId);
    if (!consent) return reply.status(404).send(messages('CONSENT_UNKNOWN', 'No such consent for this client'));
    return { consentStatus: consent.bankConsentStatus };
  });

  // ── DELETE /v1/consents/{consentId} ──────────────────────────────────────────────────────────
  fastify.delete('/consents/:consentId', {
    preValidation: requireTpp('accounts', 'AISP'),
    schema: {
      tags: ['consent'],
      summary: 'Terminate a consent',
      description:
        'Berlin Group AIS. Sets `consentStatus` to `terminatedByTpp`, which is the status the standard '
        + 'defines for the TPP withdrawing its own access. A revocation by the account holder is a '
        + 'different status (`revokedByPsu`) reached from the bank side, not through this endpoint.',
      security: [{ tppToken: [] }],
      params: { type: 'object', properties: { consentId: { type: 'string' } }, required: ['consentId'] },
      response: {
        204: { type: 'null', description: 'Terminated. The consent is no longer usable.' },
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { consentId } = request.params as { consentId: string };
    const consent = await findConsent(fastify.db, consentId, request.tpp!.clientId);
    if (!consent) return reply.status(404).send(messages('CONSENT_UNKNOWN', 'No such consent for this client'));
    await changeConsentStatus(fastify.db, consentId, 'terminatedByTpp', 'terminated_by_tpp');
    return reply.status(204).send();
  });
}
