import { FastifyInstance } from 'fastify';
import { getCases, getCaseById, updateCase, getCaseEvents } from '../services/fraudDiagnosis.service';

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
      page = '1',
      limit = '20',
    } = request.query as {
      status?: string;
      severity?: string;
      page?: string;
      limit?: string;
    };

    const result = await getCases(
      fastify.db,
      { status, severity },
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
          caseNotes: { type: 'string', description: 'Analyst notes (appended to case, not replacing).' },
          fraudDiagnosisAnalystInstanceReference: { type: 'string', description: 'UUID of the analyst taking ownership (FK to partyAuthentication).' },
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
    const patch = request.body as {
      fraudDiagnosisCaseStatus?: string;
      caseNotes?: string;
      fraudDiagnosisAnalystInstanceReference?: string;
    };
    const result = await updateCase(fastify.db, id, patch as never);
    if (!result) return reply.status(404).send({ error: 'Fraud case not found' });
    return reply.send({
      fraudDiagnosisInstanceReference: (result as { fraudDiagnosisInstanceReference: string }).fraudDiagnosisInstanceReference,
      fraudDiagnosisCaseStatus: (result as { fraudDiagnosisCaseStatus: string }).fraudDiagnosisCaseStatus,
      recordUpdatedDateTime: (result as { recordUpdatedDateTime: Date }).recordUpdatedDateTime,
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
    return reply.send({
      fraudDiagnosisInstanceReference: id,
      fraudDiagnosisCaseStatus: 'escalated',
      escalationDateTime: new Date().toISOString(),
      escalationToken: null,
      _v2note: 'DEK-sensitive escalation token will be issued in v2',
    });
  });
}
