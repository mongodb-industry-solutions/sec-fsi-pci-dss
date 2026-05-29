import { FastifyInstance } from 'fastify';
import { createCard, getCardsByCustomer } from '../services/paymentCard.service';
import type { PaymentCardManagementControlRecord } from '../models/paymentCard.model';

// Mounted at /customer — routes are /:customerId/cards
export async function paymentCardController(fastify: FastifyInstance) {

  // POST /api/v1/customer/:customerId/cards
  fastify.post('/:customerId/cards', {
    schema: {
      tags: ['cards'],
      summary: 'Register a payment card for a customer',
      description: `Creates a \`paymentCard\` document (BIAN SD-88) linked to the customer
identified by \`customerId\` (\`customerAgreementInstanceReference\`).

**REST note:** the card is a sub-resource of the customer agreement. The
\`customerAgreementInstanceReference\` is taken from the path parameter \`:customerId\`
and must NOT be repeated in the request body.

**PCI DSS field classification:**

| Field | Classification | Storage |
|---|---|---|
| \`cardToken\` | NOT CHD (surrogate) | Plaintext, indexed |
| \`paymentCardExpirationDate\` | CHD (expiry co-located with card ref) | QE:none — encrypted, requires DEK-sensitive |
| \`paymentCardMaskedPanDisplay\` | Display only (last 4) | Plaintext; permitted by PCI DSS |
| CVV / PIN | SAD (**prohibited**) | Never stored |`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId'],
        properties: {
          customerId: {
            type: 'string',
            description: '`customerAgreementInstanceReference` UUID. Obtain via `GET /api/v1/customer?email=...`.',
          },
        },
      },
      body: {
        type: 'object',
        required: ['cardToken', 'paymentCardExpirationDate', 'paymentCardMaskedPanDisplay', 'paymentCardNetwork'],
        properties: {
          cardToken: {
            type: 'string',
            description: 'PAN surrogate token. NOT the real card number. Stored in plaintext.',
          },
          paymentCardExpirationDate: {
            type: 'string',
            description: 'Card expiry date in `MM/YY` format. Stored as QE:none (encrypted, not searchable).',
          },
          paymentCardMaskedPanDisplay: {
            type: 'string',
            description: 'Display-safe last-4 string, format `****-****-****-XXXX`.',
          },
          paymentCardNetwork: {
            type: 'string',
            enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'],
            description: 'Card network / scheme.',
          },
          paymentCardIsPreferred: {
            type: 'boolean',
            default: false,
            description: 'When true, marks this card as the default for recurring payments (v4).',
          },
        },
      },
      response: {
        201: {
          description: 'Payment card created and linked to the customer agreement.',
          type: 'object',
          properties: {
            paymentCardInstanceReference: {
              type: 'string',
              description: 'UUID of the created `paymentCard` document (BIAN SD-88).',
            },
            paymentCardStatus: {
              type: 'string',
              enum: ['active', 'blocked', 'expired', 'pending_activation'],
              description: 'Initial card status (always `active` on successful creation).',
            },
          },
        },
        400: { description: 'Required fields missing.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        500: { description: 'Unexpected server error.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string };
    const body = request.body as {
      cardToken: string;
      paymentCardExpirationDate: string;
      paymentCardMaskedPanDisplay: string;
      paymentCardNetwork: PaymentCardManagementControlRecord['paymentCardNetwork'];
      paymentCardIsPreferred?: boolean;
    };

    if (!body.cardToken || !body.paymentCardExpirationDate) {
      return reply.status(400).send({
        error: 'cardToken and paymentCardExpirationDate are required',
      });
    }

    const result = await createCard(fastify.db, {
      customerAgreementInstanceReference: customerId,
      cardToken: body.cardToken,
      paymentCardExpirationDate: body.paymentCardExpirationDate,
      paymentCardMaskedPanDisplay: body.paymentCardMaskedPanDisplay,
      paymentCardNetwork: body.paymentCardNetwork,
      paymentCardIsPreferred: body.paymentCardIsPreferred ?? false,
    });
    return reply.status(201).send(result);
  });

  // GET /api/v1/customer/:customerId/cards
  fastify.get('/:customerId/cards', {
    schema: {
      tags: ['cards'],
      summary: 'List payment cards for a customer',
      description: `Returns all \`paymentCard\` documents (BIAN SD-88) linked to the
customer identified by \`:customerId\` (\`customerAgreementInstanceReference\`).

The encrypted expiry date (\`paymentCardExpirationDate\`, QE:none) is **not** included
in this list response; it requires Level 2 access and a separate request.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId'],
        properties: {
          customerId: {
            type: 'string',
            description: '`customerAgreementInstanceReference` UUID.',
          },
        },
      },
      response: {
        200: {
          description: 'Payment cards linked to the customer.',
          type: 'object',
          properties: {
            results: {
              type: 'array',
              description: 'All active cards for this customer.',
              items: {
                type: 'object',
                properties: {
                  paymentCardInstanceReference: { type: 'string', description: 'Card UUID.' },
                  paymentCardReference: { type: 'string', description: 'Card surrogate token (not the PAN).' },
                  paymentCardMaskedPanDisplay: { type: 'string', description: 'Last-4 display string.' },
                  paymentCardNetwork: {
                    type: 'string',
                    enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'],
                    description: 'Card network.',
                  },
                  paymentCardStatus: {
                    type: 'string',
                    enum: ['active', 'blocked', 'expired', 'pending_activation'],
                    description: 'Current card lifecycle status.',
                  },
                  paymentCardIsPreferred: {
                    type: 'boolean',
                    description: 'True when this is the default card for recurring payments.',
                  },
                },
              },
            },
          },
        },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        404: { description: 'Customer not found.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string };
    const result = await getCardsByCustomer(fastify.db, customerId);
    return reply.send(result);
  });
}
