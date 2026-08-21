import { FastifyInstance } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import {
  ISSUED_CARD_REGISTRY_COLLECTION, IssuedCardRegistryRecord,
  CARD_ISSUER_VAULT_COLLECTION, CardIssuerVaultRecord,
} from '../models/cardIssuerVault.model';
import { cardIssuerConfig, detectNetwork, validateCard } from '../services/cardValidation.service';
import { deriveCvvForCard } from '../services/cardCvv.service';
import {
  issueCard, changeCardStatus, renewCard, replaceCard, setCardLimits, findIssuedCard,
} from '../services/cardLifecycle.service';

// The issuer's card API. A CVV is compared and discarded; a PAN leaves only through the reveal endpoint.
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

const CARD_RESPONSE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    cardToken: { type: 'string' },
    network: { type: 'string' },
    bin: { type: 'string' },
    lastFour: { type: 'string' },
    maskedDisplay: { type: 'string' },
    status: { type: 'string', description: 'issued, active, suspended or revoked.' },
    expiryMonth: { type: 'string' },
    expiryYear: { type: 'string' },
    limits: {
      type: 'object',
      additionalProperties: true,
      properties: { perTransactionAmount: { type: 'number' }, limitCurrency: { type: 'string' } },
    },
  },
} as const;

const EXPIRY = {
  type: 'object',
  properties: {
    expiryMonth: { type: 'string', description: 'MM.' },
    expiryYear: { type: 'string', description: 'YY or YYYY.' },
  },
} as const;

function messages(code: string, text: string) {
  return { tppMessages: [{ category: 'ERROR', code, text }] };
}

