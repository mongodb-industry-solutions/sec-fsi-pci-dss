import { FastifyInstance } from 'fastify';
import { listPendingForParty } from '../../fraud/services/customerQuestion.service';

// Customer notifications. Currently surfaces pending fraud-investigation questions the customer must
// answer. Scoped to the caller's own party (PCI DSS Req 7); customers are not exposed to fraud-case
// internals here, only the actionable item and a link to the related transaction.
export async function notificationsController(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['notifications'],
      summary: 'Pending notifications for the current user',
      description: 'Returns actionable items for the signed-in user, e.g. unanswered security questions '
        + 'on their transactions. Each item links to the page where it can be resolved.',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request) => {
    const partyRef = (request as unknown as { user?: { partyRef?: string } }).user?.partyRef ?? '';
    const pending = await listPendingForParty(fastify.db, partyRef);
    const items = pending.map((q) => ({
      type: 'fraud_question' as const,
      id: q.questionId,
      transactionId: q.transactionId,
      caseReference: q.caseReference,
      title: 'A security question needs your response',
      detail: q.questionText,
      href: `/system/payment/history/${q.transactionId}`,
      createdAt: q.askedDateTime,
    }));
    return { count: items.length, items };
  });
}
