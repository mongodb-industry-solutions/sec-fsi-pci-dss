import { FastifyInstance } from 'fastify';
import type { AuthenticatedRequest } from '../../../shared/models/identity.model';
import { beginSSE } from '../../../shared/services/sse';
import {
  initiateTransaction,
  getTransactionById,
  getTransactionsByCardToken,
  getDistinctMerchants,
  getAllTransactions,
  resolveAccountReferenceForParty,
  getPartyCardTransactions,
  CardNotActiveError,
} from '../services/cardTransaction.service';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';
import { CARD_TRANSACTION_COLLECTION } from '../models/cardTransaction.model';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../../gateway/models/paymentExecution.model';
import { getEventBus } from '../../../vendors/eventbus';
import { getCaseNotes } from '../../fraud/services/fraudDiagnosis.service';
import { listQuestionsByTransaction, submitResponse } from '../../fraud/services/customerQuestion.service';
import { requirePermission } from '../../../vendors/middleware/acl';
import { resolveOwner } from '../../../vendors/middleware/dualAuth';
import { tryMerchantContext } from '../../../vendors/middleware/validateMerchantToken';

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
- \`amount\` exceeds the risk threshold (default: 500, configurable via \`PSP_FRAUD_AMOUNT_THRESHOLD\`)
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
          paymentCardExpirationDate: {
            type: 'string',
            description: 'Card expiry (MM/YY). Optional; supplied for a NEW card so the PSP auto-registers it as a card-on-file (SD-88) after payment. Never required for an already-saved card.',
          },
          paymentCardNetwork: {
            type: 'string',
            enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'],
            description: 'Card network. Optional; supplied alongside the expiry for card-on-file auto-registration.',
          },
          gatewayPayload: {
            type: 'object',
            description: 'Raw JSON response from the PSP authorization flow. Stored as QE:none in the `cardTransactionSensitive` collection; requires DEK-sensitive key (Level 2 Investigator role) to read.',
            additionalProperties: true,
          },
          cardVerification: {
            type: 'object',
            description: 'Transient card verification values (PAN, CVV, expiry) forwarded to the card issuer for authorization ONLY, mirroring a real authorization request. NEVER stored on the transaction and stripped from every audit log (PCI DSS Req 3.2 / Req 10.7).',
            additionalProperties: false,
            properties: {
              cardNumber: { type: 'string', description: 'Full PAN. Used only to authorize; never persisted.' },
              cvv: { type: 'string', description: 'Card verification value. Validated in-memory; never persisted (PCI DSS Req 3.2).' },
              expiry: { type: 'string', description: 'Expiry MM/YY. Used to check the card is not expired; never persisted.' },
            },
          },
        },
      },
      response: {
        202: {
          description: 'Transaction accepted and PENDING. Authorization runs asynchronously (issuer + risk); '
            + 'subscribe to GET /api/v1/transactions/:id/stream (SSE) for the authorized / declined outcome.',
          type: 'object',
          properties: {
            cardTransactionInstanceReference: {
              type: 'string',
              description: 'UUID of the created `cardTransaction`. Use it for the SSE stream and to fetch the transaction.',
            },
            cardTransactionStatus: {
              type: 'string',
              enum: ['pending'],
              description: 'Always `pending`; the terminal status arrives over the SSE stream.',
            },
          },
        },
        400: { description: 'Required fields missing or invalid.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        422: { description: 'Card-on-file is deactivated or removed - PSP declined.', $ref: 'Error#' },
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
      paymentCardExpirationDate?: string;
      paymentCardNetwork?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
      gatewayPayload: object;
      cardVerification?: { cardNumber?: string; cvv?: string; expiry?: string };
    };

    if (!body.cardToken || !body.accountReference || body.amount == null) {
      return reply.status(400).send({ error: 'cardToken, accountReference, and amount are required' });
    }

    try {
      // dev.v8 F3: async authorization. Create the transaction PENDING and return immediately; the
      // client opens GET /:id/stream (SSE) to receive the issuer decision (authorized / declined).
      // P13.1 (D1): supplying cardVerification marks this as a CVV-bearing channel, so a wrong or
      // missing CVV declines at the issuer.
      const result = await initiateTransaction(fastify.db, {
        ...body,
        ...(body.cardVerification ? { requireCardVerification: true } : {}),
      });
      return reply.status(202).send({
        cardTransactionInstanceReference: result.cardTransactionInstanceReference,
        cardTransactionStatus: result.cardTransactionStatus,
      });
    } catch (err) {
      if (err instanceof CardNotActiveError) {
        return reply.status(422).send({ error: 'This card has been deactivated. Reactivate it to make payments, or use a different card.' });
      }
      throw err;
    }
  });

  // dev.v8 F3: live authorization outcome (SSE). Public by txn id (UUID); emits only the terminal
  // authorized/declined status, no PII/CHD. The client opens this right after initiating a payment to
  // wait for the async issuer decision. On connect it first checks the stored status (race-safe: the
  // outcome may already have landed), otherwise it subscribes to the bus for this journey.
  fastify.get('/:id/stream', {
    schema: {
      tags: ['transactions'],
      summary: 'Live payment authorization outcome (SSE)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    const txnId = (request.params as { id: string }).id;
    const res = beginSSE(reply, request);
    res.write('event: ready\ndata: {}\n\n');

    const emit = (status: string, extra: Record<string, unknown> = {}) => res.write(`data: ${JSON.stringify({ status, ...extra })}\n\n`);

    // If the outcome already landed before this connection, emit it now and close.
    try {
      const txn = await fastify.db.collection<{ cardTransactionStatus?: string }>(CARD_TRANSACTION_COLLECTION)
        .findOne({ cardTransactionInstanceReference: txnId }, { projection: { _id: 0, cardTransactionStatus: 1 } });
      if (txn && txn.cardTransactionStatus && txn.cardTransactionStatus !== 'pending') {
        emit(txn.cardTransactionStatus);
        return res.end();
      }
    } catch { /* fall through to live subscription */ }

    const sub = getEventBus().subscribe('card.payment.authorization.completed', (e) => {
      const p = e.payload as { outcome?: 'authorized' | 'declined'; fraudCaseCreated?: boolean; fraudDiagnosisInstanceReference?: string; decisionReason?: string; responseCode?: string };
      emit(p.outcome === 'declined' ? 'declined' : 'authorized', {
        fraudCaseCreated: !!p.fraudCaseCreated, caseId: p.fraudDiagnosisInstanceReference ?? null,
        declineReason: p.decisionReason ?? null, declineCode: p.responseCode ?? null,
      });
    }, { correlationId: txnId });

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
    request.raw.on('close', () => { clearInterval(keepAlive); sub.unsubscribe(); res.end(); });
  });

  // Dual-auth without the `dualAuth` route flag: `/api/v1/transactions` is a PUBLIC_EXACT path
  // (simulator reads without a session), so we must NOT 401 anonymous callers. Detect a merchant
  // OAuth Bearer best-effort (scope-gated); otherwise fall back to the existing session/public RBAC.
  fastify.get('/', {
    preHandler: async (request, reply) => {
      const mc = await tryMerchantContext(request);
      if (mc) {
        if (!mc.scopes.includes('read:transactions')) {
          return reply.status(403).send({ error: 'insufficient_scope', error_description: 'Required scope: read:transactions' });
        }
        request.merchantContext = mc;
        return; // merchant channel authorized
      }
      return requirePermission('transactions', 'view')(request, reply);
    },
    schema: {
      tags: ['transactions'],
      summary: 'List transactions by card token (session) or the merchant on-behalf-of operation history (OAuth)',
      description: `Returns all transactions associated with a card token, sorted by
