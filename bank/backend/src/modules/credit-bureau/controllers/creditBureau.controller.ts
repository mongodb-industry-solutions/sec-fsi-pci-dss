import { FastifyInstance } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import { assessAndRecord, findAssessment } from '../services/creditAssessment.service';

// The bank as credit bureau. Not Open Banking framed, because no such standard exists here: Berlin Group
// covers accounts and payments, and a credit assessment is neither.
const ERROR_RESPONSE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    tppMessages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: { category: { type: 'string' }, code: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
} as const;

const ASSESSMENT_RESPONSE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    accountHolderReference: { type: 'string' },
    creditScore: { type: 'number' },
    creditRating: { type: 'string', description: 'A to E.' },
    defaultProbability: { type: 'number', description: '0 to 1.' },
    assessmentFactors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          assessmentFactorName: { type: 'string' },
          assessmentFactorPoints: { type: 'number' },
          assessmentFactorObservation: { type: 'string' },
        },
      },
    },
    assessmentAsOfDateTime: { type: 'string' },
  },
} as const;

function messages(code: string, text: string) {
  return { tppMessages: [{ category: 'ERROR', code, text }] };
}

export async function creditBureauController(fastify: FastifyInstance) {
  // ── POST /v1/credit-assessments ──────────────────────────────────────────────────────────────
  fastify.post('/credit-assessments', {
    preValidation: requireTpp('credit-assessments', 'AISP'),
    schema: {
      tags: ['credit'],
      summary: 'Assess a party this bank banks',
      description:
        'A bank is the credit bureau for its own customers: it holds the accounts, the balances and the '
        + 'payment history an assessment is made of, so the score is derived from its own records rather '
        + 'than declared.\n\n'
        + 'The factors that produced the score come back with it. An assessment nobody can account for '
        + 'cannot be contested by the person it is about, which is the whole reason to return the reasoning '
        + 'and not just the number.\n\n'
        + 'A party this bank does not bank is refused rather than scored: a number with no evidence behind '
        + 'it would be worse than no answer.',
      security: [{ tppToken: [] }],
      body: {
        type: 'object',
        required: ['accountHolderReference'],
        properties: {
          accountHolderReference: { type: 'string', description: "The bank's own account holder reference." },
        },
      },
      response: { 200: ASSESSMENT_RESPONSE, 400: ERROR_RESPONSE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE },
    },
  }, async (request, reply) => {
    const { accountHolderReference } = request.body as { accountHolderReference: string };
    const result = await assessAndRecord(fastify.db, accountHolderReference);
    if (!result.ok) {
      return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'This bank holds no accounts for that party, so it has nothing to assess'));
    }
    const { assessment } = result;
    return {
      accountHolderReference,
      creditScore: assessment.creditScore,
      creditRating: assessment.creditRating,
      defaultProbability: assessment.defaultProbability,
      assessmentFactors: assessment.assessmentFactors,
      assessmentAsOfDateTime: assessment.assessmentAsOfDateTime,
    };
  });

  // ── GET /v1/credit-assessments/{accountHolderReference} ──────────────────────────────────────
  fastify.get('/credit-assessments/:accountHolderReference', {
    preValidation: requireTpp('credit-assessments', 'AISP'),
    schema: {
      tags: ['credit'],
      summary: 'Read the assessment as it was last recorded',
      description:
        'The assessment on file, without recomputing it. This is what a decision was made against, which is '
        + 'the version worth reviewing when someone asks why they were declined.',
      security: [{ tppToken: [] }],
      params: {
        type: 'object',
        required: ['accountHolderReference'],
        properties: { accountHolderReference: { type: 'string' } },
      },
      response: { 200: ASSESSMENT_RESPONSE, 401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE },
    },
  }, async (request, reply) => {
    const { accountHolderReference } = request.params as { accountHolderReference: string };
    const assessment = await findAssessment(fastify.db, accountHolderReference);
    if (!assessment) {
      return reply.status(404).send(messages('RESOURCE_UNKNOWN', 'No assessment has been recorded for that party'));
    }
    return {
      accountHolderReference,
      creditScore: assessment.creditScore,
      creditRating: assessment.creditRating,
      defaultProbability: assessment.defaultProbability,
      assessmentFactors: assessment.assessmentFactors,
      assessmentAsOfDateTime: assessment.assessmentAsOfDateTime,
    };
  });
}
