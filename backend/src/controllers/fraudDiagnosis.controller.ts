import { FastifyInstance } from 'fastify';
import { getCases, getCaseById } from '../services/fraudDiagnosis.service';

export async function fraudDiagnosisController(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['fraud-diagnosis'],
      summary: 'List fraud diagnosis cases',
      description: `Returns a paginated list of fraud investigation cases (BIAN SD-83 Fraud Diagnosis).

**BIAN lifecycle states:** \`open\` → \`under_review\` → \`escalated\` → \`resolved_cleared\` / \`resolved_fraud\` → \`closed\`

**Extended Reference Pattern:** each case document embeds a \`transactionSnapshot\` with
the key display fields from the originating \`cardTransaction\` document, so the list view
is satisfied by a single collection query without \`$lookup\`.

**Audit trail:** Audit events are stored in the \`fraudDiagnosisCaseEvents\` collection
(separate from the case document to avoid the Unbounded Array anti-pattern). A future
\`GET /api/v1/fraud-diagnosis-cases/:id/events\` endpoint will expose them (v2).`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'],
            description: 'Filter by BIAN lifecycle status',
          },
          severity: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Filter by risk severity',
          },
          page: { type: 'string', default: '1', description: 'Page number (1-based)' },
          limit: { type: 'string', default: '20', description: 'Records per page (max 100)' },
        },
      },
      response: {
        200: {
          description: 'Paginated case list',
          type: 'object',
          properties: {
            cases: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  fraudDiagnosisInstanceReference: { type: 'string' },
                  fraudDiagnosisCaseReference: { type: 'string', example: 'FD-2026-000001' },
                  caseStatus: { type: 'string' },
                  riskSeverity: { type: 'string' },
                  transactionSnapshot: { $ref: 'TransactionSnapshot#' },
                  requestDateTime: { type: 'string', format: 'date-time' },
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
      description: `Returns a single fraud investigation case with the embedded
\`transactionSnapshot\` and the risk assessment details.

**Note on audit trail:** Audit events (who did what and when) are stored in the separate
\`fraudDiagnosisCaseEvents\` collection. They are not included in this response to keep
the case document bounded. A dedicated events endpoint is planned for v2.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'fraudDiagnosisInstanceReference (UUID)' },
        },
      },
      response: {
        200: {
          description: 'Fraud diagnosis case',
          type: 'object',
          properties: {
            fraudDiagnosisInstanceReference: { type: 'string' },
            fraudDiagnosisCaseReference: { type: 'string', example: 'FD-2026-000001' },
            caseStatus: { type: 'string', enum: ['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'] },
            riskSeverity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            linkedCardTransactionReference: { type: 'string', description: 'FK to cardTransaction' },
            linkedCustomerAgreementReference: { type: 'string', description: 'FK to customerAgreement' },
            transactionSnapshot: { $ref: 'TransactionSnapshot#' },
            fraudDiagnosisAssessment: { $ref: 'FraudDiagnosisAssessment#' },
            requestDateTime: { type: 'string', format: 'date-time' },
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
