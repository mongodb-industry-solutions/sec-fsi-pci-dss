// Payout Account Arrangement, REST controller (v17)
// Routes mounted at /accounts → /api/v1/accounts/:partyRef
// Scope: customer can only access own accounts; staff roles can view all.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';
import type { PayoutAccountStatus } from '../models/payoutAccount.model';
import { requirePermission } from '../../../vendors/middleware/acl';
import { dualPermission, resolveOwner } from '../../../vendors/middleware/dualAuth';
import { maskAccountIdentifier } from '../services/bankTransfer.service';
import { PARTY_COLLECTION } from '../../identity/models/party.model';
import { COUNTERPARTY_COLLECTION } from '../../customer/models/counterpartyArrangement.model';
import {
  listPayoutAccounts,
  getPayoutAccount,
  createPayoutAccount,
  setDefaultPayoutAccount,
  closePayoutAccount,
  updatePayoutAccount,
  type UpdatePayoutAccountInput,
} from '../services/payoutAccount.service';
import { listAccountMovements, ListMovementsOptions } from '../services/accountMovements.service';
import { getCardsByFundingAccount } from '../../customer/services/paymentCard.service';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';
import { CreditType } from '../models/balanceCreditLog.model';
import { creditDirect } from '../services/payoutAccountBalance.service';
import { requestDemoCredit } from '../../../providers/account-information/services/bankcoreAis.client';
import { emitProcessEvent, emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { v4 as uuidv4 } from 'uuid';

function safeAccount(doc: unknown) {
  // Strip QE-encrypted fields from the public response. Include boolean hints so the UI
  // can show a reveal button without exposing the plaintext. PCI DSS.
  const { payoutAccountIban, payoutAccountRoutingNumber, _id, ...rest } = doc as any;
  void _id;
  return {
    ...rest,
    payoutAccountHasIban: typeof payoutAccountIban === 'string' && payoutAccountIban.length > 0,
    payoutAccountHasRoutingNumber: typeof payoutAccountRoutingNumber === 'string' && payoutAccountRoutingNumber.length > 0,
  };
}

// Roles permitted to reveal QE-encrypted IBAN: account owner (customer) handled in-handler.
const IBAN_REVEAL_ROLES = new Set(['level2_investigator', 'security_auditor']);

function getUser(request: unknown): JwtUserPayload | undefined {
  return (request as { user?: JwtUserPayload }).user;
}

// Display-safe projection for the OAuth (merchant) channel: raw IBAN/routing stripped, masked IBAN
// only (GDPR Art. 5/32, PSD2 minimisation). No QE plaintext ever reaches the merchant.
function safeMerchantAccount(doc: Record<string, unknown>) {
  const { payoutAccountIban, payoutAccountRoutingNumber, _id, ...rest } = doc as Record<string, unknown> & {
    payoutAccountIban?: string; payoutAccountRoutingNumber?: string; _id?: unknown;
  };
  void payoutAccountRoutingNumber; void _id;
  const hasIban = typeof payoutAccountIban === 'string' && payoutAccountIban.length > 0;
  return {
    ...rest,
    payoutAccountMaskedIban: hasIban ? maskAccountIdentifier(payoutAccountIban as string) : undefined,
    payoutAccountHasIban: hasIban,
  };
}

export async function payoutAccountController(fastify: FastifyInstance) {

  // ── GET /accounts (+ /:partyRef), list a party's payout accounts ─────────────────────────────
  // Session: staff any party, customer own; QE-stripped with reveal hints.
  // OAuth: owner from token.sub, masked-IBAN projection. Scope read:accounts.
  const listHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { partyRef } = request.params as { partyRef?: string };
    const q = request.query as { status?: string; page?: number; limit?: number };

    if (request.merchantContext) {
      const owner = await resolveOwner(request, reply, partyRef);
      if (!owner) return;
      if (!owner.ownerPartyRef) return reply.send({ results: [], total: 0, page: q.page ?? 1, limit: q.limit ?? 20 });
      const { results, total } = await listPayoutAccounts(fastify.db, owner.ownerPartyRef, { page: q.page, limit: q.limit });
      const safe = results.map((r) => safeMerchantAccount(r as unknown as Record<string, unknown>));
      return reply.send({ results: safe, total, page: q.page ?? 1, limit: q.limit ?? 20 });
    }

    // Session channel: preserve existing staff/customer behavior.
    const user = getUser(request);
    if (!partyRef) {
      return reply.status(400).send({ error: 'A party reference is required.' });
    }
    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied: you can only view your own accounts' });
    }
    const opts: { status?: PayoutAccountStatus; page?: number; limit?: number } = {
      status: q.status as PayoutAccountStatus | undefined, page: q.page, limit: q.limit,
    };
    const { results, total } = await listPayoutAccounts(fastify.db, partyRef, opts);
    return reply.send({ results: results.map(safeAccount), total, page: q.page ?? 1, limit: q.limit ?? 20 });
  };

  const listSchema = (withParty: boolean) => ({
    tags: ['accounts'],
    summary: 'List payout accounts for a party (SD-66, session RBAC or OAuth read:accounts)',
    security: [{ bearerAuth: [] }],
    ...(withParty ? { params: { type: 'object', required: ['partyRef'], properties: { partyRef: { type: 'string' } } } } : {}),
    querystring: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        page: { type: 'number', default: 1 },
        limit: { type: 'number', default: 20, maximum: 100 },
      },
    },
  });

  fastify.get('/', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'accounts', action: 'view', scope: 'read:accounts' }),
    schema: listSchema(false),
  }, listHandler);

  fastify.get('/:partyRef', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'accounts', action: 'view', scope: 'read:accounts' }),
    schema: listSchema(true),
  }, listHandler);

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
          // QE-encrypted: omit entirely when not provided (null triggers error 31041)
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
        additionalProperties: false,
        properties: {
          payoutAccountAlias: { type: 'string', maxLength: 60 },
          payoutAccountIsDefault: { type: 'boolean' },
          payoutAccountBankName: { type: 'string', maxLength: 100 },
          payoutAccountHolderName: { type: 'string', minLength: 2, maxLength: 140 },
          payoutAccountBicSwift: { type: 'string', minLength: 8, maxLength: 11, pattern: '^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$' },
          payoutAccountCorrespondentBic: { type: 'string', minLength: 8, maxLength: 11, pattern: '^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$' },
          payoutAccountBankAddress: { type: 'string', maxLength: 200 },
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
    const body = request.body as UpdatePayoutAccountInput;
    const updated = await updatePayoutAccount(fastify.db, accountRef, body);
    return reply.send(safeAccount(updated));
  });

  // GET /:partyRef/:accountRef/cards
  // cardAccountReference: list payment cards funded by this account.
  // PCI DSS: scoped to the account owner; no CHD returned (masked PAN only).
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

  // GET /:partyRef/:accountRef/iban
  // PCI DSS: IBAN reveal. Scoped to:
  //   - account owner (customer with own partyRef)
  //   - level2_investigator (financial fraud investigation)
  //   - security_auditor (compliance oversight)
  // L1 analysts, merchants, managers: denied (least privilege / SoD).
  fastify.get('/:partyRef/:accountRef/iban', {
    preHandler: requirePermission('accounts', 'view'),
    schema: {
      tags: ['accounts'],
      summary: 'Reveal decrypted IBAN, account owner, L2 investigator or security auditor only (PCI DSS Req 3.3)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['partyRef', 'accountRef'],
        properties: { partyRef: { type: 'string' }, accountRef: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { payoutAccountIban: { type: 'string' } },
          additionalProperties: false,
        },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { partyRef, accountRef } = request.params as { partyRef: string; accountRef: string };
    const user = getUser(request);

    const isOwner = user?.role === 'customer' && user.partyRef === partyRef;
    const isPrivileged = IBAN_REVEAL_ROLES.has(user?.role ?? '');
    if (!isOwner && !isPrivileged) {
      return reply.status(403).send({
        error: 'IBAN access requires account ownership, L2 investigator, or security auditor role (PCI DSS Req 3.3)',
      });
    }

    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account || account.partyInstanceReference !== partyRef) {
      return reply.status(404).send({ error: 'Account not found' });
    }
    if (!account.payoutAccountIban) {
      return reply.status(404).send({ error: 'No IBAN registered for this account' });
    }
    // Disclosure event, same shape as the account-information module twin. Field names only.
    emitComplianceEvent(fastify.db, {
      entityType: 'account', entityId: accountRef,
      processType: 'payment_processing', processAction: 'account.iban.revealed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: {
        channel: isOwner ? 'self_service' : 'investigation',
        partyInstanceReference: account.partyInstanceReference,
        revealedFields: ['payoutAccountIban'],
      },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
    });
    return reply.send({ payoutAccountIban: account.payoutAccountIban });
  });

  // GET /api/v1/accounts/:partyRef/transfers
  // Customer-scoped P2P transfer history (paymentExecutionProcedure, beneficiaryType: 'user').
  // Returns transfers where initiatorPartyReference === partyRef (sent) or beneficiaryPartyReference === partyRef (received).
  // PCI DSS: customer role is restricted to their own partyRef; analysts/auditors may query any partyRef.
  fastify.get('/:partyRef/transfers', {
    preHandler: requirePermission('accounts', 'view'),
    schema: {
      tags: ['accounts'],
      summary: 'List P2P transfers for a party (BIAN SD-65 Payment Execution, beneficiaryType: user)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['partyRef'],
        properties: { partyRef: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          page:  { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  paymentExecutionInstanceReference: { type: 'string' },
                  initiatorPartyReference:           { type: 'string', nullable: true },
                  beneficiaryPartyReference:         { type: 'string', nullable: true },
                  resolvedPayoutAccountReference:    { type: 'string', nullable: true },
                  grossAmount:                       { type: 'number' },
                  netAmount:                         { type: 'number' },
                  feeAmount:                         { type: 'number' },
                  currency:                          { type: 'string' },
                  paymentExecutionRail:              { type: 'string', nullable: true },
                  routingNote:                       { type: 'string', nullable: true },
                  paymentExecutionStatus:            { type: 'string' },
                  direction:                         { type: 'string', description: '"sent" or "received" relative to partyRef' },
                  initiatedAt:                       { type: 'string', nullable: true },
                  completedAt:                       { type: 'string', nullable: true },
                },
              },
            },
            total: { type: 'integer' },
            page:  { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
        403: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { partyRef } = request.params as { partyRef: string };
    const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };
    const user = getUser(request);

    // PCI DSS: customers may only view their own transfers
    if (user?.role === 'customer' && user.partyRef !== partyRef) {
      return reply.status(403).send({ error: 'Access denied: you may only view your own transfers.' });
    }

    const db = fastify.db;
    const skip = (page - 1) * limit;
    const filter = {
      beneficiaryType: 'user' as const,
      $or: [
        { initiatorPartyReference: partyRef },
        { beneficiaryPartyReference: partyRef },
      ],
    };

    const [docs, total] = await Promise.all([
      db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
        .find(filter)
        .sort({ initiatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).countDocuments(filter),
    ]);

    const results = docs.map(d => ({
      paymentExecutionInstanceReference: d.paymentExecutionInstanceReference,
      initiatorPartyReference:           d.initiatorPartyReference ?? null,
      beneficiaryPartyReference:         d.beneficiaryPartyReference ?? null,
      resolvedPayoutAccountReference:    d.resolvedPayoutAccountReference ?? null,
      grossAmount:                       d.grossAmount,
      netAmount:                         d.netAmount,
      feeAmount:                         d.feeAmount,
      currency:                          d.currency,
      paymentExecutionRail:              d.paymentExecutionRail ?? null,
      routingNote:                       d.routingNote ?? null,
      paymentExecutionStatus:            d.paymentExecutionStatus,
      direction:                         d.initiatorPartyReference === partyRef ? 'sent' : 'received',
      initiatedAt:                       d.initiatedAt?.toISOString() ?? null,
      completedAt:                       d.completedAt?.toISOString() ?? null,
    }));

    return reply.send({ results, total, page, limit });
  });

  // GET /api/v1/accounts/transfer/:transferRef
  // Single P2P transfer lookup by paymentExecutionInstanceReference.
  // Customer scope: must be initiator or recipient (PCI DSS).
  fastify.get('/transfer/:transferRef', {
    preHandler: requirePermission('accounts', 'view'),
    schema: {
      tags: ['accounts'],
      summary: 'Get a single P2P transfer by reference (BIAN SD-65)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['transferRef'],
        properties: { transferRef: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentExecutionInstanceReference:  { type: 'string' },
            initiatorPartyReference:            { type: 'string', nullable: true },
            initiatorName:                      { type: 'string', nullable: true },
            beneficiaryPartyReference:          { type: 'string', nullable: true },
            sourcePayoutAccountReference:       { type: 'string', nullable: true },
            sourceAccountMasked:                { type: 'string', nullable: true },
            resolvedPayoutAccountReference:     { type: 'string', nullable: true },
            beneficiaryArrangementReference:    { type: 'string', nullable: true },
            beneficiaryAlias:                   { type: 'string', nullable: true },
            beneficiaryName:                    { type: 'string', nullable: true },
            destinationIban:                    { type: 'string', nullable: true },
            destinationAccountMasked:           { type: 'string', nullable: true },
            destinationCountry:                 { type: 'string', nullable: true },
            grossAmount:                        { type: 'number' },
            netAmount:                          { type: 'number' },
            feeAmount:                          { type: 'number' },
            currency:                           { type: 'string' },
            recipientCurrency:                  { type: 'string', nullable: true },
            recipientAmount:                    { type: 'number', nullable: true },
            fxRate:                             { type: 'number', nullable: true },
            paymentExecutionRail:               { type: 'string', nullable: true },
            routingNote:                        { type: 'string', nullable: true },
            paymentExecutionRemittanceInformation: { type: 'string', nullable: true },
            paymentExecutionStatus:             { type: 'string' },
            fraudCaseCreated:                   { type: 'boolean', nullable: true },
            fraudDiagnosisInstanceReference:    { type: 'string', nullable: true },
            initiatedAt:                        { type: 'string', nullable: true },
            completedAt:                        { type: 'string', nullable: true },
            fraudCase: {
              type: 'object',
              nullable: true,
              properties: {
                fraudDiagnosisInstanceReference: { type: 'string' },
                fraudDiagnosisCaseReference:     { type: 'string' },
                fraudDiagnosisCaseStatus:        { type: 'string' },
                fraudDiagnosisCaseSeverity:      { type: 'string' },
                fraudDiagnosisScore:             { type: 'number', nullable: true },
                riskIndicators:                  { type: 'array', items: { type: 'string' } },
                subsystemSignals:                { type: 'object', nullable: true, additionalProperties: true },
              },
            },
          },
        },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { transferRef } = request.params as { transferRef: string };
    const user = getUser(request);
    const db = fastify.db;

    const exec = await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
      .findOne({ paymentExecutionInstanceReference: transferRef, beneficiaryType: 'user' });
    if (!exec) return reply.status(404).send({ error: 'P2P transfer not found' });

    if (user?.role === 'customer') {
      const isInvolved = exec.initiatorPartyReference === user.partyRef || exec.beneficiaryPartyReference === user.partyRef;
      if (!isInvolved) return reply.status(403).send({ error: 'Access denied.' });
    }

    const fraudCaseDoc = await db.collection<{
      fraudDiagnosisInstanceReference: string;
      fraudDiagnosisCaseReference: string;
      fraudDiagnosisCaseStatus: string;
      fraudDiagnosisCaseSeverity: string;
      fraudDiagnosisAssessment?: { fraudDiagnosisScore?: number; riskIndicators?: string[] };
      subsystemSignals?: Record<string, unknown>;
    }>(FRAUD_DIAGNOSIS_COLLECTION).findOne(
      { cardTransactionInstanceReference: transferRef },
      { projection: { fraudDiagnosisInstanceReference: 1, fraudDiagnosisCaseReference: 1, fraudDiagnosisCaseStatus: 1, fraudDiagnosisCaseSeverity: 1, fraudDiagnosisAssessment: 1, subsystemSignals: 1 } }
    );

    // Fallback: if the execution predates the sourcePayoutAccountReference field, look up
    // the initiator's primary active account (PCI DSS: source must always be traceable).
    let sourceAccountRef = exec.sourcePayoutAccountReference ?? null;
    if (!sourceAccountRef && exec.initiatorPartyReference) {
      const fallback = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
        .findOne(
          { partyInstanceReference: exec.initiatorPartyReference, payoutAccountStatus: 'active' },
          { sort: { isDefault: -1, recordCreatedDateTime: 1 }, projection: { payoutAccountInstanceReference: 1 } }
        );
      sourceAccountRef = fallback?.payoutAccountInstanceReference ?? null;
    }

    // FX: use stored fields when present (new records); for older records that predate the FX
    // fields, derive the rate on-the-fly from the recipient account's currency.
    let recipientCurrency = exec.recipientCurrency ?? null;
    let recipientAmount   = exec.recipientAmount   ?? null;
    let fxRate            = exec.fxRate            ?? null;
    if (fxRate === null && exec.resolvedPayoutAccountReference) {
      const recipientAcct = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
        .findOne({ payoutAccountInstanceReference: exec.resolvedPayoutAccountReference }, { projection: { payoutAccountCurrency: 1 } });
      const destCcy = recipientAcct?.payoutAccountCurrency;
      if (destCcy && destCcy !== exec.currency) {
        try {
          const { resolveAndConvert } = await import('../../../providers/currency-exchange/services/currencyExchange.service');
          const fx = await resolveAndConvert(db, exec.grossAmount, exec.currency, destCcy);
          recipientCurrency = destCcy;
          recipientAmount   = fx.amount;
          fxRate            = fx.rate;
        } catch { /* no FX config: leave null */ }
      }
    }

    // Sender display fields (PSD2/SEPA: the payee legitimately sees the debtor name + a source account
    // identifier). initiatorName from party; sourceAccountMasked is the origin IBAN masked to
    // last-4 (GDPR minimisation: the recipient never gets the full IBAN or an openable account link).
    let initiatorName: string | null = null;
    if (exec.initiatorPartyReference) {
      const p = await db.collection<{ partyName?: string }>(PARTY_COLLECTION)
        .findOne({ partyInstanceReference: exec.initiatorPartyReference }, { projection: { partyName: 1 } });
      initiatorName = p?.partyName ?? null;
    }
    let sourceAccountMasked: string | null = null;
    if (sourceAccountRef) {
      const srcAcct = await getPayoutAccount(db, sourceAccountRef);
      if (srcAcct?.payoutAccountIban) sourceAccountMasked = maskAccountIdentifier(srcAcct.payoutAccountIban);
    }
    // Beneficiary alias: the owner-defined label (counterpartyLabel) of the saved payee, so the
    // sender's Recipient block can show a friendly "To: <alias>" instead of only the opaque reference.
    let beneficiaryAlias: string | null = null;
    if (exec.beneficiaryArrangementReference) {
      const arr = await db.collection<{ counterpartyLabel?: string }>(COUNTERPARTY_COLLECTION)
        .findOne({ counterpartyArrangementReference: exec.beneficiaryArrangementReference }, { projection: { counterpartyLabel: 1 } });
      beneficiaryAlias = arr?.counterpartyLabel ?? null;
    }

    const execRecord = exec as Record<string, unknown>;
    return reply.send({
      paymentExecutionInstanceReference:  exec.paymentExecutionInstanceReference,
      initiatorPartyReference:            exec.initiatorPartyReference ?? null,
      initiatorName,
      beneficiaryPartyReference:          exec.beneficiaryPartyReference ?? null,
      sourcePayoutAccountReference:       sourceAccountRef,
      sourceAccountMasked,
      resolvedPayoutAccountReference:     exec.resolvedPayoutAccountReference ?? null,
      beneficiaryArrangementReference:    exec.beneficiaryArrangementReference ?? null,
      beneficiaryAlias,
      beneficiaryName:                    exec.beneficiaryName ?? null,
      destinationIban:                    exec.destinationIban ?? null,
      destinationAccountMasked:           exec.destinationAccountMasked ?? null,
      destinationCountry:                 exec.destinationCountry ?? null,
      grossAmount:                        exec.grossAmount,
      netAmount:                          exec.netAmount,
      feeAmount:                          exec.feeAmount,
      currency:                           exec.currency,
      recipientCurrency,
      recipientAmount,
      fxRate,
      paymentExecutionRail:               exec.paymentExecutionRail ?? null,
      routingNote:                        exec.routingNote ?? null,
      paymentExecutionRemittanceInformation: exec.paymentExecutionRemittanceInformation ?? null,
      paymentExecutionStatus:             exec.paymentExecutionStatus,
      fraudCaseCreated:                   execRecord.fraudCaseCreated as boolean ?? false,
      fraudDiagnosisInstanceReference:    execRecord.fraudDiagnosisInstanceReference as string ?? null,
      initiatedAt:                        exec.initiatedAt?.toISOString() ?? null,
      completedAt:                        exec.completedAt?.toISOString() ?? null,
      fraudCase: fraudCaseDoc ? {
        fraudDiagnosisInstanceReference: fraudCaseDoc.fraudDiagnosisInstanceReference,
        fraudDiagnosisCaseReference:     fraudCaseDoc.fraudDiagnosisCaseReference,
        fraudDiagnosisCaseStatus:        fraudCaseDoc.fraudDiagnosisCaseStatus,
        fraudDiagnosisCaseSeverity:      fraudCaseDoc.fraudDiagnosisCaseSeverity,
        fraudDiagnosisScore:             fraudCaseDoc.fraudDiagnosisAssessment?.fraudDiagnosisScore ?? null,
        riskIndicators:                  fraudCaseDoc.fraudDiagnosisAssessment?.riskIndicators ?? [],
        subsystemSignals:                fraudCaseDoc.subsystemSignals ?? null,
      } : null,
    });
  });

  // POST /api/v1/accounts/:accountRef/credit
  // Deposit funds into a payout account (bank-in, admin credit, initial deposit).
  // Restricted to manage permission (system_admin, level2_investigator, bank_ops roles).
  // Creates an immutable balanceCreditLog entry for full audit trail (PCI DSS).
  fastify.post('/:accountRef/credit', {
    preHandler: requirePermission('accounts', 'manage'),
    schema: {
      tags: ['accounts'],
      summary: 'Credit a payout account balance (BIAN SD-66, bank deposit / admin)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['accountRef'], properties: { accountRef: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['amount', 'currency', 'creditType'],
        properties: {
          amount:      { type: 'number', minimum: 0.01 },
          currency:    { type: 'string', minLength: 3, maxLength: 3 },
          creditType:  { type: 'string', enum: ['initial_deposit', 'bank_deposit', 'admin_credit', 'return', 'interest'] },
          description: { type: 'string', maxLength: 255 },
          referenceId: { type: 'string', maxLength: 128 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            creditId: { type: 'string' },
            payoutAccountInstanceReference: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            creditType: { type: 'string' },
            creditedAt: { type: 'string' },
          },
        },
        404: { $ref: 'Error#' },
        // v37: the bank refusing or being unreachable is not the PSP's fault, and it must not read as one.
        502: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { accountRef } = request.params as { accountRef: string };
    const user = getUser(request);
    const body = request.body as { amount: number; currency: string; creditType: CreditType; description?: string; referenceId?: string };
    const db = fastify.db;

    const account = await db.collection<{ payoutAccountInstanceReference: string; partyInstanceReference?: string; payoutAccountStatus?: string }>(
      'payoutAccountArrangement'
    ).findOne({ payoutAccountInstanceReference: accountRef }, { projection: { payoutAccountInstanceReference: 1, partyInstanceReference: 1, payoutAccountStatus: 1 } });
    if (!account) return reply.status(404).send({ error: 'Account not found.' });

    const creditId = uuidv4();
    // The description the bank will record against the credit. The PSP keeps no row of its own: the bank
    // owns the balance, so it owns the audit trail of a credit to it.
    const creditDescription = body.description ?? `${body.creditType.replace(/_/g, ' ')} credit`;
    // v37 P2.5: the PSP no longer mints money. With the bank enabled it ASKS the institution that holds
    // the account to credit it, and the bank writes its own audit entry; with the flag off the local
    // ledger path is unchanged. The endpoint stays, because the frontend and the invariants depend on
    // it: what moved is the effect, not the route.
    const linked = await db.collection<{ payoutAccountBankAccountReference?: string }>('payoutAccountArrangement')
      .findOne({ payoutAccountInstanceReference: accountRef }, { projection: { payoutAccountBankAccountReference: 1 } });

    if (linked?.payoutAccountBankAccountReference) {
      const credited = await requestDemoCredit({
        bankAccountReference: linked.payoutAccountBankAccountReference,
        amount: body.amount,
        currency: body.currency,
        reason: creditDescription,
        requestedBy: user?.role ?? 'admin',
        // The PSP's own id for this operation, so the bank's movement is queryable from here.
        endToEndIdentification: creditId,
      });
      if (!credited.applied) {
        // No local fallback: crediting locally would be exactly the money minting this removes.
        return reply.status(502).send({ error: `The bank refused the credit: ${credited.error}` });
      }
      // v37: no local row. The bank logs the credit it made, which is the audit trail of a balance it owns.
      // A second copy here would be the duplicate this separation removes, and it would drift the moment
      // the bank's own record changed.
    } else {
      // The bank is off, so the PSP is running its own legacy ledger: the credit is recorded by the
      // movement it makes, and there is no separate log to keep.
      await creditDirect(db, accountRef, body.amount);
    }

    emitProcessEvent(db, {
      entityType: 'account', entityId: accountRef,
      processType: 'payment_processing', processAction: 'account.balance.credited',
      processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { creditId, amount: body.amount, currency: body.currency, creditType: body.creditType },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountBalance',
    });

    return reply.status(201).send({
      creditId,
      payoutAccountInstanceReference: accountRef,
      amount: body.amount,
      currency: body.currency,
      creditType: body.creditType,
      creditedAt: new Date().toISOString(),
    });
  });
}
