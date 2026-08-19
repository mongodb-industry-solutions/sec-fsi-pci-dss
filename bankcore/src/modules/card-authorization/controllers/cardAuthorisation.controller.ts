import { FastifyInstance } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import { resolveConsent, recordAccess } from '../../consent/services/consent.service';
import { findAccount } from '../../aisp/services/accountInformation.service';
import { reserve, release, settleReservation } from '../../aspsp/services/ledger.service';
import { findIssuedCard, judgeCardForAuthorisation } from '../../card-issuer/services/cardLifecycle.service';

// The issuer's authorisation hold: the operation a card authorisation actually is.
//
// **Why this exists before the rest of P7.** Once the ledger lives here, the balance on the PSP side is a
// projection, so the PSP's old atomic hold would mutate a figure that is no longer authoritative and decide
// on stale data. A funds CONFIRMATION cannot replace it either: a yes/no is not a hold, and two concurrent
// authorisations would both pass it. So the hold has to be where the money is.
//
// ISO 8583 response codes, not an HTTP-shaped answer: this is the card rail's own vocabulary and the PSP
// already speaks it. Berlin Group has nothing to say here, which is why this is not on the AIS/PIS surface.
const RESPONSE_APPROVED = '00';
const RESPONSE_INSUFFICIENT_FUNDS = '51';
const RESPONSE_INVALID_ACCOUNT = '14';
const RESPONSE_INVALID_TRANSACTION = '12';

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

const AUTHORISATION_RESPONSE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    responseCode: { type: 'string', description: 'ISO 8583: 00 approved, 51 insufficient funds, 14 invalid account, 12 invalid transaction, 54 expired card, 61 exceeds limit, 62 restricted card.' },
    approved: { type: 'boolean' },
    authorisationReference: { type: 'string', description: 'The hold, quoted when it is released or settled.' },
    heldAmount: { type: 'string', description: 'Decimal string per ISO 20022.' },
    currency: { type: 'string' },
  },
} as const;

function messages(code: string, text: string) {
  return { tppMessages: [{ category: 'ERROR', code, text }] };
}

function declined(responseCode: string) {
  return { responseCode, approved: false };
}

