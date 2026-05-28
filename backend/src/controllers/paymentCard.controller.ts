import { FastifyInstance } from 'fastify';
import { createCard, getCardsByCustomer } from '../services/paymentCard.service';
import type { PaymentCardManagementControlRecord } from '../models';

export async function paymentCardController(fastify: FastifyInstance) {
  fastify.post('/', {
    schema: {
      tags: ['payment-cards'],
      summary: 'Add a payment card to a customer agreement',
      description: `Creates a \`paymentCard\` document (BIAN SD-88) linked to a
\`customerAgreement\` (SD-53).

**PCI DSS field classification:**

| Field | Classification | Storage |
|---|---|---|
| \`cardToken\` | NOT CHD (surrogate) | Plaintext, indexed |
| \`paymentCardExpirationDate\` | CHD (expiry is CHD when co-located with a card reference) | QE:none; encrypted at rest, requires DEK-sensitive |
| \`paymentCardMaskedPanDisplay\` | Display only (last 4) | Plaintext; permitted by PCI DSS |
| CVV / PIN | SAD (**prohibited**) | Never stored |`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['customerAgreementInstanceReference', 'cardToken',
          'paymentCardExpirationDate', 'paymentCardMaskedPanDisplay', 'paymentCardNetwork'],
        properties: {
          customerAgreementInstanceReference: {
            type: 'string',
            description: 'UUID of the parent `customerAgreement` document. Obtain this from `GET /api/v1/customer-agreements`.',
          },
          cardToken: {
            type: 'string',
            description: 'PAN surrogate token provided by the payment processor. NOT the real card number. Stored in plaintext.',
          },
          paymentCardExpirationDate: {
            type: 'string',
            description: 'Card expiry date in `MM/YY` format. Classified as CHD; stored as QE:none (encrypted, not searchable).',
          },
          paymentCardMaskedPanDisplay: {
            type: 'string',
            description: 'Display-safe last-4 string, format `****-****-****-XXXX`. Stored in plaintext; no sensitive card data.',
          },
          paymentCardNetwork: {
            type: 'string',
            enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'],
            description: 'Card network / scheme.',
          },
          paymentCardIsPreferred: {
            type: 'boolean',
            default: false,
            description: 'When true, marks this card as the default for recurring payment mandates (v4 feature). Sets `preferredPaymentCardReference` on the linked `customerAgreement`.',
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
              description: 'UUID of the created `paymentCard` document (BIAN SD-88 Control Record identifier).',
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
    const body = request.body as {
      customerAgreementInstanceReference: string;
      cardToken: string;
      paymentCardExpirationDate: string;
      paymentCardMaskedPanDisplay: string;
      paymentCardNetwork: PaymentCardManagementControlRecord['paymentCardNetwork'];
      paymentCardIsPreferred: boolean;
    };

    if (!body.customerAgreementInstanceReference || !body.cardToken || !body.paymentCardExpirationDate) {
      return reply.status(400).send({
        error: 'customerAgreementInstanceReference, cardToken, and paymentCardExpirationDate are required',
      });
    }

    const result = await createCard(fastify.db, body);
    return reply.status(201).send(result);
  });

  fastify.get('/', {
    schema: {
      tags: ['payment-cards'],
      summary: 'List payment cards for a customer',
      description: `Returns all \`paymentCard\` documents linked to a customer agreement.

The query uses a standard index on \`customerAgreementInstanceReference\`. The encrypted
expiry date (\`paymentCardExpirationDate\`, QE:none) is **not** included in this list
response; fetch the individual card record to retrieve it with Level 2 access.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['customerRef'],
        properties: {
          customerRef: {
            type: 'string',
            description: '`customerAgreementInstanceReference` UUID. Obtain this from `GET /api/v1/customer-agreements`.',
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
              description: 'All cards for this customer. Expiry date is not included (QE:none, Level 2 only).',
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
        400: { description: '`customerRef` query parameter missing.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerRef } = request.query as { customerRef?: string };
    if (!customerRef) {
      return reply.status(400).send({ error: 'customerRef query parameter is required' });
    }
    const result = await getCardsByCustomer(fastify.db, customerRef);
    return reply.send(result);
  });
}
