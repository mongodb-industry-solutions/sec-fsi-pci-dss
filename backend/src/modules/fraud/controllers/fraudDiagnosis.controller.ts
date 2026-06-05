import { FastifyInstance } from 'fastify';
import { getCases, getCaseById, updateCase, getCaseEvents, getAllAuditEvents, appendAuditEvent, createFraudCase } from '../services/fraudDiagnosis.service';
import { getTransactionById } from '../../transactions/services/cardTransaction.service';
import { generateToken } from '../../../vendors/security/escalationTokens';

const CUSTOMER_CREDIT_RATING_COLLECTION = 'customerCreditRating';

export async function fraudDiagnosisController(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['fraud'],
      summary: 'List fraud diagnosis cases (paginated)',
      description: `Returns a paginated list of \`fraudDiagnosisCase\` documents (BIAN SD-83).

**BIAN lifecycle:** \`open\` → \`under_review\` → \`escalated\` → \`resolved_cleared\` / \`resolved_fraud\` → \`closed\`

Each case embeds a \`transactionSnapshot\` with the key display fields from the originating
\`cardTransaction\` document (Extended Reference Pattern); the list view requires only a
single collection query with no \`$lookup\`.

**Audit trail:** events (who acted, when, what) are stored in the separate
\`fraudDiagnosisCaseEvents\` collection to avoid unbounded array growth.
Use \`GET /api/v1/fraud/:id/events\` to retrieve the full chronological audit log.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'],
            description: 'Filter by BIAN lifecycle status. Omit to return all statuses.',
          },
          severity: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Filter by risk severity. Derived from transaction amount and risk indicators.',
          },
          transactionId: {
            type: 'string',
            description: 'Filter by `linkedCardTransactionReference` UUID. Returns the case for a specific transaction.',
          },
          page: {
            type: 'string',
            default: '1',
            description: 'Page number (1-based). Combined with `limit` for offset calculation: skip = (page-1) * limit.',
          },
          limit: {
            type: 'string',
            default: '20',
            description: 'Maximum records per page. Recommended maximum: 100.',
          },
        },
      },
      response: {
        200: {
          description: 'Paginated list of fraud cases sorted by `requestDateTime` descending.',
          type: 'object',
          properties: {
            results: {
              type: 'array',
              description: 'Fraud cases for the current page.',
              items: {
                type: 'object',
                properties: {
                  fraudDiagnosisInstanceReference: { type: 'string', description: 'Case UUID. Use in GET /:id to fetch full details.' },
                  fraudDiagnosisCaseReference: { type: 'string', description: 'Human-readable case ID, format `FD-YYYY-NNNNNN`.' },
                  caseStatus: {
                    type: 'string',
                    enum: ['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'],
                    description: 'Current BIAN lifecycle status.',
                  },
                  riskSeverity: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'critical'],
                    description: 'Risk severity derived from transaction amount and indicator count.',
                  },
                  linkedCardTransactionReference: { type: 'string', description: 'UUID of the originating cardTransaction document.' },
                  transactionSnapshot: { $ref: 'TransactionSnapshot#' },
                  requestDateTime: { type: 'string', format: 'date-time', description: 'UTC timestamp when the case was opened.' },
                },
              },
            },
            total: { type: 'number', description: 'Total number of cases matching the filters (used for pagination UI).' },
            page: { type: 'number', description: 'Current page number.' },
            limit: { type: 'number', description: 'Records per page.' },
          },
        },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const {
      status,
      severity,
      transactionId,
      page = '1',
      limit = '20',
    } = request.query as {
      status?: string;
      severity?: string;
      transactionId?: string;
      page?: string;
      limit?: string;
    };

    const result = await getCases(
      fastify.db,
      { status, severity, transactionId },
      parseInt(page, 10),
      parseInt(limit, 10)
    );
    return reply.send({
      results: result.results.map((c) => ({
        fraudDiagnosisInstanceReference: c.fraudDiagnosisInstanceReference,
        fraudDiagnosisCaseReference: c.fraudDiagnosisCaseReference,
        caseStatus: c.fraudDiagnosisCaseStatus,
        riskSeverity: c.fraudDiagnosisCaseSeverity,
        linkedCardTransactionReference: c.linkedCardTransactionReference,
        transactionSnapshot: c.transactionSnapshot,
        requestDateTime: c.fraudDiagnosisRequestDateTime,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  });

  // POST /api/v1/fraud — manually open a fraud investigation case for a transaction
  fastify.post('/', {
    schema: {
      tags: ['fraud'],
      summary: 'Manually open a fraud diagnosis case (SD-83)',
      description: `Creates a \`fraudDiagnosisCase\` for a transaction that did not trigger
automatic fraud detection, based on an analyst decision.

Checks whether a case already exists for the transaction; if so, returns the existing one
without creating a duplicate.

**Risk indicators:** Set to \`['manual_review']\` for analyst-initiated cases.
**Severity:** Derived from the transaction amount using the same thresholds as automatic detection.`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['transactionId'],
        properties: {
          transactionId: { type: 'string', description: '`cardTransactionInstanceReference` UUID of the transaction to investigate.' },
          reason:        { type: 'string', description: 'Reason for opening the case (stored as the first audit event detail).' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            fraudDiagnosisInstanceReference: { type: 'string' },
            fraudDiagnosisCaseReference:     { type: 'string' },
            alreadyExisted:                  { type: 'boolean', description: 'True if a case already existed for this transaction.' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { description: 'Transaction not found.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { transactionId, reason } = request.body as { transactionId: string; reason?: string };

    // Check if a case already exists
    const existing = await getCases(fastify.db, { transactionId }, 1, 1);
    if (existing.results.length > 0) {
      const c = existing.results[0];
      return reply.send({
        fraudDiagnosisInstanceReference: c.fraudDiagnosisInstanceReference,
        fraudDiagnosisCaseReference:     c.fraudDiagnosisCaseReference,
        alreadyExisted: true,
      });
    }

    // Fetch transaction data
    const txn = await getTransactionById(fastify.db, transactionId);
    if (!txn) return reply.status(404).send({ error: 'Transaction not found' });

    // Derive severity from amount
    const amount = (txn as { cardTransactionAmount?: { amount: number } }).cardTransactionAmount?.amount ?? 0;
    const severity =
      amount > 1000 ? 'critical' :
      amount > 500  ? 'high'     :
      amount > 200  ? 'medium'   : 'low';

    const t = txn as unknown as {
      cardTransactionAmount: { amount: number; currency: string };
      cardTransactionMerchantName: string;
      cardTransactionDateTime: Date;
      cardTransactionStatus: 'authorized' | 'declined' | 'pending' | 'settled' | 'disputed';
      cardTransactionMaskedPanDisplay: string;
      cardTransactionAccountReference?: string;
    };

    const snapshot = {
      cardTransactionAmount:           t.cardTransactionAmount,
      cardTransactionMerchantName:     t.cardTransactionMerchantName,
      cardTransactionDateTime:         t.cardTransactionDateTime,
      cardTransactionStatus:           t.cardTransactionStatus,
      cardTransactionMaskedPanDisplay: t.cardTransactionMaskedPanDisplay,
    };

    const result = await createFraudCase(
      fastify.db,
      transactionId,
      t.cardTransactionAccountReference ?? transactionId,
      [reason ? `manual_review: ${reason}` : 'manual_review'],
      severity as 'low' | 'medium' | 'high' | 'critical',
      snapshot
    );

    return reply.send({
      fraudDiagnosisInstanceReference: result.fraudDiagnosisInstanceReference,
      fraudDiagnosisCaseReference:     '', // will be populated once fetched
      alreadyExisted: false,
    });
  });

  fastify.get('/:id', {
    schema: {
      tags: ['fraud'],
      summary: 'Get a fraud diagnosis case by ID',
      description: `Returns a single \`fraudDiagnosisCase\` document with the embedded
\`transactionSnapshot\` and the risk assessment.

**Linked data (not embedded; requires separate requests):**
- Transaction details: \`GET /api/v1/transactions/:linkedCardTransactionReference\`
- Customer agreement: \`GET /api/v1/customer?accountRef=<customerAgreementReference>\`
- Audit events: \`GET /api/v1/fraud/:id/events\``,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: '`fraudDiagnosisInstanceReference` UUID.' },
        },
      },
      response: {
        200: {
          description: 'Full fraud diagnosis case document.',
          type: 'object',
          properties: {
            fraudDiagnosisInstanceReference: { type: 'string', description: 'Case UUID.' },
            fraudDiagnosisCaseReference: { type: 'string', description: 'Human-readable case ID, format `FD-YYYY-NNNNNN`.' },
            caseStatus: {
              type: 'string',
              enum: ['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'],
              description: 'Current BIAN lifecycle status.',
            },
            riskSeverity: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'Risk severity.',
            },
            linkedCardTransactionReference: {
              type: 'string',
              description: 'UUID of the originating `cardTransaction` document. Use with `GET /api/v1/transactions/:id`.',
            },
            linkedCustomerAgreementReference: {
              type: 'string',
              description: 'UUID of the subject `customerAgreement` document. Use with `GET /api/v1/customer`.',
            },
            transactionSnapshot: { $ref: 'TransactionSnapshot#' },
            fraudDiagnosisAssessment: { $ref: 'FraudDiagnosisAssessment#' },
            fraudDiagnosisCaseNotes: {
              type: 'string',
              nullable: true,
              description: 'Internal analyst notes visible to L1, L2, and Security Auditor.',
            },
            fraudDiagnosisCustomerSubjectNotes: {
              type: 'string',
              nullable: true,
              description: 'Customer-facing note shown in the customer transaction detail view.',
            },
            fraudDiagnosisResolutionRecord: {
              type: 'object',
              nullable: true,
              properties: {
                resolutionDateTime: { type: 'string', format: 'date-time' },
                resolutionOutcome: { type: 'string', enum: ['cleared', 'confirmed_fraud', 'referred'] },
                resolutionNotes: { type: 'string' },
                resolvedByInstanceReference: { type: 'string' },
              },
            },
            requestDateTime: { type: 'string', format: 'date-time', description: 'UTC timestamp when the case was opened.' },
          },
        },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        404: { description: 'No fraud case found with the given ID.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const fraudCase = await getCaseById(fastify.db, id);
    if (!fraudCase) return reply.status(404).send({ error: 'Fraud case not found' });

    return reply.send({
      fraudDiagnosisInstanceReference: fraudCase.fraudDiagnosisInstanceReference,
      fraudDiagnosisCaseReference: fraudCase.fraudDiagnosisCaseReference,
      caseStatus: fraudCase.fraudDiagnosisCaseStatus,
      riskSeverity: fraudCase.fraudDiagnosisCaseSeverity,
      linkedCardTransactionReference: fraudCase.linkedCardTransactionReference,
      linkedCustomerAgreementReference: fraudCase.linkedCustomerAgreementReference,
      transactionSnapshot: fraudCase.transactionSnapshot,
      fraudDiagnosisAssessment: fraudCase.fraudDiagnosisAssessment,
      fraudDiagnosisCaseNotes: fraudCase.fraudDiagnosisCaseNotes ?? null,
      fraudDiagnosisCustomerSubjectNotes: fraudCase.fraudDiagnosisCustomerSubjectNotes ?? null,
      fraudDiagnosisResolutionRecord: fraudCase.fraudDiagnosisResolutionRecord ?? null,
      requestDateTime: fraudCase.fraudDiagnosisRequestDateTime,
    });
  });

  // PATCH /api/v1/fraud/:id
  fastify.patch('/:id', {
    schema: {
      tags: ['fraud'],
      summary: 'Update fraud case status or notes (SD-83)',
      description: `Partial update of a \`fraudDiagnosisCase\`. Supports status transitions and analyst assignment.

**Allowed status transitions:**
- \`open\` → \`under_review\` (analyst assigns themselves)
- \`under_review\` → \`escalated\` (use \`POST /fraud/:id/escalate\` for escalation with workflow — v2)
- \`escalated\` → \`resolved_cleared\` | \`resolved_fraud\`
- Any → \`closed\``,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: '`fraudDiagnosisInstanceReference` UUID.' } } },
      body: {
        type: 'object',
        properties: {
          fraudDiagnosisCaseStatus: {
            type: 'string',
            enum: ['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'],
            description: 'New case status.',
          },
          fraudDiagnosisCaseNotes: { type: 'string', description: 'Internal notes for L1/L2 team (overwrites previous notes; include full text).' },
          fraudDiagnosisCustomerSubjectNotes: { type: 'string', description: 'Notes visible to the customer in their transaction detail view.' },
          fraudDiagnosisAnalystInstanceReference: { type: 'string', description: 'UUID of the analyst taking ownership (FK to partyAuthentication).' },
          resolutionOutcome: { type: 'string', enum: ['cleared', 'confirmed_fraud', 'referred'], description: 'Resolution outcome (required when setting status to resolved_cleared or resolved_fraud).' },
          resolutionNotes: { type: 'string', description: 'Resolution notes (required when setting status to resolved_*).' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            fraudDiagnosisInstanceReference: { type: 'string' },
            fraudDiagnosisCaseStatus: { type: 'string' },
            recordUpdatedDateTime: { type: 'string', format: 'date-time' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      fraudDiagnosisCaseStatus?: string;
      fraudDiagnosisCaseNotes?: string;
      fraudDiagnosisCustomerSubjectNotes?: string;
      fraudDiagnosisAnalystInstanceReference?: string;
      resolutionOutcome?: 'cleared' | 'confirmed_fraud' | 'referred';
      resolutionNotes?: string;
    };

    const patch: Parameters<typeof updateCase>[2] = {};
    if (body.fraudDiagnosisCaseStatus) patch.fraudDiagnosisCaseStatus = body.fraudDiagnosisCaseStatus as never;
    if (body.fraudDiagnosisCaseNotes) patch.fraudDiagnosisCaseNotes = body.fraudDiagnosisCaseNotes;
    if (body.fraudDiagnosisCustomerSubjectNotes) patch.fraudDiagnosisCustomerSubjectNotes = body.fraudDiagnosisCustomerSubjectNotes;
    if (body.fraudDiagnosisAnalystInstanceReference) patch.fraudDiagnosisAnalystInstanceReference = body.fraudDiagnosisAnalystInstanceReference;

    if (body.resolutionOutcome) {
      patch.fraudDiagnosisResolutionRecord = {
        resolutionDateTime: new Date(),
        resolutionOutcome: body.resolutionOutcome,
        resolutionNotes: body.resolutionNotes ?? '',
        resolvedByInstanceReference: 'rbac-layer',
      };
    }

    const result = await updateCase(fastify.db, id, patch);
    if (!result) return reply.status(404).send({ error: 'Fraud case not found' });

    // Write audit event for status changes and note additions
    const actionType = body.fraudDiagnosisCaseStatus === 'resolved_cleared' || body.fraudDiagnosisCaseStatus === 'resolved_fraud' || body.fraudDiagnosisCaseStatus === 'closed'
      ? 'resolved' as const
      : body.fraudDiagnosisCaseNotes || body.fraudDiagnosisCustomerSubjectNotes
      ? 'note_added' as const
      : undefined;

    if (actionType) {
      await appendAuditEvent(fastify.db, id, actionType, 'level1_analyst', {
        newStatus: body.fraudDiagnosisCaseStatus,
        hasInternalNote: !!body.fraudDiagnosisCaseNotes,
        hasCustomerNote: !!body.fraudDiagnosisCustomerSubjectNotes,
        resolutionOutcome: body.resolutionOutcome,
      });
    }

    const updated = result as unknown as { fraudDiagnosisInstanceReference: string; fraudDiagnosisCaseStatus: string; recordUpdatedDateTime: Date };
    return reply.send({
      fraudDiagnosisInstanceReference: updated.fraudDiagnosisInstanceReference,
      fraudDiagnosisCaseStatus: updated.fraudDiagnosisCaseStatus,
      recordUpdatedDateTime: updated.recordUpdatedDateTime,
    });
  });

  // GET /api/v1/fraud/:id/events  [v2]
  fastify.get('/:id/events', {
    schema: {
      tags: ['fraud'],
      summary: 'List audit events for a fraud case (SD-83)',
      description: `Returns the chronological audit event log for a \`fraudDiagnosisCase\` from \`fraudDiagnosisCaseEvents\`.

Each event records who acted, when, the action type, and any associated details.
Events are append-only; they are never updated or deleted.

**Event types:** \`case_opened\`, \`assigned\`, \`note_added\`, \`field_accessed\`, \`escalated\`, \`ai_review\`, \`resolved\`, \`closed\``,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: '`fraudDiagnosisInstanceReference` UUID.' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  actionDateTime: { type: 'string', format: 'date-time' },
                  actionType: {
                    type: 'string',
                    enum: ['case_opened', 'assigned', 'note_added', 'field_accessed', 'escalated', 'ai_review', 'resolved', 'closed'],
                  },
                  performedByInstanceReference: { type: 'string' },
                  performedByRole: {
                    type: 'string',
                    enum: ['payment_service', 'level1_analyst', 'level2_investigator', 'security_auditor', 'ai_agent'],
                  },
                  actionDetails: { type: 'object', additionalProperties: true },
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
    const fraudCase = await getCaseById(fastify.db, id);
    if (!fraudCase) return reply.status(404).send({ error: 'Fraud case not found' });
    const result = await getCaseEvents(fastify.db, id);
    return reply.send(result);
  });

  // GET /api/v1/fraud/audit-events  [v2]
  fastify.get('/audit-events', {
    schema: {
      tags: ['fraud'],
      summary: 'List all audit events across all cases (Security Auditor)',
      description: `Returns all events from the \`fraudDiagnosisCaseEvents\` collection sorted by
date descending. Includes case reference for each event.

Intended for the Security Auditor role to review access governance, traceability,
and evidence integrity across the entire fraud investigation operation.

Each event records: who acted, in which role, when, on which case, and what action was taken.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', default: '1' },
          limit: { type: 'string', default: '50' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fraudDiagnosisInstanceReference: { type: 'string' },
                  fraudDiagnosisCaseReference: { type: 'string' },
                  actionDateTime: { type: 'string', format: 'date-time' },
                  actionType: { type: 'string' },
                  performedByInstanceReference: { type: 'string' },
                  performedByRole: { type: 'string' },
                  actionDetails: { type: 'object', additionalProperties: true },
                },
              },
            },
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
          },
        },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { page = '1', limit = '50' } = request.query as { page?: string; limit?: string };
    const result = await getAllAuditEvents(fastify.db, parseInt(page, 10), parseInt(limit, 10));
    return reply.send(result);
  });

  // GET /api/v1/fraud/hrpc/check  [v2]
  fastify.get('/hrpc/check', {
    schema: {
      tags: ['fraud'],
      summary: 'Check HRPC risk profile for a customer account',
      description: `Validates whether a customer account reference appears in any
High-Risk Person and Counterparty (HRPC) category.

HRPC categories are defined risk indicators that require enhanced scrutiny in fraud,
AML, KYC, sanctions, and EDD contexts. Presence in an HRPC category is a risk
indicator, not proof of fraud.

**HRPC categories supported:**
- \`pep\` - Politically Exposed Person
- \`sip\` - Special Interest Person
- \`hnwi\` - High Net Worth Individual
- \`ubo\` - Ultimate Beneficial Owner with complex structure
- \`terrorism_linked\` - Terrorism or sanctions overlap
- \`high_risk_jurisdiction\` - Transaction activity in elevated-risk jurisdictions
- \`sanctioned\` - Active sanctions match
- \`financial_fraud_history\` - Prior confirmed fraud
- \`suspicious_transaction_patterns\` - Behavioral anomaly pattern

Returns an empty \`hrpcFlags\` array when the account is not in any HRPC category.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['accountRef'],
        properties: {
          accountRef: { type: 'string', description: 'Customer agreement reference (QE:equality searchable field).' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accountRef: { type: 'string' },
            hrpcMatch: { type: 'boolean', description: 'True when one or more HRPC flags are active for this account.' },
            highestRiskLevel: { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: 'Highest risk level across all active flags.' },
            hrpcFlags: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
                  label: { type: 'string' },
                  description: { type: 'string' },
                  detectedAt: { type: 'string' },
                  source: { type: 'string' },
                  reviewRequired: { type: 'boolean' },
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
    const { accountRef } = request.query as { accountRef: string };
    if (!accountRef) return reply.status(400).send({ error: 'accountRef query parameter is required' });

    const profile = await fastify.db
      .collection(CUSTOMER_CREDIT_RATING_COLLECTION)
      .findOne({ customerAgreementReference: accountRef });

    const rawFlags: Record<string, unknown>[] = (profile?.customerCreditRatingClassificationFlags as Record<string, unknown>[]) ?? [];

    // Map BIAN field names to compact response field names for the API consumer
    const flags = rawFlags.map((f) => ({
      category: f.customerCreditRatingClassificationCategory,
      riskLevel: f.customerCreditRatingClassificationLevel,
      label: f.customerCreditRatingClassificationLabel,
      description: f.customerCreditRatingClassificationDescription,
      detectedAt: f.customerCreditRatingClassificationDetectedDateTime,
      source: f.customerCreditRatingClassificationSource,
      reviewRequired: f.customerCreditRatingReviewRequiredIndicator,
    }));

    const riskOrder: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };
    const highestRiskLevel = flags.reduce<'none' | 'low' | 'medium' | 'high'>((acc, f) => {
      const lvl = (f.riskLevel as string) ?? 'none';
      return (riskOrder[lvl] ?? 0) > riskOrder[acc] ? (lvl as 'low' | 'medium' | 'high') : acc;
    }, 'none');

    return reply.send({
      accountRef,
      hrpcMatch: flags.length > 0,
      highestRiskLevel,
      hrpcFlags: flags,
    });
  });

  // POST /api/v1/fraud/:id/escalate  [v2]
  fastify.post('/:id/escalate', {
    schema: {
      tags: ['fraud'],
      summary: 'Escalate a fraud case to Level 2 (SD-83) [v2]',
      description: `Escalates an \`under_review\` case to Level 2 Investigator.
Generates an escalation record and appends an \`escalated\` event to \`fraudDiagnosisCaseEvents\`.
The Level 2 Investigator gains access to QE:none sensitive fields (DEK-sensitive) via the escalation token.

**v2 note:** Full escalation workflow with DEK-sensitive token issuance is implemented in v2.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['escalationReason'],
        properties: {
          escalationReason: { type: 'string', description: 'Reason for escalating this case to Level 2.' },
          escalatedToInstanceReference: { type: 'string', description: 'Optional: UUID of the target Level 2 investigator.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            fraudDiagnosisInstanceReference: { type: 'string' },
            fraudDiagnosisCaseStatus: { type: 'string', enum: ['escalated'] },
            escalationDateTime: { type: 'string', format: 'date-time' },
            escalationToken: { type: 'string', description: '[v2] Short-lived token granting DEK-sensitive access. Not yet implemented.' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        422: { description: 'Case is not in under_review status.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { escalationReason } = request.body as { escalationReason: string };
    if (!escalationReason) return reply.status(400).send({ error: 'escalationReason is required' });
    const result = await updateCase(fastify.db, id, { fraudDiagnosisCaseStatus: 'escalated' } as never);
    if (!result) return reply.status(404).send({ error: 'Fraud case not found' });
    await appendAuditEvent(fastify.db, id, 'escalated', 'level1_analyst', {
      escalationReason,
      escalationDateTime: new Date().toISOString(),
    });
    return reply.send({
      fraudDiagnosisInstanceReference: id,
      fraudDiagnosisCaseStatus: 'escalated',
      escalationDateTime: new Date().toISOString(),
    });
  });

  // POST /api/v1/fraud/:id/escalate/approve  [FR-v2-11]
  fastify.post('/:id/escalate/approve', {
    schema: {
      tags: ['fraud'],
      summary: 'Approve escalation and issue L2 access token (FR-v2-11)',
      description: `Approves an escalated case for Level 2 investigation.

**What this endpoint does:**
1. Validates the case is in \`escalated\` status
2. Calls \`generateToken(caseId, 'level2_investigator')\` to issue a short-lived escalation token
3. Appends a \`field_accessed\` audit event documenting the approval
4. Returns the token to the L2 Investigator

**How the token is used:**
The L2 Investigator includes the token in the \`X-Escalation-Token\` header when calling
customer and transaction endpoints. The RBAC middleware validates the token and grants
access to DEK-sensitive QE:none fields (\`customerAgreementSensitive\`, \`cardTransactionSensitive\`).

Token TTL: 4 hours. Use \`POST /fraud/:id/escalate/approve\` again to renew.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: '`fraudDiagnosisInstanceReference` UUID.' } },
      },
      body: {
        type: 'object',
        properties: {
          approvalNotes: { type: 'string', description: 'Optional notes from the approving L2 investigator.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            fraudDiagnosisInstanceReference: { type: 'string' },
            fraudDiagnosisCaseStatus: { type: 'string', enum: ['escalated'] },
            escalationToken: {
              type: 'string',
              description: 'Short-lived UUID token granting DEK-sensitive access to QE:none fields. Valid for 4 hours. Include in X-Escalation-Token header.',
            },
            escalationApprovedAt: { type: 'string', format: 'date-time' },
            tokenExpiresAt: { type: 'string', format: 'date-time' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        422: { description: 'Case is not in escalated status.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { approvalNotes } = (request.body as { approvalNotes?: string }) ?? {};

    const fraudCase = await getCaseById(fastify.db, id);
    if (!fraudCase) return reply.status(404).send({ error: 'Fraud case not found' });
    if (fraudCase.fraudDiagnosisCaseStatus !== 'escalated') {
      return reply.status(422).send({ error: 'Case must be in escalated status to approve' });
    }

    const token = generateToken(id, 'level2_investigator');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);

    await appendAuditEvent(fastify.db, id, 'field_accessed', 'level2_investigator', {
      action: 'escalation_approved',
      approvalNotes: approvalNotes ?? null,
      tokenIssuedAt: now.toISOString(),
      tokenExpiresAt: expiresAt.toISOString(),
    });

    return reply.send({
      fraudDiagnosisInstanceReference: id,
      fraudDiagnosisCaseStatus: 'escalated',
      escalationToken: token,
      escalationApprovedAt: now.toISOString(),
      tokenExpiresAt: expiresAt.toISOString(),
    });
  });
}