export async function cardIssuerController(fastify: FastifyInstance) {
  // ── POST /v1/cards/validations ───────────────────────────────────────────────────────────────
  fastify.post('/cards/validations', {
    preValidation: requireTpp('card-authorisations', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Validate a card against the issuer rules',
      description:
        'Checks network, length, Luhn, expiry and CVV, answering ISO 8583 codes (`00`, `14`, `54`, `82`, '
        + '`12`). The CVV is compared and discarded, never stored or returned, and a PAN sent here is not '
        + 'persisted. Every rule (accepted CVV, `cvvMode`, Luhn, supported networks) is read per call from '
        + 'the card issuer configuration an operator edits through the admin API.',
      security: [{ tppToken: [] }],
      body: {
        type: 'object',
        properties: {
          cardNumber: { type: 'string', description: 'Full PAN. Validated and discarded, never stored.' },
          cardToken: { type: 'string', description: 'A card issued here, which enables the per-card CVV.' },
          cvv: { type: 'string', description: 'Compared and discarded.' },
          expiry: { type: 'string', description: 'MM/YY or MM/YYYY.' },
          network: { type: 'string' },
          cardholderName: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            valid: { type: 'boolean' },
            responseCode: { type: 'string' },
            network: { type: 'string' },
            cvvValidationResult: { type: 'string' },
            reasons: { type: 'array', items: { type: 'string' } },
          },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      cardNumber?: string; cardToken?: string; cvv?: string; expiry?: string;
      network?: string; cardholderName?: string;
    };
    if (!body.cardNumber && !body.cardToken) {
      return reply.status(400).send(messages('FORMAT_ERROR', 'a cardNumber or a cardToken is required'));
    }

    const config = await cardIssuerConfig(fastify.db);

    // Looked up by token, so validating a card we hold needs no PAN. The service code feeds the derivation.
    let serviceCode: string | undefined;
    let expiry = body.expiry;
    if (body.cardToken) {
      const vaulted = await fastify.db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION)
        .findOne({ paymentCardReference: body.cardToken }, { projection: { _id: 0, cardServiceCode: 1, issuedCardStatus: 1 } });
      if (vaulted) {
        serviceCode = vaulted.cardServiceCode;
        if (vaulted.issuedCardStatus === 'revoked' || vaulted.issuedCardStatus === 'suspended') {
          // Nothing to validate on a blocked card, so its state beats every other check.
          return { valid: false, responseCode: '14', cvvValidationResult: 'not_provided', reasons: [`card_${vaulted.issuedCardStatus}`] };
        }
      }
      if (!expiry) {
        const registered = await fastify.db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION)
          .findOne({ paymentCardReference: body.cardToken }, { projection: { _id: 0, paymentCardExpiryMonth: 1, paymentCardExpiryYear: 1 } });
        if (registered?.paymentCardExpiryMonth && registered.paymentCardExpiryYear) {
          expiry = `${registered.paymentCardExpiryMonth}/${registered.paymentCardExpiryYear}`;
        }
      }
    }

    // Resolved before the rules run, so the rules stay a pure decision.
    const cvvLength = detectNetwork(String(body.cardNumber ?? '').replace(/\D/g, ''), config.networks.filter((n) => n.enabled))?.cvvLength ?? 3;
    const derivedCvv = body.cvv
      ? await deriveCvvForCard({ cardToken: body.cardToken, expiry, serviceCode, cvvLength }, request.log)
      : undefined;

    const result = validateCard({
      cardNumber: body.cardNumber,
      cardToken: body.cardToken,
      cvv: body.cvv,
      expiry,
      network: body.network,
      cardholderName: body.cardholderName,
      derivedCvv,
    }, config);

    // A decline is an answer, not an error: an HTTP failure would read as an outage.
    return result;
  });

  // ── GET /v1/cards/{cardToken} ────────────────────────────────────────────────────────────────
  fastify.get('/cards/:cardToken', {
    preValidation: requireTpp('card-authorisations', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Resolve a card token to its masked display',
      description:
        'Network, BIN, last four and lifecycle status for a card token. Reads the registry only, so a '
        + 'display lookup never opens the collection holding cardholder data.',
      security: [{ tppToken: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      response: {
        200: CARD_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const card = await findIssuedCard(fastify.db, cardToken);
    if (!card) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such card at this issuer'));
    return card;
  });

  // ── POST /v1/cards/searches ──────────────────────────────────────────────────────────────────
  fastify.post('/cards/searches', {
    preValidation: requireTpp('card-data', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Find a card by its exact number',
      description:
        'Which card at this issuer a given full PAN is, the query a dispute starts from when the number is '
        + 'the only identifier available. A POST rather than a query string, because a PAN in a URL lands in '
        + 'access logs and browser history. The match runs over the encrypted number, so nothing is '
        + 'decrypted to answer it, and the response carries the token and last four only. Requires the '
        + 'cardholder data scope, granted separately from the authorisation scope.',
      security: [{ tppToken: [] }],
      body: {
        type: 'object',
        required: ['cardNumber'],
        properties: { cardNumber: { type: 'string', description: 'The exact full PAN. Never stored, never logged.' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            matches: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  cardToken: { type: 'string' },
                  cardReference: { type: 'string' },
                  lastFour: { type: 'string' },
                  status: { type: 'string' },
                },
              },
            },
          },
        },
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { cardNumber } = request.body as { cardNumber: string };
    const pan = String(cardNumber ?? '').replace(/\D/g, '');
    if (!pan) return reply.status(400).send(messages('FORMAT_ERROR', 'a cardNumber is required'));

    const rows = await fastify.db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION)
      .find({ paymentCardNumber: pan })
      .project({ _id: 0, paymentCardReference: 1, paymentCardInstanceReference: 1, paymentCardNumber: 1, issuedCardStatus: 1 })
      .toArray() as unknown as CardIssuerVaultRecord[];

    // A search result is an identifier, not a second copy of the number.
    return {
      matches: rows.map((row) => ({
        cardToken: row.paymentCardReference,
        cardReference: row.paymentCardInstanceReference,
        lastFour: String(row.paymentCardNumber ?? '').replace(/\D/g, '').slice(-4),
        status: row.issuedCardStatus,
      })),
    };
  });

  // ── POST /v1/cards/{cardToken}/pan-reveals ───────────────────────────────────────────────────
  fastify.post('/cards/:cardToken/pan-reveals', {
    preValidation: requireTpp('card-data', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Reveal a card number once',
      description:
        'The one operation that returns a full PAN, and the reason the vault sits at the issuer: whoever can '
        + 'perform it is in scope for cardholder data. A POST because each call is an act of disclosure to '
        + 'be authorised and recorded, not a document to read. The value is ephemeral: do not persist or '
        + 'log it. Requires the cardholder data scope.',
      security: [{ tppToken: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            cardToken: { type: 'string' },
            cardNumber: { type: 'string', description: 'Ephemeral. Do not persist, do not log.' },
          },
        },
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const vaulted = await fastify.db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION)
      .findOne({ paymentCardReference: cardToken }, { projection: { _id: 0, paymentCardNumber: 1 } });
    if (!vaulted?.paymentCardNumber) {
      return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No card number held for that token'));
    }
    return { cardToken, cardNumber: vaulted.paymentCardNumber };
  });

  // ── POST /v1/cards/{cardToken}/verification-values ───────────────────────────────────────────
  fastify.post('/cards/:cardToken/verification-values', {
    preValidation: requireTpp('card-data', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Derive the verification value for a card',
      description:
        'The verification value this issuer would accept for a card and expiry, recomputed from the card '
        + 'data plus the issuer key the way an issuer host does inside an HSM. Never stored in any form, '
        + 'since a verification value is sensitive authentication data, and only derivable by the issuer.',
      security: [{ tppToken: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          expiry: { type: 'string', description: 'MM/YY or MM/YYYY. Falls back to the registered expiry.' },
          length: { type: 'integer', description: '3, or 4 for the networks that use four.' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            cardToken: { type: 'string' },
            verificationValue: { type: 'string', description: 'Ephemeral. Never persisted by the issuer.' },
            expiry: { type: 'string' },
          },
        },
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const body = (request.body ?? {}) as { expiry?: string; length?: number };

    const vaulted = await fastify.db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION)
      .findOne({ paymentCardReference: cardToken }, { projection: { _id: 0, cardServiceCode: 1 } });
    const registered = await fastify.db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION)
      .findOne({ paymentCardReference: cardToken }, { projection: { _id: 0, paymentCardExpiryMonth: 1, paymentCardExpiryYear: 1, paymentCardNetwork: 1 } });
    if (!vaulted && !registered) {
      return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such card at this issuer'));
    }

    const expiry = body.expiry
      ?? (registered?.paymentCardExpiryMonth && registered.paymentCardExpiryYear
        ? `${registered.paymentCardExpiryMonth}/${registered.paymentCardExpiryYear}`
        : undefined);
    if (!expiry) {
      return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No expiry known for that card, so no value can be derived'));
    }

    const config = await cardIssuerConfig(fastify.db);
    const cvvLength = body.length
      ?? config.networks.find((network) => network.name === registered?.paymentCardNetwork)?.cvvLength
      ?? 3;
    const verificationValue = await deriveCvvForCard(
      { cardToken, expiry, serviceCode: vaulted?.cardServiceCode, cvvLength }, request.log,
    );
    if (!verificationValue) {
      // The key failed, not the card, so say so rather than return an unreliable value.
      return reply.status(503).send(messages('SERVICE_BLOCKED', 'The issuer key is not available, so no value could be derived'));
    }
    return { cardToken, verificationValue, expiry };
  });
  // ── POST /v1/cards ───────────────────────────────────────────────────────────────────────────
  fastify.post('/cards', {
    preValidation: requireTpp('card-data', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Issue a card',
      description:
        'Mints a card: a number inside one of this bank\'s declared BIN ranges with a valid check digit, so '
        + 'the card it issues is routable back to it, plus the registry entry everything else reads.\n\n'
        + 'It lands `issued`, not `active`: a card is activated by whoever receives it, which is what the two '
        + 'states are for. The number is never returned, here or anywhere but the reveal endpoint.',
      security: [{ tppToken: [] }],
      body: {
        type: 'object',
        required: ['network', 'expiryMonth', 'expiryYear'],
        properties: {
          network: { type: 'string', description: 'Must have a BIN range declared by this bank.' },
          expiryMonth: { type: 'string' },
          expiryYear: { type: 'string' },
          accountHolderReference: { type: 'string' },
          fundingAccountReference: { type: 'string', description: 'The account an authorisation is held against.' },
          cardToken: { type: 'string', description: 'Supply one to keep a reference in step with a caller.' },
          limits: {
            type: 'object',
            properties: { perTransactionAmount: { type: 'number' }, limitCurrency: { type: 'string' } },
          },
        },
      },
      response: {
        201: CARD_RESPONSE, 400: ERROR_RESPONSE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 409: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      network: string; expiryMonth: string; expiryYear: string;
      accountHolderReference?: string; fundingAccountReference?: string; cardToken?: string;
      limits?: { perTransactionAmount?: number; limitCurrency?: string };
    };
    const result = await issueCard(fastify.db, body);
    if (!result.ok) {
      if (result.refusal === 'card_token_in_use') {
        return reply.status(409).send(messages('RESOURCE_BLOCKED', 'That card token already names a card here'));
      }
      const text = result.refusal === 'no_bin_range'
        ? 'This bank declares no BIN range for that network, so the card would be unroutable'
        : 'That network is not one this bank issues';
      return reply.status(400).send(messages('FORMAT_ERROR', text));
    }
    return reply.status(201).send(result.card);
  });

  // ── PUT /v1/cards/{cardToken}/status ─────────────────────────────────────────────────────────
  fastify.put('/cards/:cardToken/status', {
    preValidation: requireTpp('card-data', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Activate, block or revoke a card',
      description:
        'The lifecycle transition. Only legal moves are accepted, and `revoked` is terminal: a revoked card '
        + 'is replaced, not un-revoked, so one token never means two different cards over time.\n\n'
        + 'A blocked card is refused by the authorisation and the validation before any other check, since '
        + 'there is nothing to judge on a card that is not usable.',
      security: [{ tppToken: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['issued', 'active', 'suspended', 'revoked'] } },
      },
      response: { 200: CARD_RESPONSE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE, 409: ERROR_RESPONSE },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const { status } = request.body as { status: 'issued' | 'active' | 'suspended' | 'revoked' };
    const result = await changeCardStatus(fastify.db, cardToken, status);
    if (!result.ok) {
      if (result.refusal === 'unknown_card') {
        return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such card at this issuer'));
      }
      return reply.status(409).send(messages('STATUS_INVALID', `A card cannot go from ${result.from} to ${status}`));
    }
    return result.card;
  });

  // ── POST /v1/cards/{cardToken}/renewals ──────────────────────────────────────────────────────
  fastify.post('/cards/:cardToken/renewals', {
    preValidation: requireTpp('card-data', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Renew a card to a later expiry',
      description:
        'Same token, same number, later expiry, which is what makes a renewal invisible to everything '
        + 'holding the token. The verification value does change, since the expiry feeds its derivation.',
      security: [{ tppToken: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: { type: 'object', required: ['expiryMonth', 'expiryYear'], properties: EXPIRY.properties },
      response: { 200: CARD_RESPONSE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE, 409: ERROR_RESPONSE },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const { expiryMonth, expiryYear } = request.body as { expiryMonth: string; expiryYear: string };
    const result = await renewCard(fastify.db, cardToken, { month: expiryMonth, year: expiryYear });
    if (!result.ok) {
      if (result.refusal === 'unknown_card') {
        return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such card at this issuer'));
      }
      return reply.status(409).send(messages('STATUS_INVALID', 'A revoked card is replaced, not renewed'));
    }
    return result.card;
  });

  // ── POST /v1/cards/{cardToken}/replacements ──────────────────────────────────────────────────
  fastify.post('/cards/:cardToken/replacements', {
    preValidation: requireTpp('card-data', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Replace a card, revoking the old one',
      description:
        'A new card, deliberately not a renewal: a lost card\'s number has to stop working, so the '
        + 'replacement gets its own token, its own number and its own verification value, and the old card '
        + 'is revoked.\n\n'
        + 'The new card is issued BEFORE the old one is revoked, so a failure at that point leaves the holder '
        + 'with a card that still works rather than none.',
      security: [{ tppToken: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: { type: 'object', properties: EXPIRY.properties },
      response: {
        201: {
          type: 'object',
          additionalProperties: true,
          properties: { replacement: CARD_RESPONSE, replaced: { type: 'string' } },
        },
        400: ERROR_RESPONSE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const body = (request.body ?? {}) as { expiryMonth?: string; expiryYear?: string };
    const expiry = body.expiryMonth && body.expiryYear
      ? { month: body.expiryMonth, year: body.expiryYear }
      : undefined;
    const result = await replaceCard(fastify.db, cardToken, expiry);
    if (!result.ok) {
      if (result.refusal === 'unknown_card') {
        return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such card at this issuer'));
      }
      return reply.status(400).send(messages('FORMAT_ERROR', `The replacement could not be issued: ${result.refusal}`));
    }
    return reply.status(201).send({ replacement: result.replacement, replaced: result.replaced });
  });

  // ── PUT /v1/cards/{cardToken}/limits ─────────────────────────────────────────────────────────
  fastify.put('/cards/:cardToken/limits', {
    preValidation: requireTpp('card-data', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Set the limits an authorisation is judged against',
      description:
        'The per-transaction ceiling this issuer applies to the card. An authorisation above it is declined '
        + 'with `61`, exceeds withdrawal amount limit.\n\n'
        + 'Only a per-transaction ceiling is offered. A daily limit needs a per-card tally of the day\'s '
        + 'authorisations, which nothing here keeps yet, and a limit that silently does nothing would be '
        + 'worse than an absent one.',
      security: [{ tppToken: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          perTransactionAmount: { type: 'number' },
          limitCurrency: { type: 'string', description: 'An authorisation in another currency is refused.' },
        },
      },
      response: { 200: CARD_RESPONSE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const limits = (request.body ?? {}) as { perTransactionAmount?: number; limitCurrency?: string };
    const result = await setCardLimits(fastify.db, cardToken, limits);
    if (!result.ok) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such card at this issuer'));
    return result.card;
  });
}
