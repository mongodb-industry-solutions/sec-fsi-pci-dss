import { FastifyInstance } from 'fastify';
import { getCases, getCaseById } from '../services/fraudDiagnosis.service';

export async function fraudDiagnosisController(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['fraud-diagnosis'],
      summary: 'List fraud diagnosis cases (paginated)',
      description: `Returns a paginated list of \`fraudDiagnosisCase\` documents (BIAN SD-83).

**BIAN lifecycle:** \`open\` → \`under_review\` → \`escalated\` → \`resolved_cleared\` / \`resolved_fraud\` → \`closed\`

Each case embeds a \`transactionSnapshot\` with the key display fields from the originating
\`cardTransaction\` document (Extended Reference Pattern); the list view requires only a
single collection query with no \`$lookup\`.

**Audit trail:** events (who acted, when, what) are stored in the separate
\`fraudDiagnosisCaseEvents\` collection to avoid unbounded array growth. A dedicated
\`GET /api/v1/fraud-diagnosis-cases/:id/events\` endpoint is planned for v2.`,
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
          description: 'Paginated list of fraud cases sorted by `fraudDiagnosisRequestDateTime` descending.',
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
                  fraudDiagnosisCaseStatus: {
                    type: 'string',
                    enum: ['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'],
                    description: 'Current BIAN lifecycle status.',
                  },
                  fraudDiagnosisCaseSeverity: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'critical'],
                    description: 'Risk severity derived from transaction amount and indicator count.',
                  },
                  transactionSnapshot: { $ref: 'TransactionSnapshot#' },
                  fraudDiagnosisRequestDateTime: { type: 'string', format: 'date-time', description: 'UTC timestamp when the case was opened.' },
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
    return reply.send(result);
  });

  fastify.get('/:id', {
    schema: {
      tags: ['fraud-diagnosis'],
      summary: 'Get a fraud diagnosis case by ID',
      description: `Returns a single \`fraudDiagnosisCase\` document with the embedded
\`transactionSnapshot\` and the risk assessment.

**Linked data (not embedded; requires separate requests):**
- Transaction details: \`GET /api/v1/card-transactions/:linkedCardTransactionReference\`
- Customer agreement: \`GET /api/v1/customer-agreements?accountRef=<customerAgreementReference>\`
- Audit events: planned for v2 (\`GET /api/v1/fraud-diagnosis-cases/:id/events\`)`,
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
              description: 'UUID of the originating `cardTransaction` document. Use with `GET /api/v1/card-transactions/:id`.',
            },
            linkedCustomerAgreementReference: {
              type: 'string',
              description: 'UUID of the subject `customerAgreement` document. Use with `GET /api/v1/customer-agreements`.',
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
}
