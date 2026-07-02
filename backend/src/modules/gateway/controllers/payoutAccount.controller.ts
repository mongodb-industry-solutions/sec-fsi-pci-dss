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
  updatePayoutAccount,
} from '../services/payoutAccount.service';
import { listAccountMovements, ListMovementsOptions } from '../services/accountMovements.service';
import { getCardsByFundingAccount } from '../../customer/services/paymentCard.service';

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
        additionalProperties: false,
        properties: {
          payoutAccountType: { type: 'string', enum: ['bank_account', 'wallet', 'internal_ledger'] },
          payoutAccountCurrency: { type: 'string', minLength: 3, maxLength: 3 },
          payoutAccountCountryCode: { type: 'string', minLength: 2, maxLength: 2 },
          payoutAccountPreferredRail: { type: 'string', enum: ['sepa', 'ach', 'local_bank', 'internal_wallet', 'internal_ledger'] },
          payoutAccountAlias: { type: 'string', maxLength: 60 },
          payoutAccountBankName: { type: 'string', maxLength: 100 },
          payoutAccountIsDefault: { type: 'boolean' },
          // Plaintext banking metadata
          payoutAccountHolderName: { type: 'string', minLength: 2, maxLength: 140 },
          // ISO 9362: BIC = 4 bank + 2 country + 2 location + 3 branch (optional); 8 or 11 chars
          payoutAccountBicSwift: { type: 'string', minLength: 8, maxLength: 11, pattern: '^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$' },
          payoutAccountCorrespondentBic: { type: 'string', minLength: 8, maxLength: 11, pattern: '^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$' },
          payoutAccountBankAddress: { type: 'string', maxLength: 200 },
          // QE-encrypted — omit entirely when not provided (null triggers error 31041)
          payoutAccountIban: { type: 'string', minLength: 15, maxLength: 34 },
          payoutAccountRoutingNumber: { type: 'string', maxLength: 50 },
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

  // GET /api/v1/accounts/:partyRef/:accountRef/movements
  fastify.get('/:partyRef/:accountRef/movements', {
    preHandler: requirePermission('accounts', 'view'),
    schema: {
      tags: ['accounts'],
      summary: 'List unified account movements (SD-66 ledger)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['partyRef', 'accountRef'], properties: { partyRef: { type: 'string' }, accountRef: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          direction: { type: 'string', enum: ['debit', 'credit'] },
          from: { type: 'string' },
          to: { type: 'string' },
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const { partyRef, accountRef } = request.params as { partyRef: string; accountRef: string };
    const user = getUser(request);
    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied' });
    }
    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account || account.partyInstanceReference !== partyRef) {
      return reply.status(404).send({ error: 'Account not found' });
    }
    const q = request.query as ListMovementsOptions;
    const result = await listAccountMovements(fastify.db, accountRef, q);
    return reply.send(result);
  });

  // PATCH /api/v1/accounts/:partyRef/:accountRef
  fastify.patch('/:partyRef/:accountRef', {
    preHandler: requirePermission('accounts', 'manage'),
    schema: {
      tags: ['accounts'],
      summary: 'Update payout account editable fields (SD-66)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['partyRef', 'accountRef'],
        properties: { partyRef: { type: 'string' }, accountRef: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          payoutAccountAlias: { type: 'string', maxLength: 60 },
          payoutAccountIsDefault: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { partyRef, accountRef } = request.params as { partyRef: string; accountRef: string };
    const user = getUser(request);
    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied' });
    }
    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account || account.partyInstanceReference !== partyRef) {
      return reply.status(404).send({ error: 'Account not found' });
    }
    const body = request.body as { payoutAccountAlias?: string; payoutAccountIsDefault?: boolean };
    const updated = await updatePayoutAccount(fastify.db, accountRef, body);
    return reply.send(safeAccount(updated));
  });

  // GET /:partyRef/:accountRef/cards
  // BIAN SD-88 cardAccountReference: list payment cards funded by this account.
  // PCI Req 7: scoped to the account owner; no CHD returned (masked PAN only).
  fastify.get('/:partyRef/:accountRef/cards', {
    preHandler: requirePermission('accounts', 'view'),
    schema: {
      tags: ['accounts'],
      summary: 'List payment cards linked to this payout account (SD-88)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['partyRef', 'accountRef'], properties: { partyRef: { type: 'string' }, accountRef: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { partyRef, accountRef } = request.params as { partyRef: string; accountRef: string };
    const user = getUser(request);
    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied' });
    }
    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account || account.partyInstanceReference !== partyRef) {
      return reply.status(404).send({ error: 'Account not found' });
    }
    const { results } = await getCardsByFundingAccount(fastify.db, accountRef);
    return reply.send({ results, total: results.length });
  });
}
