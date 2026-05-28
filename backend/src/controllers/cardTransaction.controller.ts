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
      description: `Creates a card transaction document (BIAN SD-254 Card Transaction).
The \`accountReference\` field is stored as **QE:equality** — encrypted on the client
before the document reaches Atlas, yet searchable by exact match.

A fraud case (\`fraudDiagnosisCase\`) is automatically opened when the transaction
amount exceeds the risk threshold or the MCC (Merchant Category Code) is in the
high-risk list (\`5812\`, \`6011\`, \`7995\`).`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['cardToken', 'accountReference', 'amount', 'currency', 'cardTransactionMerchantName', 'cardTransactionMerchantCategoryCode', 'cardTransactionChannel', 'cardTransactionMaskedPanDisplay'],
        properties: {
          cardToken: {
            type: 'string',
            description: 'Card surrogate token (not the PAN — not CHD under PCI DSS v4.0)',
            example: 'tok_a3f8c2e1b4d6',
          },
          accountReference: {
            type: 'string',
            description: 'Bank account reference — stored as QE:equality (encrypted, searchable)',
            example: 'ACC-001',
          },
          amount: { type: 'number', description: 'Transaction amount', example: 450.0 },
          currency: { type: 'string', description: 'ISO 4217 currency code', example: 'USD' },
          cardTransactionMerchantName: { type: 'string', example: 'Amazon EU' },
          cardTransactionMerchantCategoryCode: {
            type: 'string',
            description: 'MCC code. High-risk codes (5812, 6011, 7995) trigger automatic fraud case creation.',
            example: '5999',
          },
          cardTransactionChannel: {
            type: 'string',
            enum: ['online', 'pos', 'contactless', 'atm'],
            example: 'online',
          },
          cardTransactionMaskedPanDisplay: {
            type: 'string',
            description: 'Last-4 display value. Permitted by PCI DSS.',
            example: '****-****-****-1234',
          },
          gatewayPayload: {
            type: 'object',
            description: 'Raw gateway response — stored as QE:none in cardTransactionSensitive (encrypted, not searchable)',
          },
        },
      },
      response: {
        201: {
          description: 'Transaction created',
          type: 'object',
          properties: {
            cardTransactionInstanceReference: { type: 'string', description: 'UUID — BIAN Card Transaction Control Record identifier' },
            cardTransactionStatus: { type: 'string', enum: ['authorized', 'declined', 'pending', 'settled', 'disputed'] },
            fraudCaseCreated: { type: 'boolean', description: 'True when a fraud diagnosis case was automatically opened' },
            fraudDiagnosisInstanceReference: { type: 'string', description: 'UUID of the fraud case, if created' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        500: { $ref: 'Error#' },
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
      description: `Returns all transactions linked to a card token. The lookup uses a
standard plaintext index on \`paymentCardReference\` — the token is a PAN surrogate and
not classified as CHD under PCI DSS v4.0, so it does not need QE.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['cardToken'],
        properties: {
          cardToken: {
            type: 'string',
            description: 'Card surrogate token',
            example: 'tok_a3f8c2e1b4d6',
          },
        },
      },
      response: {
        200: {
          description: 'Transaction list',
          type: 'object',
          properties: {
            transactions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cardTransactionInstanceReference: { type: 'string' },
                  cardTransactionAmount: { $ref: 'MonetaryAmount#' },
                  cardTransactionDateTime: { type: 'string', format: 'date-time' },
                  cardTransactionStatus: { type: 'string' },
                  cardTransactionMerchantName: { type: 'string' },
                  cardTransactionChannel: { type: 'string' },
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
      summary: 'Get transaction by ID',
      description: 'Returns a single card transaction. The `cardTransactionAccountReference` field is decrypted client-side before the response is sent — Atlas never sees the plaintext value.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'cardTransactionInstanceReference (UUID)' },
        },
      },
      response: {
        200: {
          description: 'Card transaction document',
          type: 'object',
          properties: {
            cardTransactionInstanceReference: { type: 'string' },
            cardTransactionAmount: { $ref: 'MonetaryAmount#' },
            cardTransactionDateTime: { type: 'string', format: 'date-time' },
            cardTransactionStatus: { type: 'string', enum: ['authorized', 'declined', 'pending', 'settled', 'disputed'] },
            cardTransactionMerchantName: { type: 'string' },
            cardTransactionMerchantCategoryCode: { type: 'string' },
            cardTransactionMaskedPanDisplay: { type: 'string' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const txn = await getTransactionById(fastify.db, id);
    if (!txn) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send(txn);
  });
}
