import { FastifyInstance } from 'fastify';
import { requireTpp } from '../../../vendors/middleware/tppAuth';
import { demoCredit } from '../services/ledger.service';
import { findAccount } from '../../aisp/services/accountInformation.service';

// Crediting an account is the BANK's operation, which is the whole point of moving it here: the PSP
// used to mint money on its own ledger, and a PSP cannot do that. It is a demo affordance, not an
// Open Banking endpoint, so it is documented as such rather than dressed up as one.
export async function demoCreditController(fastify: FastifyInstance) {
  fastify.post('/accounts/:accountId/credits', {
    // Its own scope, granted separately: no standard scope covers creating funds, and folding it into
    // an AIS scope would let a read-only credential top up an account.
    preHandler: requireTpp('demo-credits'),
    schema: {
      tags: ['accounts'],
      summary: 'Credit an account (demo operation)',
      description:
        'Bank side only, and NOT part of Open Banking: no standard lets a TPP create funds. It exists '
        + 'so the demo can top up an account, and it is the replacement for the PSP endpoint that used '
        + 'to mint money on its own ledger. Every credit is written to the balance audit log.',
      security: [{ tppToken: [] }],
      params: { type: 'object', properties: { accountId: { type: 'string' } }, required: ['accountId'] },
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          currency: { type: 'string' },
          reason: { type: 'string' },
          requestedBy: { type: 'string' },
          endToEndIdentification: { type: 'string', description: "The caller's payment id, kept on the movement." },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            applied: { type: 'boolean' },
            balanceAfter: { type: 'number' },
            currency: { type: 'string' },
          },
        },
        400: { type: 'object', additionalProperties: true },
        401: { type: 'object', additionalProperties: true },
        404: { type: 'object', additionalProperties: true },
      },
    },
  }, async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const body = request.body as { amount: number; currency?: string; reason?: string; requestedBy?: string; endToEndIdentification?: string };

    const account = await findAccount(fastify.db, accountId);
    if (!account) {
      return reply.status(404).send({
        tppMessages: [{ category: 'ERROR', code: 'RESOURCE_UNKNOWN', text: 'No such account' }],
      });
    }
    const currency = body.currency ?? account.accountCurrency;
    if (currency !== account.accountCurrency) {
      return reply.status(400).send({
        tppMessages: [{ category: 'ERROR', code: 'CURRENCY_MISMATCH', text: `Account is held in ${account.accountCurrency}` }],
      });
    }

    const result = await demoCredit(fastify.db, {
      accountRef: accountId,
      amount: body.amount,
      currency,
      reason: body.reason,
      requestedBy: body.requestedBy,
      // The caller's own payment id, so the movement is queryable from the PSP side.
      correlationId: body.endToEndIdentification ?? request.correlationId,
    });

    if (!result.applied) {
      return reply.status(400).send({
        tppMessages: [{ category: 'ERROR', code: 'EXECUTION_FAILED', text: result.reason ?? 'credit refused' }],
      });
    }
    return { applied: true, balanceAfter: result.balanceAfter, currency };
  });
}
