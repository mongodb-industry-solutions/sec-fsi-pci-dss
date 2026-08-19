import { FastifyInstance } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import {
  PAYMENT_CARD_REGISTRY_COLLECTION, PaymentCardRegistryRecord,
  CARD_ISSUER_VAULT_COLLECTION, CardIssuerVaultRecord,
} from '../models/cardIssuerVault.model';
import { cardIssuerConfig, detectNetwork, validateCard } from '../services/cardValidation.service';
import { deriveCvvForCard } from '../services/cardCvv.service';

// The issuer's card API.
//
// PCI DSS shapes every response here: a PAN is never returned, a CVV is compared and discarded, and the
// registry read never touches the vault. What a caller gets back is a decision and a masked display.
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

export async function cardIssuerController(fastify: FastifyInstance) {
  // ── POST /v1/cards/validations ───────────────────────────────────────────────────────────────
  fastify.post('/cards/validations', {
    preValidation: requireTpp('card-authorisations', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Validate a card against the issuer rules',
      description:
        'The issuer checking whether a card is genuine: its network, its length, its Luhn check digit, its '
        + 'expiry and its CVV. Answers ISO 8583 response codes (`00`, `14`, `54`, `82`, `12`), because that '
        + 'is the card rail\'s vocabulary.\n\n'
        + '**The CVV is compared and discarded.** It is never stored, never logged and never returned; the '
        + 'response says only whether it matched. A PAN sent here is likewise never persisted: the vault '
        + 'holds the cards this bank ISSUED, and validating one is not a reason to keep another.\n\n'
        + 'Every rule is read per call from this bank\'s card issuer configuration, which an operator edits '
        + 'through the admin API. The accepted CVV in particular is a configurable value and not a constant '
        + 'in code: `cvvMode` decides whether the global value, the per-card derived value, or either is '
        + 'accepted.',
      security: [{ tppToken: [] }],
      body: {
        type: 'object',
        properties: {
          cardNumber: { type: 'string', description: 'Full PAN. Validated and discarded, never stored.' },
          cardToken: { type: 'string', description: 'A card already issued here, which enables the per-card CVV.' },
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

    // A registered card contributes its service code and expiry, which is what the per-card CVV derivation
    // needs. Looked up by TOKEN, so the caller never has to send a PAN to validate a card we already hold.
    let serviceCode: string | undefined;
    let expiry = body.expiry;
    if (body.cardToken) {
      const vaulted = await fastify.db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION)
        .findOne({ paymentCardReference: body.cardToken }, { projection: { _id: 0, cardServiceCode: 1, issuedCardStatus: 1 } });
      if (vaulted) {
        serviceCode = vaulted.cardServiceCode;
        if (vaulted.issuedCardStatus === 'revoked' || vaulted.issuedCardStatus === 'suspended') {
          // The card's own state beats every other check: there is nothing to validate on a blocked card.
          return { valid: false, responseCode: '14', cvvValidationResult: 'not_provided', reasons: [`card_${vaulted.issuedCardStatus}`] };
        }
      }
      if (!expiry) {
        const registered = await fastify.db.collection<PaymentCardRegistryRecord>(PAYMENT_CARD_REGISTRY_COLLECTION)
          .findOne({ paymentCardReference: body.cardToken }, { projection: { _id: 0, paymentCardExpiryMonth: 1, paymentCardExpiryYear: 1 } });
        if (registered?.paymentCardExpiryMonth && registered.paymentCardExpiryYear) {
          expiry = `${registered.paymentCardExpiryMonth}/${registered.paymentCardExpiryYear}`;
        }
      }
    }

    // The value this issuer derived for this card, resolved before the rules run so the rules stay a pure
    // decision. Undefined when there is no registered card or no key, which the mode then accounts for.
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

    // Deliberately returns the result rather than throwing on an invalid card: a decline is an ANSWER, and
    // an HTTP error would make the caller treat a perfectly working refusal as an outage.
    return result;
  });

  // ── GET /v1/cards/{cardToken} ────────────────────────────────────────────────────────────────
  fastify.get('/cards/:cardToken', {
    preValidation: requireTpp('card-authorisations', 'CBPII'),
    schema: {
      tags: ['cards'],
      summary: 'Resolve a card token to its masked display',
      description:
        'What the issuer will say about a card given its token: the network, the BIN, the last four and the '
        + 'lifecycle status.\n\n'
        + '**No PAN, ever.** This reads the registry and never touches the vault, so the collection holding '
        + 'cardholder data is not even opened by a display lookup. Showing the BIN and the last four is what '
        + 'PCI DSS permits, and it is all a caller needs to render a card.',
      security: [{ tppToken: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            cardToken: { type: 'string' },
            network: { type: 'string' },
            bin: { type: 'string' },
            lastFour: { type: 'string' },
            maskedDisplay: { type: 'string' },
            status: { type: 'string' },
          },
        },
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
      },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const card = await fastify.db.collection<PaymentCardRegistryRecord>(PAYMENT_CARD_REGISTRY_COLLECTION)
      .findOne({ paymentCardReference: cardToken }, { projection: { _id: 0 } });
    if (!card) return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No such card at this issuer'));
    return {
      cardToken: card.paymentCardReference,
      network: card.paymentCardNetwork,
      bin: card.paymentCardBin,
      lastFour: card.paymentCardLastFour,
      maskedDisplay: card.paymentCardMaskedDisplay,
      status: card.issuedCardStatus,
    };
  });
}
