import { FastifyInstance } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import { resolveConsent, recordAccess } from '../../consent/services/consent.service';
import { confirmFunds } from '../services/fundsConfirmation.service';

// Berlin Group / PSD2 confirmation of funds, the gate a card authorisation or a transfer is checked
// against. The caller is acting as CBPII here, which is a different PSD2 role from reading accounts, so
// the role is enforced as well as the scope.
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

function messages(code: string, text: string) {
  return { tppMessages: [{ category: 'ERROR', code, text }] };
}

// `preValidation`, not `preHandler`: validation runs between them, so authorisation has to come first or
// an unauthenticated caller is answered about the body format instead of being refused.
export async function fundsConfirmationController(fastify: FastifyInstance) {
  fastify.post('/funds-confirmations', {
    preValidation: requireTpp('funds-confirmations', 'CBPII'),
    schema: {
      tags: ['payments'],
      summary: 'Confirm whether funds are available',
      description:
        'Berlin Group confirmation of funds. The response is a boolean and nothing else: a party asking '
        + '"are there 40 euros" learns whether there are 40 euros, never the balance, because this is a '
        + 'funds gate and not an account information disclosure.\n\n'
        + 'A currency mismatch and a blocked account are answered as `false` rather than as errors: "no" is '
        + 'the honest answer to both, and an error would tell the caller which currency the account is held '
        + 'in.\n\n'
        + '**`cardNumber` is deliberately not accepted**, although the specification allows it as an '
        + 'alternative to an account. A PAN in a request body would put this endpoint inside cardholder '
        + 'data scope for no gain, and the card path belongs to the issuer, which holds the only copy of a '
        + 'PAN and resolves its own tokens.\n\n'
        + 'Requires the CBPII role and a consent in `valid` covering the account. The consent requirement '
        + 'is the balance access one: a yes/no derived from a balance discloses strictly less than the '
        + 'balance itself, so no separate grant is invented. A production ASPSP would model the dedicated '
        + 'funds confirmation consent the specification defines.',
      security: [{ tppToken: [] }],
      headers: {
        type: 'object',
        properties: {
          'consent-id': { type: 'string', description: 'Consent that authorises this check.' },
          'x-request-id': { type: 'string', description: 'Caller correlation id, echoed on the response.' },
        },
      },
      body: {
        type: 'object',
        required: ['account', 'instructedAmount'],
        properties: {
          account: {
            type: 'object',
            required: ['iban'],
            properties: { iban: { type: 'string' } },
          },
          instructedAmount: {
            type: 'object',
            required: ['currency', 'amount'],
            properties: {
              currency: { type: 'string', description: 'ISO 4217.' },
              amount: { type: 'string', description: 'Decimal string per ISO 20022, e.g. "40.00".' },
            },
          },
          payee: { type: 'string', description: 'Who is being paid, for the audit trail.' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            fundsAvailable: { type: 'boolean', description: 'The whole answer. No amount is disclosed.' },
          },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const consentIdHeader = request.headers['consent-id'];
    const consentId = Array.isArray(consentIdHeader) ? consentIdHeader[0] : consentIdHeader;
    if (!consentId) {
      return reply.status(400).send(messages('CONSENT_INVALID', 'Consent-ID header is required'));
    }

    const resolution = await resolveConsent(fastify.db, {
      consentId,
      tppClientId: request.tpp!.clientId,
      kind: 'balances',
      correlationId: request.correlationId,
    });
    if (!resolution.ok) {
      const { status, code, text } = resolution.refusal;
      return reply.status(status).send(messages(code, text));
    }

    const body = request.body as {
      account?: { iban?: string };
      instructedAmount?: { currency?: string; amount?: unknown };
      payee?: string;
    };
    const amount = Number.parseFloat(String(body.instructedAmount?.amount ?? ''));
    const result = await confirmFunds(fastify.db, {
      accountIban: body.account?.iban ?? '',
      amount,
      currency: body.instructedAmount?.currency ?? '',
      permittedAccountReferences: resolution.consent.bankConsentAccess.balances ?? [],
    });
    if (!result.ok) return reply.status(result.status).send(messages(result.code, result.text));

    // PSD2 evidence: a funds check happened, on which account, and what it answered. The amount is not
    // recorded against the account, since the trail is about access rather than about the balance.
    await recordAccess(fastify.db, {
      bankConsentAgreementInstanceReference: consentId,
      bankConsentTppClientId: request.tpp!.clientId,
      accessedAccountReference: result.accountReference,
      accessedResourceKind: 'balances',
      accessDecision: 'granted',
      accessDecisionReason: `funds_confirmation: ${result.fundsAvailable ? 'available' : 'unavailable'}`,
      accessCorrelationId: request.correlationId,
    });

    return { fundsAvailable: result.fundsAvailable };
  });
}
