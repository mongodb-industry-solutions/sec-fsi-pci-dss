// BIAN SD-66: Payout Account Arrangement — REST controller (v17)
// Routes mounted at /accounts → /api/v1/accounts/:partyRef
// Scope: customer can only access own accounts; staff roles can view all.

import { FastifyInstance } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import type { PayoutAccountStatus } from '../models/payoutAccount.model';
import { requirePermission } from '../../../vendors/middleware/acl';
import {
  listPayoutAccounts,
  getPayoutAccount,
  createPayoutAccount,
  setDefaultPayoutAccount,
  closePayoutAccount,
} from '../services/payoutAccount.service';

function safeAccount(doc: unknown) {
  // Strip Binary ciphertext fields that were not decrypted (non-L2 client)
  const { payoutAccountIban, payoutAccountRoutingNumber, _id, ...rest } = doc as any;
  void payoutAccountIban; void payoutAccountRoutingNumber; void _id;
  return rest;
}

function getUser(request: unknown): JwtUserPayload | undefined {
  return (request as { user?: JwtUserPayload }).user;
}

export async function payoutAccountController(fastify: FastifyInstance) {

  // GET /api/v1/accounts/:partyRef
  fastify.get('/:partyRef', {
    preHandler: requirePermission('accounts', 'view'),
    schema: {
      tags: ['accounts'],
      summary: 'List payout accounts for a party (SD-66)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['partyRef'], properties: { partyRef: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const { partyRef } = request.params as { partyRef: string };
    const user = getUser(request);
    const q = request.query as { status?: string; page?: number; limit?: number };

    // Customers can only access their own accounts (scope: own)
    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied: you can only view your own accounts' });
    }

    const opts: { status?: PayoutAccountStatus; page?: number; limit?: number } = {
      status: q.status as PayoutAccountStatus | undefined,
      page: q.page,
      limit: q.limit,
    };
    const { results, total } = await listPayoutAccounts(fastify.db, partyRef, opts);
    return reply.send({ results: results.map(safeAccount), total, page: q.page ?? 1, limit: q.limit ?? 20 });
  });

  // POST /api/v1/accounts/:partyRef
  fastify.post('/:partyRef', {
    preHandler: requirePermission('accounts', 'manage'),
    schema: {
      tags: ['accounts'],
      summary: 'Register a payout account (SD-66)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['partyRef'], properties: { partyRef: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['payoutAccountType', 'payoutAccountCurrency', 'payoutAccountCountryCode', 'payoutAccountPreferredRail'],
        properties: {
          payoutAccountType: { type: 'string', enum: ['bank_account', 'wallet', 'internal_ledger'] },
          payoutAccountCurrency: { type: 'string' },
          payoutAccountCountryCode: { type: 'string' },
          payoutAccountPreferredRail: { type: 'string', enum: ['sepa', 'ach', 'local_bank', 'internal_wallet', 'internal_ledger'] },
          payoutAccountAlias: { type: 'string' },
          payoutAccountBankName: { type: 'string' },
          payoutAccountIsDefault: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { partyRef } = request.params as { partyRef: string };
    const user = getUser(request);

    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied: you can only register accounts for yourself' });
    }

    const body = request.body as Parameters<typeof createPayoutAccount>[1];
    const account = await createPayoutAccount(fastify.db, { ...body, partyInstanceReference: partyRef });
    return reply.status(201).send(safeAccount(account));
  });

  // GET /api/v1/accounts/:partyRef/:accountRef
  fastify.get('/:partyRef/:accountRef', {
    preHandler: requirePermission('accounts', 'view'),
    schema: {
      tags: ['accounts'],
      summary: 'Get a single payout account (SD-66)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['partyRef', 'accountRef'],
        properties: { partyRef: { type: 'string' }, accountRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { partyRef, accountRef } = request.params as { partyRef: string; accountRef: string };
    const user = getUser(request);

    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied: you can only view your own accounts' });
    }

    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account || account.partyInstanceReference !== partyRef) {
      return reply.status(404).send({ error: 'Account not found' });
    }
    return reply.send(safeAccount(account));
  });

  // POST /api/v1/accounts/:partyRef/:accountRef/default
  fastify.post('/:partyRef/:accountRef/default', {
    preHandler: requirePermission('accounts', 'manage'),
    schema: {
      tags: ['accounts'],
      summary: 'Set default payout account (SD-66)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['partyRef', 'accountRef'],
        properties: { partyRef: { type: 'string' }, accountRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { partyRef, accountRef } = request.params as { partyRef: string; accountRef: string };
    const user = getUser(request);

    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied: you can only manage your own accounts' });
    }

    const ok = await setDefaultPayoutAccount(fastify.db, partyRef, accountRef);
    if (!ok) return reply.status(404).send({ error: 'Account not found or not active' });
    return reply.send({ payoutAccountInstanceReference: accountRef, payoutAccountIsDefault: true });
  });

  // DELETE /api/v1/accounts/:partyRef/:accountRef
  fastify.delete('/:partyRef/:accountRef', {
    preHandler: requirePermission('accounts', 'manage'),
    schema: {
      tags: ['accounts'],
      summary: 'Close a payout account (SD-66)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['partyRef', 'accountRef'],
        properties: { partyRef: { type: 'string' }, accountRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { partyRef, accountRef } = request.params as { partyRef: string; accountRef: string };
    const user = getUser(request);

    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied: you can only manage your own accounts' });
    }

    const ok = await closePayoutAccount(fastify.db, partyRef, accountRef);
    if (!ok) return reply.status(404).send({ error: 'Account not found or already closed' });
    return reply.send({ payoutAccountInstanceReference: accountRef, payoutAccountStatus: 'closed' });
  });
}