export async function cardAuthorisationController(fastify: FastifyInstance) {
  // ── POST /v1/cards/authorisations ────────────────────────────────────────────────────────────
  fastify.post('/cards/authorisations', {
    preValidation: requireTpp('card-authorisations', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Authorise a card transaction against the funding account',
      description:
        'Places an atomic HOLD on the funding account and answers with an ISO 8583 response code. This is '
        + 'what a card authorisation is at the issuer, and it is deliberately not a funds confirmation: a '
        + 'yes/no is not a hold, and two concurrent authorisations would both pass one.\n\n'
        + 'The hold is a single conditional update with the guard inside the filter, so two concurrent '
        + 'authorisations cannot both succeed against the same balance.\n\n'
        + '**The card itself is not resolved here yet.** The issuer vault and the card registry arrive with '
        + 'the rest of the card issuing move, so for now the funding account is named directly and '
        + '`cardToken` is carried for the audit trail only. The response shape does not change when they '
        + 'land: what changes is that the token, rather than the caller, will name the account.',
      security: [{ tppToken: [] }],
      headers: {
        type: 'object',
        properties: {
          'consent-id': { type: 'string', description: 'Consent covering the funding account.' },
          'x-request-id': { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['fundingAccount', 'instructedAmount'],
        properties: {
          fundingAccount: {
            type: 'object',
            properties: {
              resourceId: { type: 'string', description: "The bank's own account reference." },
            },
          },
          instructedAmount: {
            type: 'object',
            required: ['currency', 'amount'],
            properties: {
              currency: { type: 'string' },
              amount: { type: 'string', description: 'Decimal string, e.g. "40.00".' },
            },
          },
          cardToken: { type: 'string', description: 'Acceptance-side token, for the trail. Never a PAN.' },
          transactionType: { type: 'string', description: 'purchase, cash_advance or fee.' },
          clientReference: { type: 'string', description: "The caller's transaction id, kept on the movement." },
        },
      },
      response: {
        200: AUTHORISATION_RESPONSE,
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const consentIdHeader = request.headers['consent-id'];
    const consentId = Array.isArray(consentIdHeader) ? consentIdHeader[0] : consentIdHeader;
    if (!consentId) return reply.status(400).send(messages('CONSENT_INVALID', 'Consent-ID header is required'));

    const body = request.body as {
      fundingAccount?: { resourceId?: string };
      instructedAmount?: { currency?: string; amount?: unknown };
      cardToken?: string;
      transactionType?: string;
      clientReference?: string;
    };
    const accountRef = body.fundingAccount?.resourceId ?? '';
    const amount = Number.parseFloat(String(body.instructedAmount?.amount ?? ''));
    const currency = body.instructedAmount?.currency ?? '';
    if (!accountRef || !Number.isFinite(amount) || amount <= 0 || !currency) {
      // An invalid instruction is `12`, not a decline: the difference matters to whoever reads the trail.
      return reply.status(200).send(declined(RESPONSE_INVALID_TRANSACTION));
    }

    // The same consent gate as every other operation, with balance access: a hold is a decision about a
    // balance, so it is authorised like one.
    const resolution = await resolveConsent(fastify.db, {
      consentId,
      tppClientId: request.tpp!.clientId,
      kind: 'balances',
      accountReference: accountRef,
      correlationId: request.correlationId,
    });
    if (!resolution.ok) {
      const { status, code, text } = resolution.refusal;
      return reply.status(status).send(messages(code, text));
    }

    // The card first, and only then the money: a blocked card, an expired one or one over its limit is a
    // refusal about the CARD, and reserving funds before finding that out would hold money for nothing.
    // An unknown token is not refused here, so a card this bank never issued is judged on the account alone.
    if (body.cardToken) {
      const refusal = judgeCardForAuthorisation(
        await findIssuedCard(fastify.db, body.cardToken), amount, currency,
      );
      if (refusal) return reply.status(200).send(declined(refusal.code));
    }

    const account = await findAccount(fastify.db, accountRef);
    if (!account || account.accountStatus !== 'active' || account.accountCurrency !== currency) {
      // One code for all three: an authorisation response is not a diagnostic channel, and telling a
      // caller which of them it was would disclose the account's state and currency.
      return reply.status(200).send(declined(RESPONSE_INVALID_ACCOUNT));
    }

    const correlationId = body.clientReference ?? request.correlationId;
    const held = await reserve(fastify.db, { accountRef, amount, currency, correlationId,
      remittanceInformation: body.cardToken ? `card ${body.cardToken}` : 'card authorisation' });

    await recordAccess(fastify.db, {
      bankConsentAgreementInstanceReference: consentId,
      bankConsentTppClientId: request.tpp!.clientId,
      accessedAccountReference: accountRef,
      accessedResourceKind: 'balances',
      accessDecision: 'granted',
      accessDecisionReason: `card_authorisation: ${held.applied ? 'approved' : held.reason ?? 'declined'}`,
      accessCorrelationId: correlationId,
    });

    if (!held.applied) {
      // The ledger's own reason, mapped to the rail's vocabulary: an account that vanished between the
      // read and the hold is `14`, anything else at this point is a funds decline.
      return reply.status(200).send(declined(
        held.reason === 'account_not_found_or_inactive' ? RESPONSE_INVALID_ACCOUNT : RESPONSE_INSUFFICIENT_FUNDS,
      ));
    }
    return {
      responseCode: RESPONSE_APPROVED,
      approved: true,
      // The hold is identified by the correlation id it was recorded under, which is what a release or a
      // settlement quotes. No second identifier to keep in step.
      authorisationReference: correlationId,
      heldAmount: amount.toFixed(2),
      currency,
    };
  });

  // ── DELETE /v1/cards/authorisations/{authorisationReference} ─────────────────────────────────
  fastify.delete('/cards/authorisations/:authorisationReference', {
    preValidation: requireTpp('card-authorisations', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Release or settle a hold',
      description:
        'Releases the hold back to the available balance, or settles it, which turns the reservation into a '
        + 'real debit. Both are the compensating halves of the authorisation: a hold that is neither '
        + 'released nor settled would strand a customer\'s money, which is the failure this endpoint exists '
        + 'to prevent.\n\n'
        + 'The amount is required because a hold is identified by the reference it was placed under, and a '
        + 'partial settlement is a normal card outcome (a lower final amount than the authorisation).',
      security: [{ tppToken: [] }],
      headers: {
        type: 'object',
        properties: { 'consent-id': { type: 'string' }, 'x-request-id': { type: 'string' } },
      },
      params: {
        type: 'object',
        required: ['authorisationReference'],
        properties: { authorisationReference: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['fundingAccount', 'instructedAmount', 'disposition'],
        properties: {
          fundingAccount: { type: 'object', properties: { resourceId: { type: 'string' } } },
          instructedAmount: {
            type: 'object',
            required: ['currency', 'amount'],
            properties: { currency: { type: 'string' }, amount: { type: 'string' } },
          },
          disposition: { type: 'string', description: '`release` returns the funds, `settle` debits them.' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: { applied: { type: 'boolean' }, disposition: { type: 'string' }, reason: { type: 'string' } },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const consentIdHeader = request.headers['consent-id'];
    const consentId = Array.isArray(consentIdHeader) ? consentIdHeader[0] : consentIdHeader;
    if (!consentId) return reply.status(400).send(messages('CONSENT_INVALID', 'Consent-ID header is required'));

    const { authorisationReference } = request.params as { authorisationReference: string };
    const body = request.body as {
      fundingAccount?: { resourceId?: string };
      instructedAmount?: { currency?: string; amount?: unknown };
      disposition?: string;
    };
    const accountRef = body.fundingAccount?.resourceId ?? '';
    const amount = Number.parseFloat(String(body.instructedAmount?.amount ?? ''));
    const currency = body.instructedAmount?.currency ?? '';
    const disposition = body.disposition === 'settle' ? 'settle' : 'release';
    if (!accountRef || !Number.isFinite(amount) || amount <= 0) {
      return reply.status(400).send(messages('FORMAT_ERROR', 'fundingAccount and a positive instructedAmount are required'));
    }

    const resolution = await resolveConsent(fastify.db, {
      consentId,
      tppClientId: request.tpp!.clientId,
      kind: 'balances',
      accountReference: accountRef,
      correlationId: request.correlationId,
    });
    if (!resolution.ok) {
      const { status, code, text } = resolution.refusal;
      return reply.status(status).send(messages(code, text));
    }

    const operation = { accountRef, amount, currency, correlationId: authorisationReference };
    const result = disposition === 'settle'
      ? await settleReservation(fastify.db, operation)
      : await release(fastify.db, operation);
    return { applied: result.applied, disposition, reason: result.reason };
  });
}
