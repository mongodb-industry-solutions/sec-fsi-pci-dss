import { FastifyInstance } from 'fastify';
import type { AuthenticatedRequest } from '../../../shared/models/identity.model';
import { getCustomerTransactions } from '../services/customerActivity.service';

// Mounted at /customer  -  route is /:customerId/transactions (clean sub-resource of the customer
// agreement, mirroring /:customerId/cards). Staff-only VIEW of a found customer's activity.
export async function customerActivityController(fastify: FastifyInstance) {
  // GET /api/v1/customer/:customerId/transactions
  fastify.get('/:customerId/transactions', {
    schema: {
      tags: ['customer'],
      summary: 'List a customer\'s transactions (staff investigation view)',
      description: `Returns a paginated, display-safe merge of the customer's SD-65 payment executions
(sent/received) and SD-254 card transactions, resolved from \`:customerId\`
(\`customerAgreementInstanceReference\`) via the agreement's \`partyInstanceReference\`.

**Role gate (PCI DSS Req 7 least privilege):** restricted to \`level2_investigator\` and
\`security_auditor\`. The \`customer\` and \`level1_analyst\` roles receive 403.

**PCI DSS:** rows are display-safe only (amount, currency, status, rail, concept, masked PAN /
masked destination account). No full PAN, CVV, raw IBAN or raw gateway payload is ever returned.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId'],
        properties: {
          customerId: { type: 'string', description: '`customerAgreementInstanceReference` UUID.' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
      // No strict 200 schema: the row is a dual-shape (transfer/card) union; a strict per-field schema
      // would make fast-json-stringify silently DROP fields (project memory). Use documented text only.
      response: {
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        403: { description: 'Restricted to investigator and auditor roles.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string };
    const { page, limit } = request.query as { page?: number; limit?: number };
    const { userRole } = request as unknown as AuthenticatedRequest;
    try {
      const result = await getCustomerTransactions(fastify.db, customerId, userRole, page ?? 1, limit ?? 20);
      return reply.send(result);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 403) return reply.status(403).send({ error: e.message ?? 'Forbidden' });
      throw err;
    }
  });
}
