import { FastifyInstance } from 'fastify';
import { createCard, getCardsByCustomer } from '../services/paymentCard.service';
import type { PaymentCardManagementControlRecord } from '../models';

export async function paymentCardController(fastify: FastifyInstance) {
  fastify.post('/', {
    schema: {
      tags: ['payment-cards'],
      summary: 'Add a payment card to a customer agreement',
      description: `Creates a payment card (BIAN SD-88 Payment Card) linked to a
Customer Agreement.

**PCI DSS compliance notes:**
- The \`cardToken\` is a PAN surrogate — it is stored in plaintext and indexed normally.
  It is **not** Cardholder Data (CHD) under PCI DSS v4.0.
- \`paymentCardExpirationDate\` **is** CHD when co-located with a card reference.
  It is encrypted as **QE:none** (requires DEK-sensitive to decrypt).
- CVV and PIN are **prohibited** at all endpoints — never include them in the request body.
- For recurring payment mandates (v4), \`paymentCardConsentDateTime\` is recorded to
  satisfy PCI DSS Req 3.1.`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['customerAgreementInstanceReference', 'cardToken', 'paymentCardExpirationDate', 'paymentCardMaskedPanDisplay', 'paymentCardNetwork'],
        properties: {
          customerAgreementInstanceReference: {
            type: 'string',
            description: 'UUID linking this card to a Customer Agreement (SD-53)',
          },
          cardToken: {
            type: 'string',
            description: 'PAN surrogate token — not CHD, stored plaintext',
            example: 'tok_a3f8c2e1b4d6',
          },
          paymentCardExpirationDate: {
            type: 'string',
            description: 'Expiry date MM/YY — classified as CHD, stored as QE:none',
            example: '08/28',
          },
          paymentCardMaskedPanDisplay: {
            type: 'string',
            description: 'Last-4 display string, permitted by PCI DSS',
            example: '****-****-****-1234',
          },
          paymentCardNetwork: {
            type: 'string',
            enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'],
          },
          paymentCardIsPreferred: {
            type: 'boolean',
            description: 'Set true to mark as the preferred card for recurring payments (v4)',
            default: false,
          },
        },
      },
      response: {
        201: {
          description: 'Card created',
          type: 'object',
          properties: {
            paymentCardInstanceReference: { type: 'string', description: 'UUID — BIAN Payment Card Control Record identifier' },
            paymentCardReference: { type: 'string', description: 'Card token stored' },
            paymentCardStatus: { type: 'string', enum: ['active', 'blocked', 'expired', 'pending_activation'] },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        500: { $ref: 'Error#' },
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
      summary: 'List cards for a customer',
      description: 'Returns all payment cards linked to a customer agreement. Uses a standard index on `customerAgreementInstanceReference`.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['customerRef'],
        properties: {
          customerRef: {
            type: 'string',
            description: 'customerAgreementInstanceReference UUID',
          },
        },
      },
      response: {
        200: {
          description: 'Card list',
          type: 'object',
          properties: {
            cards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  paymentCardInstanceReference: { type: 'string' },
                  paymentCardReference: { type: 'string' },
                  paymentCardMaskedPanDisplay: { type: 'string' },
                  paymentCardNetwork: { type: 'string' },
                  paymentCardStatus: { type: 'string' },
                  paymentCardIsPreferred: { type: 'boolean' },
                },
              },
            },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
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
