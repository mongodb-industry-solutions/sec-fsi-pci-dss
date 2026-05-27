import { FastifyInstance } from 'fastify';
import { getCases, getCaseById } from '../services/fraudDiagnosis.service';

export async function fraudDiagnosisController(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
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

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const fraudCase = await getCaseById(fastify.db, id);
    if (!fraudCase) return reply.status(404).send({ error: 'Fraud case not found' });

    return reply.send({
      fraudDiagnosisInstanceReference: fraudCase.fraudDiagnosisInstanceReference,
      caseReference: fraudCase.caseReference,
      caseStatus: fraudCase.fraudDiagnosisCaseStatus,
      riskSeverity: fraudCase.fraudDiagnosisCaseSeverity,
      linkedCardTransactionReference: fraudCase.linkedCardTransactionReference,
      linkedCustomerAgreementReference: fraudCase.linkedCustomerAgreementReference,
      fraudDiagnosisAssessment: fraudCase.fraudDiagnosisAssessment,
      diagnosisActionLog: fraudCase.diagnosisActionLog,
      requestDateTime: fraudCase.fraudDiagnosisRequestDateTime,
    });
  });
}