\`cardTransactionDateTime\` descending (most recent first).

The query uses a standard plaintext index on \`paymentCardReference\` because the card
token is a PAN surrogate and is NOT Cardholder Data under PCI DSS v4.0.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          cardToken: {
            type: 'string',
            description: 'Card surrogate token (session channel). Same value as `paymentCardReference` in the `paymentCard` collection.',
          },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
      // No strict 200 response schema: this route now serves TWO shapes — the session card-token list
      // (`{ results:[cardTransaction…], count }`) AND the OAuth merchant merged history
      // (`{ results:[{ grossAmount, paymentExecutionStatus, … }], total, page, limit }`). A strict
      // per-shape schema would make fast-json-stringify silently DROP the other shape's fields.
      response: {
        400: { description: '`cardToken` query parameter missing.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        403: { description: 'OAuth token missing the read:transactions scope.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    // OAuth (merchant on-behalf-of): owner-scoped, merchant-isolated operation history (SD-89).
    // Merges SD-65 executions and the party's own card transactions, display-safe (no CHD).
    if (request.merchantContext) {
      const owner = await resolveOwner(request, reply);
      if (!owner) return;
      const q = request.query as { page?: number; limit?: number };
      const page = Math.max(1, q.page ?? 1);
      const limit = Math.min(100, Math.max(1, q.limit ?? 20));
      if (!owner.ownerPartyRef) return reply.send({ results: [], total: 0, page, limit });

      const merchantId = request.merchantContext.merchantId;
      // Source 1 — SD-65 executions the party made THROUGH THIS merchant (isolation by SD-89 ref).
      const filter = {
        merchantAgreementReference: merchantId,
        $or: [{ initiatorPartyReference: owner.ownerPartyRef }, { beneficiaryPartyReference: owner.ownerPartyRef }],
      };
      const execDocs = await fastify.db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
        .find(filter).sort({ initiatedAt: -1 }).limit(200).toArray();
      const execRows = execDocs.map((d) => ({
        kind: 'transfer' as const,
        paymentExecutionInstanceReference: d.paymentExecutionInstanceReference,
        direction: d.initiatorPartyReference === owner.ownerPartyRef ? 'sent' : 'received',
        grossAmount: d.grossAmount, netAmount: d.netAmount, feeAmount: d.feeAmount, currency: d.currency,
        paymentExecutionRail: d.paymentExecutionRail ?? null,
        paymentExecutionStatus: d.paymentExecutionStatus,
        concept: d.paymentExecutionRemittanceInformation ?? d.routingNote ?? null,
        beneficiaryName: d.beneficiaryName ?? null,
        destinationAccountMasked: d.destinationAccountMasked ?? null,
        initiatedAt: d.initiatedAt?.toISOString() ?? null,
        completedAt: d.completedAt?.toISOString() ?? null,
        _sortAt: d.completedAt ?? d.initiatedAt ?? null,
      }));

      // Source 2 — the party's OWN card transactions made in THIS merchant (masked PAN, no CHD).
      const accountReference = await resolveAccountReferenceForParty(fastify.db, owner.ownerPartyRef);
      const cardTxns = accountReference ? await getPartyCardTransactions(fastify.db, accountReference, 200, merchantId) : [];
      const cardRows = cardTxns.map((t) => ({
        kind: 'card' as const,
        paymentExecutionInstanceReference: t.cardTransactionInstanceReference,
        direction: 'sent',
        grossAmount: t.grossAmount, netAmount: undefined as number | undefined, feeAmount: undefined as number | undefined,
        currency: t.currency, paymentExecutionRail: 'card', paymentExecutionStatus: t.status,
        concept: t.cardTransactionDescription ?? null,
        beneficiaryName: t.merchantName, destinationAccountMasked: t.maskedPan,
        initiatedAt: t.initiatedAt, completedAt: t.initiatedAt,
        _sortAt: t.initiatedAt ? new Date(t.initiatedAt) : null,
      }));

      const merged = [...execRows, ...cardRows].sort((a, b) => {
        const av = a._sortAt ? new Date(a._sortAt).getTime() : 0;
        const bv = b._sortAt ? new Date(b._sortAt).getTime() : 0;
        return bv - av;
      });
      const total = merged.length;
      const results = merged.slice((page - 1) * limit, page * limit).map(({ _sortAt, ...row }) => { void _sortAt; return row; });
      return reply.send({ results, total, page, limit });
    }

    // Session channel: list by card token (existing behavior).
    const { cardToken } = request.query as { cardToken?: string };
    if (!cardToken) {
      return reply.status(400).send({ error: 'cardToken query parameter is required' });
    }
    const result = await getTransactionsByCardToken(fastify.db, cardToken);
    return reply.send(result);
  });

  fastify.get('/:id', {
    preHandler: requirePermission('transactions', 'view'),
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
            merchantAgreementInstanceReference:{ type: 'string', nullable: true, description: 'Payee merchant FK (plaintext, no PII) for KYB linking.' },
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
    const { userRole, escalationToken } = request as unknown as AuthenticatedRequest;
    const txn = await getTransactionById(fastify.db, id, userRole as Parameters<typeof getTransactionById>[2], escalationToken);
    if (!txn) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send(txn);
  });

  // GET /api/v1/transactions/:id/notes  -  customer-safe: returns customer-visible notes list
  fastify.get('/:id/notes', {
    preHandler: requirePermission('transactions', 'view'),
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
    preHandler: requirePermission('transactions', 'view'),
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
          transactionId: { type: 'string', description: 'Filter by exact cardTransactionInstanceReference (PK).' },
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
                  // Payment concept (statement descriptor). Shown as the concept in history for AML/FDS context.
                  cardTransactionDescription:        { type: 'string' },
                  // Fraud/risk status (BIAN SD-83), distinct from the payment authorization status above.
                  fraudCaseCreated:                  { type: 'boolean' },
                  fraudDiagnosisCaseStatus:          { type: ['string', 'null'] },
                  fraudDiagnosisCaseReference:       { type: ['string', 'null'] },
                  fraudDiagnosisCaseSeverity:        { type: ['string', 'null'] },
                  fraudDiagnosisResolutionOutcome:   { type: ['string', 'null'] },
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
    const { status, merchant, cardToken, email, transactionId, page = '1', limit = '20' } = request.query as {
      status?: string; merchant?: string; cardToken?: string; email?: string; transactionId?: string; page?: string; limit?: string;
    };
    // Privacy: a customer may only list their OWN transactions. Ignore any email
    // they pass and scope to the email in their JWT.
    const { userRole } = request as unknown as AuthenticatedRequest;
    const jwtEmail = (request as unknown as { user?: { email?: string } }).user?.email;
    const effectiveEmail = userRole === 'customer' ? jwtEmail : email;
    const result = await getAllTransactions(
      fastify.db,
      { status, merchant, cardToken, email: effectiveEmail, transactionId },
      parseInt(page, 10),
      parseInt(limit, 10)
    );
    return reply.send(result);
  });

  // GET /api/v1/transactions/:id/questions  -  customer-facing list of investigator questions for a
  // transaction. Customers are scoped to their OWN questions (by party); staff see all for the tx.
  fastify.get('/:id/questions', {
    preHandler: requirePermission('transactions', 'view'),
    schema: {
      tags: ['transactions'],
      summary: 'List customer questions for a transaction (SD-83)',
      description: 'Questions posed by L1/L2 investigators that the customer can answer. Immutable once answered.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userRole } = request as unknown as AuthenticatedRequest;
    const partyRef = (request as unknown as { user?: { partyRef?: string } }).user?.partyRef;
    let questions = await listQuestionsByTransaction(fastify.db, id);
    // Ownership scoping for customers (PCI DSS Req 7): only questions addressed to them.
    if (userRole === 'customer') questions = questions.filter((q) => !partyRef || q.transactionId === id);
    return reply.send({ questions });
  });

  // POST /api/v1/transactions/:id/questions/:questionId/response  -  customer submits an immutable answer.
  fastify.post('/:id/questions/:questionId/response', {
    preHandler: requirePermission('transactions', 'view'),
    schema: {
      tags: ['transactions'],
      summary: 'Submit a customer response to an investigator question (immutable)',
      description: 'The customer answers a question on their own transaction. The response cannot be edited '
        + 'or resubmitted once stored (PCI DSS Req 10). Ownership is enforced by the caller party.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id', 'questionId'], properties: { id: { type: 'string' }, questionId: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['option'],
        properties: {
          option: { type: 'string', minLength: 1, maxLength: 80, description: 'Selected option, or "Other".' },
          text: { type: 'string', maxLength: 1000, description: 'Free text, required when option is "Other".' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'Error#' }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { id, questionId } = request.params as { id: string; questionId: string };
    const body = request.body as { option: string; text?: string };
    const partyRef = (request as unknown as { user?: { partyRef?: string } }).user?.partyRef;
    const result = await submitResponse(fastify.db, questionId, { option: body.option, text: body.text }, { partyRef, txnId: id });
    if (!result.ok) {
      const map: Record<string, 400 | 403 | 404 | 409> = { not_found: 404, forbidden: 403, already_closed: 409, invalid: 400 };
      const msg: Record<string, string> = {
        not_found: 'Question not found',
        forbidden: 'You can only answer questions on your own transaction',
        already_closed: 'This question has already been answered and cannot be changed',
        invalid: 'Invalid response for this question',
      };
      return reply.status(map[result.error]).send({ error: msg[result.error] });
    }
    return reply.send(result.question);
  });
}
