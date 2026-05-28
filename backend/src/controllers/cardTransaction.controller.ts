import { FastifyInstance } from 'fastify';
import {
  createTransaction,
  getTransactionById,
  getTransactionsByCardToken,
} from '../services/cardTransaction.service';

export async function cardTransactionController(fastify: FastifyInstance) {
  fastify.post('/', {
    schema: {
      tags: ['card-transactions'],
      summary: 'Record a new card transaction',
      description: `Creates a \`cardTransaction\` document (BIAN SD-254) and a matching
\`cardTransactionSensitive\` document (raw gateway payload, QE:none).

**Auto fraud-case rule:** a \`fraudDiagnosisCase\` is opened automatically when:
- \`amount\` exceeds the risk threshold (default: 500, configurable via \`FRAUD_AMOUNT_THRESHOLD\`)
- OR \`cardTransactionMerchantCategoryCode\` is in the high-risk list: \`5812\` (restaurants), \`6011\` (ATM/cash), \`7995\` (gambling)

**QE fields:**
- \`accountReference\` → stored as \`cardTransactionAccountReference\` with QE:equality; encrypted, searchable by exact match
- \`gatewayPayload\` → stored in \`cardTransactionSensitive.rawGatewayPayload\` as QE:none; encrypted, not searchable, requires DEK-sensitive`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['cardToken', 'accountReference', 'amount', 'currency',
          'cardTransactionMerchantName', 'cardTransactionMerchantCategoryCode',
          'cardTransactionChannel', 'cardTransactionMaskedPanDisplay'],
        properties: {
          cardToken: {
            type: 'string',
            description: 'Card surrogate token, PAN substitute, NOT Cardholder Data under PCI DSS v4.0. Stored in plaintext with a standard index.',
          },
          accountReference: {
            type: 'string',
            description: 'Customer bank account reference (BIAN `customerAgreementReference`). Stored as QE:equality; encrypted at rest, searchable without Atlas seeing the plaintext.',
          },
          amount: {
            type: 'number',
            description: 'Transaction amount in the specified currency. Amounts above the threshold trigger automatic fraud case creation.',
          },
          currency: {
            type: 'string',
            description: 'ISO 4217 three-letter currency code.',
          },
          cardTransactionMerchantName: {
            type: 'string',
            description: 'Merchant display name stored as plaintext.',
          },
          cardTransactionMerchantCategoryCode: {
            type: 'string',
            description: 'ISO 18245 Merchant Category Code (MCC). Codes 5812, 6011, 7995 are high-risk and trigger automatic fraud case creation.',
          },
          cardTransactionChannel: {
            type: 'string',
            enum: ['online', 'pos', 'contactless', 'atm'],
            description: 'Payment channel.',
          },
          cardTransactionMaskedPanDisplay: {
            type: 'string',
            description: 'Last-4 display string in the format `****-****-****-XXXX`. Permitted by PCI DSS; no sensitive data.',
          },
          gatewayPayload: {
            type: 'object',
            description: 'Raw JSON response from the payment gateway. Stored as QE:none in the `cardTransactionSensitive` collection; requires DEK-sensitive key (Level 2 Investigator role) to read.',
            additionalProperties: true,
          },
        },
      },
      response: {
        201: {
          description: 'Transaction recorded successfully.',
          type: 'object',
          properties: {
            cardTransactionInstanceReference: {
              type: 'string',
              description: 'UUID of the created `cardTransaction` document. Use this to fetch the transaction with GET /:id.',
            },
            cardTransactionStatus: {
              type: 'string',
              enum: ['authorized', 'declined', 'pending', 'settled', 'disputed'],
              description: 'Initial transaction status (always `authorized` on successful creation).',
            },
            fraudCaseCreated: {
              type: 'boolean',
              description: 'True when the amount or MCC triggered automatic fraud case creation.',
            },
            fraudDiagnosisInstanceReference: {
              type: 'string',
              description: 'UUID of the auto-created `fraudDiagnosisCase`. Present only when `fraudCaseCreated` is true.',
            },
          },
        },
        400: { description: 'Required fields missing or invalid.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        500: { description: 'Unexpected server error.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      cardToken: string;
      accountReference: string;
      amount: number;
      currency: string;
      cardTransactionMerchantName: string;
      cardTransactionMerchantCategoryCode: string;
      cardTransactionChannel: string;
      cardTransactionMaskedPanDisplay: string;
      gatewayPayload: object;
    };

    if (!body.cardToken || !body.accountReference || body.amount == null) {
      return reply.status(400).send({ error: 'cardToken, accountReference, and amount are required' });
    }

    const result = await createTransaction(fastify.db, body);
    return reply.status(201).send(result);
  });

  fastify.get('/', {
    schema: {
      tags: ['card-transactions'],
      summary: 'List transactions by card token',
      description: `Returns all transactions associated with a card token, sorted by
\`cardTransactionDateTime\` descending (most recent first).

The query uses a standard plaintext index on \`paymentCardReference\` because the card
token is a PAN surrogate and is NOT Cardholder Data under PCI DSS v4.0.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['cardToken'],
        properties: {
          cardToken: {
            type: 'string',
            description: 'Card surrogate token. Same value as `paymentCardReference` in the `paymentCard` collection.',
          },
        },
      },
      response: {
        200: {
          description: 'Transaction list sorted by date descending.',
          type: 'object',
          properties: {
            results: {
              type: 'array',
              description: 'All transactions for the given card token.',
              items: {
                type: 'object',
                properties: {
                  cardTransactionInstanceReference: { type: 'string', description: 'Transaction UUID.' },
                  cardTransactionAmount: { $ref: 'MonetaryAmount#' },
                  cardTransactionDateTime: { type: 'string', format: 'date-time', description: 'UTC timestamp of the transaction.' },
                  cardTransactionStatus: {
                    type: 'string',
                    enum: ['authorized', 'declined', 'pending', 'settled', 'disputed'],
                    description: 'Current transaction status.',
                  },
                  cardTransactionMerchantName: { type: 'string', description: 'Merchant display name.' },
                  cardTransactionChannel: {
                    type: 'string',
                    enum: ['online', 'pos', 'contactless', 'atm'],
                    description: 'Payment channel.',
                  },
                },
              },
            },
            count: { type: 'number', description: 'Total number of transactions returned.' },
          },
        },
        400: { description: '`cardToken` query parameter missing.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { cardToken } = request.query as { cardToken?: string };
    if (!cardToken) {
      return reply.status(400).send({ error: 'cardToken query parameter is required' });
    }
    const result = await getTransactionsByCardToken(fastify.db, cardToken);
    return reply.send(result);
  });

  fastify.get('/:id', {
    schema: {
      tags: ['card-transactions'],
      summary: 'Get a transaction by ID',
      description: `Returns a single \`cardTransaction\` document by its UUID.

**QE note:** \`cardTransactionAccountReference\` is a QE:equality field; it is
decrypted in the API process memory and returned as plaintext. Atlas stores only
ciphertext and never sees the account reference value.

The sensitive counterpart (\`rawGatewayPayload\`, \`processorTransactionMetadata\`)
is in the \`cardTransactionSensitive\` collection and requires Level 2 Investigator
role to retrieve.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '`cardTransactionInstanceReference` UUID.' },
        },
      },
      response: {
        200: {
          description: 'Card transaction document.',
          type: 'object',
          properties: {
            cardTransactionInstanceReference: { type: 'string', description: 'Transaction UUID.' },
            cardTransactionAmount: { $ref: 'MonetaryAmount#' },
            cardTransactionDateTime: { type: 'string', format: 'date-time', description: 'UTC timestamp of the transaction.' },
            cardTransactionStatus: {
              type: 'string',
              enum: ['authorized', 'declined', 'pending', 'settled', 'disputed'],
              description: 'Current transaction status.',
            },
            cardTransactionMerchantName: { type: 'string', description: 'Merchant display name.' },
            cardTransactionMerchantCategoryCode: { type: 'string', description: 'ISO 18245 MCC code.' },
            cardTransactionMaskedPanDisplay: { type: 'string', description: 'Last-4 display (`****-****-****-XXXX`).' },
            cardTransactionChannel: {
              type: 'string',
              enum: ['online', 'pos', 'contactless', 'atm'],
              description: 'Payment channel.',
            },
            paymentCardReference: { type: 'string', description: 'Card token (surrogate, not the PAN).' },
          },
        },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        404: { description: 'No transaction found with the given ID.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const txn = await getTransactionById(fastify.db, id);
    if (!txn) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send(txn);
  });
}
