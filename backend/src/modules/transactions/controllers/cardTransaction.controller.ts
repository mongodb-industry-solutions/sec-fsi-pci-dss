import { FastifyInstance } from 'fastify';
import type { DemoRequest } from '../../../shared/models/identity.model';
import {
  createTransaction,
  getTransactionById,
  getTransactionsByCardToken,
  getDistinctMerchants,
  getAllTransactions,
} from '../services/cardTransaction.service';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';
import { getCaseNotes } from '../../fraud/services/fraudDiagnosis.service';

export async function cardTransactionController(fastify: FastifyInstance) {
  fastify.get('/merchants', {
    schema: {
      tags: ['transactions'],
      summary: 'List distinct merchants from transaction history',
      description: `Returns unique merchant name and MCC pairs aggregated from the
\`cardTransaction\` collection. Used by the Simulator STEP 1 form to populate
the Merchant Name selector. No authentication required (public, simulator mode).`,
      response: {
        200: {
          description: 'List of distinct merchants, sorted alphabetically.',
          type: 'object',
          properties: {
            merchants: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Merchant display name.' },
                  mcc: { type: 'string', description: 'ISO 18245 Merchant Category Code.' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const merchants = await getDistinctMerchants(fastify.db);
    return reply.send({ merchants });
  });

  fastify.post('/', {
    schema: {
      tags: ['transactions'],
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
          'cardTransactionChannel', 'cardTransactionMaskedPanDisplay',
          'cardTransactionType', 'cardTransactionDescription'],
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
          cardTransactionType: {
            type: 'string',
            enum: ['purchase', 'cash_advance', 'balance_transfer', 'refund', 'fee', 'adjustment'],
            description: 'BIAN SD-254 transaction type classification.',
          },
          cardTransactionDescription: {
            type: 'string',
            maxLength: 22,
            description: 'Statement descriptor visible on the cardholder\'s bank statement (BIAN SD-254). Max 22 characters.',
          },
          cardTransactionNarrative: {
            type: 'string',
            description: 'Extended free-text narrative for fraud investigation context. Optional.',
          },
          merchantAgreementInstanceReference: {
            type: 'string',
            description: 'Acquiring-side link (BIAN SD-89): the merchant this payment was made to. Optional; set by checkout/payment-link flows and the simulator. Not CHD/PII — stored plaintext and indexed so the merchant owner can list received payments.',
          },
          gatewayPayload: {
            type: 'object',
            description: 'Raw JSON response from the PSP authorization flow. Stored as QE:none in the `cardTransactionSensitive` collection; requires DEK-sensitive key (Level 2 Investigator role) to read.',
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
      cardTransactionType: string;
      cardTransactionDescription: string;
      cardTransactionNarrative?: string;
      merchantAgreementInstanceReference?: string;
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
      tags: ['transactions'],
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
      tags: ['transactions'],
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
            paymentCardReference:              { type: 'string', description: 'Card token (surrogate, not the PAN).' },
            cardTransactionAccountReference:   { type: 'string', nullable: true, description: 'QE:equality  -  decrypted account reference.' },
            cardTransactionInitiationType:     { type: 'string', nullable: true },
            sensitive: {
              type: 'object', nullable: true,
              description: 'Available to Level 2 Investigator (with escalation token) and Security Auditor.',
              properties: {
                rawGatewayPayload:            { type: 'object', additionalProperties: true },
                processorTransactionMetadata: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        404: { description: 'No transaction found with the given ID.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { demoRole, escalationToken } = request as unknown as DemoRequest;
    const txn = await getTransactionById(fastify.db, id, demoRole as Parameters<typeof getTransactionById>[2], escalationToken);
    if (!txn) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send(txn);
  });

  // GET /api/v1/transactions/:id/notes  -  customer-safe: returns customer-visible notes list
  fastify.get('/:id/notes', {
    schema: {
      tags: ['transactions'],
      summary: 'Get customer-visible notes for a transaction (list)',
      description: `Returns the customer-facing investigation notes and case status.
Accessible to the \`customer\` role (unlike direct fraud case endpoints).
Only \`visibility:'customer'\` notes are returned - internal notes are never exposed here.
Retracted notes are excluded from the list.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: '`cardTransactionInstanceReference` UUID.' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            caseFound:                       { type: 'boolean' },
            fraudDiagnosisCaseReference:     { type: 'string', nullable: true },
            fraudDiagnosisCaseStatus:        { type: 'string', nullable: true },
            fraudDiagnosisCaseSeverity:      { type: 'string', nullable: true },
            fraudDiagnosisResolutionOutcome: { type: 'string', nullable: true },
            notes: {
              type: 'array',
              description: 'Chronological list of customer-visible, non-retracted notes.',
              items: {
                type: 'object',
                properties: {
                  noteId:          { type: 'string' },
                  noteText:        { type: 'string' },
                  performedByRole: { type: 'string' },
                  actionDateTime:  { type: 'string', format: 'date-time' },
                  isRetracted:     { type: 'boolean' },
                },
              },
            },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const fraudCase = await fastify.db
      .collection(FRAUD_DIAGNOSIS_COLLECTION)
      .findOne({ cardTransactionInstanceReference: id });

    if (!fraudCase) {
      return reply.send({ caseFound: false, fraudDiagnosisCaseReference: null, fraudDiagnosisCaseStatus: null, fraudDiagnosisCaseSeverity: null, fraudDiagnosisResolutionOutcome: null, notes: [] });
    }

    const caseId = fraudCase['fraudDiagnosisInstanceReference'] as string;

    // Fetch customer-visible notes from event log
    let notes = await getCaseNotes(fastify.db, caseId, 'customer');

    // Legacy fallback: if no event-log notes exist but the deprecated string field does, synthesise one entry
    if (notes.length === 0 && fraudCase['fraudDiagnosisCustomerSubjectNotes']) {
      notes = [{
        noteId: 'legacy',
        noteText: fraudCase['fraudDiagnosisCustomerSubjectNotes'] as string,
        visibility: 'customer',
        performedByRole: 'level1_analyst',
        actionDateTime: (fraudCase['recordCreatedDateTime'] as Date | undefined)?.toISOString() ?? new Date().toISOString(),
        isRetracted: false,
        retractionReason: null,
        retractionDateTime: null,
      }];
    }

    // Exclude retracted notes from the customer-facing list
    const visibleNotes = notes.filter(n => !n.isRetracted);

    return reply.send({
      caseFound:                       true,
      fraudDiagnosisCaseReference:     fraudCase['fraudDiagnosisCaseReference'] ?? null,
      fraudDiagnosisCaseStatus:        fraudCase['fraudDiagnosisCaseStatus'] ?? null,
      fraudDiagnosisCaseSeverity:      fraudCase['fraudDiagnosisCaseSeverity'] ?? null,
      fraudDiagnosisResolutionOutcome: (fraudCase['fraudDiagnosisResolutionRecord'] as Record<string, unknown> | null)?.resolutionOutcome ?? null,
      notes: visibleNotes,
    });
  });

  // GET /api/v1/transactions/all   -  paginated transaction list for analyst / auditor roles
  fastify.get('/all', {
    schema: {
      tags: ['transactions'],
      summary: 'List all transactions (paginated)',
      description: `Returns a paginated list of all \`cardTransaction\` records sorted by
\`cardTransactionDateTime\` descending. Supports optional filters.

Intended for L1 Analyst, L2 Investigator, and Security Auditor roles.
Not accessible to the \`customer\` role (enforced by RBAC middleware).`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status:    { type: 'string', enum: ['authorized', 'declined', 'pending', 'settled', 'disputed'], description: 'Filter by transaction status.' },
          merchant:  { type: 'string', description: 'Case-insensitive partial match on merchant name.' },
          cardToken: { type: 'string', description: 'Filter by exact card token (paymentCardReference).' },
          email:     { type: 'string', format: 'email', description: 'Filter by customer email (QE:equality → account reference → transactions). Two-step QE search.' },
          page:      { type: 'string', default: '1' },
          limit:     { type: 'string', default: '20' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cardTransactionInstanceReference: { type: 'string' },
                  paymentCardReference:             { type: 'string' },
                  cardTransactionAmount:             { $ref: 'MonetaryAmount#' },
                  cardTransactionDateTime:           { type: 'string', format: 'date-time' },
                  cardTransactionStatus:             { type: 'string' },
                  cardTransactionType:               { type: 'string' },
                  cardTransactionMerchantName:       { type: 'string' },
                  cardTransactionMerchantCategoryCode: { type: 'string' },
                  cardTransactionChannel:            { type: 'string' },
                  cardTransactionMaskedPanDisplay:   { type: 'string' },
                },
              },
            },
            total: { type: 'number' },
            page:  { type: 'number' },
            limit: { type: 'number' },
          },
        },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { status, merchant, cardToken, email, page = '1', limit = '20' } = request.query as {
      status?: string; merchant?: string; cardToken?: string; email?: string; page?: string; limit?: string;
    };
    // Privacy: a customer may only list their OWN transactions. Ignore any email
    // they pass and scope to the email in their JWT.
    const { demoRole } = request as unknown as DemoRequest;
    const jwtEmail = (request as unknown as { user?: { email?: string } }).user?.email;
    const effectiveEmail = demoRole === 'customer' ? jwtEmail : email;
    const result = await getAllTransactions(
      fastify.db,
      { status, merchant, cardToken, email: effectiveEmail },
      parseInt(page, 10),
      parseInt(limit, 10)
    );
    return reply.send(result);
  });
}
