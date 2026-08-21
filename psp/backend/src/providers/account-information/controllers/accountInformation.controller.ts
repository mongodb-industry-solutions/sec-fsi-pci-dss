// Account Information (AIS) builtin module controller (Open Banking, ADR-029).
// POST /score: validates a payout account; called by integration router.
// GET/PUT /config: admin configuration.

import { FastifyInstance } from 'fastify';
import {
  resolveAccountInformationConfig,
  validateAccount,
} from '../services/accountInformation.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';
import { emitComplianceEvent } from '../../../modules/provider/services/businessProcessEvent.service';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../../modules/gateway/models/payoutAccount.model';
import type { PayoutAccountArrangement, PayoutAccountStatus, PayoutAccountType, PayoutRail } from '../../../modules/gateway/models/payoutAccount.model';
import { requirePermission } from '../../../vendors/middleware/acl';
import { requireInternalProvider } from '../../../modules/provider/services/capabilityGate.service';
import {
  listAllPayoutAccounts,
  getPayoutAccount,
  createPayoutAccount,
  updatePayoutAccount,
  closePayoutAccount,
  reassignPayoutAccountOwner,
  type UpdatePayoutAccountInput,
} from '../../../modules/gateway/services/payoutAccount.service';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { listAllCards } from '../../../modules/customer/services/paymentCard.service';
import { deriveMaskedPan } from '../../../modules/customer/models/paymentCard.model';
import { resolveOwnerNameByParty, searchPartiesByOwner } from '../../card-issuer/ports/owner.port';

// v29 §8: aggregated list-access audit is opt-in (default off).
const AUDIT_LIST_ACCESS = process.env.PSP_AUDIT_LIST_ACCESS === 'true';

// QE/GDPR minimization: strip encrypted identifiers, expose only boolean presence hints.
// Same contract as gateway/payoutAccount.controller safeAccount.
function safeAccount(doc: unknown) {
  const { payoutAccountIban, payoutAccountRoutingNumber, _id, ...rest } = doc as Record<string, unknown>;
  return {
    ...rest,
    payoutAccountHasIban: typeof payoutAccountIban === 'string' && payoutAccountIban.length > 0,
    payoutAccountHasRoutingNumber: typeof payoutAccountRoutingNumber === 'string' && payoutAccountRoutingNumber.length > 0,
  };
}

export async function accountInformationController(fastify: FastifyInstance) {
  const CAP = 'account-information';
  // v29 admin gate: accounts* routes require operations_officer permission AND the account-information
  // capability resolving to its internal built-in provider (else 409 managed_externally).
  const gate = requireInternalProvider('account_information');

  fastify.post('/validate', {
    schema: {
      tags: ['modules:account-information'],
      summary: 'AIS account validation (internal builtin)',
      description: 'Validates a payout account status and returns PSP internal ledger balance. '
        + 'Called by the integration router. Not JWT-authenticated; requires X-Integration-Source header. '
        + 'IBAN is never present in the request: uses payoutAccountInstanceReference only.',
      headers: {
        type: 'object',
        required: ['x-integration-source'],
        properties: { 'x-integration-source': { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['payoutAccountInstanceReference', 'clientReference'],
        additionalProperties: true,
        properties: {
          payoutAccountInstanceReference: { type: 'string' },
          clientReference: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accountVerified:  { type: 'boolean' },
            accountStatus:    { type: 'string' },
            identityMatch:    { type: 'string' },
            balancePending:   { type: 'number' },
            balanceAvailable: { type: 'number' },
            currency:         { type: 'string' },
            providerReference:{ type: 'string' },
            clientReference:  { type: 'string' },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const payoutAccountRef = body.payoutAccountInstanceReference as string;
    const clientReference = body.clientReference as string;

    const stored = await getCapabilityModuleConfig(fastify.db, CAP);
    const config = resolveAccountInformationConfig(stored?.moduleConfig as Record<string, unknown> | undefined);

    const account = await fastify.db
      .collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ payoutAccountInstanceReference: payoutAccountRef });

    const result = validateAccount({ payoutAccountInstanceReference: payoutAccountRef, clientReference }, account, config);

    emitComplianceEvent(fastify.db, {
      entityType: 'account',
      entityId: payoutAccountRef,
      processType: 'payment_processing',
      processAction: 'ais.account.validation.completed',
      processOutcome: result.accountVerified ? 'verified' : 'rejected',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: {
        module: CAP,
        payoutAccountRef,
        accountStatus: result.accountStatus,
        accountVerified: result.accountVerified,
      },
      bianServiceDomain: 'SD-36 Open Banking',
      bianControlRecordType: 'AccountInformationValidation',
    });

    return reply.send({ ...result, clientReference });
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:account-information'],
      summary: 'Get AIS module configuration',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', {
    preHandler: requirePermission('modules', 'manage'),
    schema: {
      tags: ['modules:account-information'],
      summary: 'Update AIS module configuration',
      body: { type: 'object', properties: { moduleConfig: { type: 'object', additionalProperties: true } } },
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });

  // ── v29 GLOBAL PAYOUT-ACCOUNT ADMINISTRATION (built-in module surface) ─────────────────
  // Global cross-party administration of payout accounts, distinct from the party-scoped self-service
  // surface (/api/v1/accounts/:partyRef). Gated to operations_officer (PCI DSS) and to the
  // account-information capability resolving to its internal provider (409 managed_externally).
  // QE/GDPR: IBAN/routing are never returned here (presence hints only); reveal stays on its own route.

  // GET /accounts: global paginated list (QE-stripped + hints).
  fastify.get('/accounts', {
    preHandler: [requirePermission('accounts', 'view'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'List all payout accounts (global administration)',
      description: 'Cross-party global payout-account inventory for the operations officer (SD-66). '
        + 'QE-stripped rows with payoutAccountHasIban / payoutAccountHasRoutingNumber hints. IBAN reveal '
        + 'stays on its dedicated route. Gated: operations_officer + internal account-information provider.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['active', 'pending_validation', 'suspended', 'closed'] },
          party: { type: 'string', description: 'Filter by partyInstanceReference.' },
          currency: { type: 'string', description: 'ISO-4217 currency code.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            results: { type: 'array', items: { type: 'object', additionalProperties: true } },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
        403: { $ref: 'Error#' },
        409: { description: 'Capability managed by an external provider.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const q = (request.query ?? {}) as { page?: number; limit?: number; status?: PayoutAccountStatus; party?: string; currency?: string };
    const { results, total, page, limit } = await listAllPayoutAccounts(fastify.db, q);
    if (AUDIT_LIST_ACCESS) {
      const user = (request as { user?: JwtUserPayload }).user;
      emitComplianceEvent(fastify.db, {
        entityType: 'account', entityId: 'account-information-admin-list',
        processType: 'payment_processing', processAction: 'admin.accounts.listed', processOutcome: 'approved',
        performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
        eventSummary: { module: CAP, count: results.length, filters: q },
        bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
      });
    }
    return reply.send({ results: results.map(safeAccount), total, page, limit });
  });

  // GET /accounts/:accountRef, global account detail (QE-stripped; audited).
  fastify.get('/accounts/:accountRef', {
    preHandler: [requirePermission('accounts', 'view'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'Get one payout account (global administration detail)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['accountRef'], properties: { accountRef: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { accountRef } = request.params as { accountRef: string };
    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account) return reply.status(404).send({ error: 'Account not found' });
    // v30.1: derived owner (party) name, need-to-know via the port (no broad customers access).
    const ownerName = await resolveOwnerNameByParty(fastify.db, account.partyInstanceReference);
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'account', entityId: accountRef,
      processType: 'payment_processing', processAction: 'account.accessed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, partyInstanceReference: account.partyInstanceReference, status: account.payoutAccountStatus },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
    });
    return reply.send({ ...safeAccount(account), ownerName });
  });

  // GET /parties: owner picker for account registration: search parties by owner name.
  // Returns ONLY the party ref + owner name (need-to-know; no other PII). accounts:view + gate.
  fastify.get('/parties', {
    preHandler: [requirePermission('accounts', 'view'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'Search parties by owner name (account owner picker)',
      security: [{ bearerAuth: [] }],
      querystring: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1 } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { query } = (request.query ?? {}) as { query?: string };
    const results = await searchPartiesByOwner(fastify.db, query ?? '');
    return reply.send({ results });
  });

  // GET /accounts/:accountRef/cards (v30 cross-linking): list the payment cards funded by this
  // account (cardAccountReference). Reuses listAllCards (funding filter) via the Card-by-account
  // port. Display-safe (no full PAN, no CVV).
  fastify.get('/accounts/:accountRef/cards', {
    preHandler: [requirePermission('accounts', 'view'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'List cards funded by a payout account (cross-linking, paginated)',
      description: 'Paginated, filterable list of the cards funded by this account (SD-88 '
        + 'cardAccountReference). Standard filters: network, status, last4, BIN. Display-safe (no full PAN/CVV).',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['accountRef'], properties: { accountRef: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          network: { type: 'string', enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] },
          status: { type: 'string', enum: ['issued', 'active', 'pending_activation', 'blocked', 'suspended', 'revoked', 'expired'] },
          last4: { type: 'string' },
          bin: { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { accountRef } = request.params as { accountRef: string };
    const q = (request.query ?? {}) as { page?: number; limit?: number; network?: string; status?: string; last4?: string; bin?: string };
    const result = await listAllCards(fastify.db, { ...q, funding: accountRef });
    result.results = (result.results as Array<Record<string, unknown>>).map((c) => ({ ...c, paymentCardMaskedPanDisplay: deriveMaskedPan(c as Record<string, string | undefined>) }));
    return reply.send(result);
  });

  // GET /accounts/:accountRef/iban (v30 reveal): full IBAN for operations_officer from the admin
  // console (direct, gate internal). Ephemeral, audited (account.iban.revealed). Step-up in prod.
  fastify.get('/accounts/:accountRef/iban', {
    preHandler: [requirePermission('accounts', 'manage'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'Reveal a payout account IBAN (operations officer)',
      description: 'Returns the full IBAN (QE-decrypted server-side), ephemerally. operations_officer only, '
        + 'internal provider only. Audited (PCI/GDPR). Step-up MFA in production.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['accountRef'], properties: { accountRef: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { payoutAccountIban: { type: 'string' } } }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { accountRef } = request.params as { accountRef: string };
    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account || !account.payoutAccountIban) return reply.status(404).send({ error: 'IBAN not found' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'account', entityId: accountRef,
      processType: 'payment_processing', processAction: 'account.iban.revealed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, channel: 'admin_console', partyInstanceReference: account.partyInstanceReference },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
    });
    return reply.send({ payoutAccountIban: account.payoutAccountIban });
  });

  // GET /accounts/:accountRef/routing (v30.1 reveal): full routing / national clearing number for
  // operations_officer. Ephemeral, audited (account.routing.revealed). Step-up in prod.
  fastify.get('/accounts/:accountRef/routing', {
    preHandler: [requirePermission('accounts', 'manage'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'Reveal a payout account routing number (operations officer)',
      description: 'Returns the full routing / clearing number (QE-decrypted server-side), ephemerally. '
        + 'operations_officer only, internal provider only. Audited (PCI/GDPR). Step-up MFA in production.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['accountRef'], properties: { accountRef: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { payoutAccountRoutingNumber: { type: 'string' } } }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { accountRef } = request.params as { accountRef: string };
    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account || !account.payoutAccountRoutingNumber) return reply.status(404).send({ error: 'Routing number not found' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'account', entityId: accountRef,
      processType: 'payment_processing', processAction: 'account.routing.revealed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, channel: 'admin_console', partyInstanceReference: account.partyInstanceReference },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
    });
    return reply.send({ payoutAccountRoutingNumber: account.payoutAccountRoutingNumber });
  });

  // PATCH /accounts/:accountRef/owner, v30.1 administrative ownership reassignment. Moves the account
  // to a different party. Sensitive (PII/fraud); audited (account.owner.reassigned). accounts:manage.
  fastify.patch('/accounts/:accountRef/owner', {
    preHandler: [requirePermission('accounts', 'manage'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'Reassign a payout account to a different owner (party)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['accountRef'], properties: { accountRef: { type: 'string' } } },
      body: { type: 'object', required: ['partyInstanceReference'], additionalProperties: false, properties: { partyInstanceReference: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { accountRef } = request.params as { accountRef: string };
    const { partyInstanceReference } = request.body as { partyInstanceReference: string };
    const updated = await reassignPayoutAccountOwner(fastify.db, accountRef, partyInstanceReference);
    if (!updated) return reply.status(404).send({ error: 'Account not found' });
    const ownerName = await resolveOwnerNameByParty(fastify.db, partyInstanceReference);
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'account', entityId: accountRef,
      processType: 'payment_processing', processAction: 'account.owner.reassigned', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, partyInstanceReference },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
    });
    return reply.send({ ...safeAccount(updated), ownerName });
  });

  // POST /accounts: register a payout account for a party (IBAN/routing QE-encrypted at rest).
  fastify.post('/accounts', {
    preHandler: [requirePermission('accounts', 'manage'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'Register a payout account (global administration)',
      description: 'Creates an SD-66 payout account for a partyInstanceReference. IBAN/routing are '
        + 'QE-encrypted at rest; the response is QE-stripped with presence hints.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['partyInstanceReference', 'payoutAccountType', 'payoutAccountCurrency', 'payoutAccountCountryCode', 'payoutAccountPreferredRail'],
        properties: {
          partyInstanceReference: { type: 'string' },
          payoutAccountType: { type: 'string', enum: ['bank_account', 'wallet', 'internal_ledger'] },
          payoutAccountCurrency: { type: 'string' },
          payoutAccountCountryCode: { type: 'string' },
          payoutAccountPreferredRail: { type: 'string', enum: ['sepa', 'ach', 'swift', 'local_bank', 'internal_wallet', 'internal_ledger'] },
          payoutAccountAlias: { type: 'string' },
          payoutAccountBankName: { type: 'string' },
          payoutAccountHolderName: { type: 'string' },
          payoutAccountBicSwift: { type: 'string' },
          payoutAccountCorrespondentBic: { type: 'string' },
          payoutAccountBankAddress: { type: 'string' },
          payoutAccountIban: { type: 'string', description: 'QE-encrypted at rest; never returned.' },
          payoutAccountRoutingNumber: { type: 'string', description: 'QE-encrypted at rest; never returned.' },
          payoutAccountIsDefault: { type: 'boolean' },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const body = request.body as {
      partyInstanceReference: string;
      payoutAccountType: PayoutAccountType;
      payoutAccountCurrency: string;
      payoutAccountCountryCode: string;
      payoutAccountPreferredRail: PayoutRail;
      [k: string]: unknown;
    };
    const created = await createPayoutAccount(fastify.db, body);
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'account', entityId: created.payoutAccountInstanceReference,
      processType: 'payment_processing', processAction: 'account.created', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, partyInstanceReference: created.partyInstanceReference, type: created.payoutAccountType, currency: created.payoutAccountCurrency, hasIban: !!body.payoutAccountIban },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
    });
    return reply.status(201).send(safeAccount(created));
  });

  // PATCH /accounts/:accountRef, update mutable banking metadata (IBAN/currency/type immutable).
  fastify.patch('/accounts/:accountRef', {
    preHandler: [requirePermission('accounts', 'manage'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'Update a payout account (global administration)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['accountRef'], properties: { accountRef: { type: 'string' } } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          payoutAccountAlias: { type: 'string' },
          payoutAccountIsDefault: { type: 'boolean' },
          payoutAccountBankName: { type: 'string' },
          payoutAccountHolderName: { type: 'string' },
          payoutAccountBicSwift: { type: 'string' },
          payoutAccountCorrespondentBic: { type: 'string' },
          payoutAccountBankAddress: { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { accountRef } = request.params as { accountRef: string };
    const body = (request.body ?? {}) as UpdatePayoutAccountInput;
    const updated = await updatePayoutAccount(fastify.db, accountRef, body);
    if (!updated) return reply.status(404).send({ error: 'Account not found' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'account', entityId: accountRef,
      processType: 'payment_processing', processAction: 'account.updated', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, partyInstanceReference: updated.partyInstanceReference, fields: Object.keys(body) },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
    });
    return reply.send(safeAccount(updated));
  });

  // DELETE /accounts/:accountRef, close the account (soft-close; record retained).
  fastify.delete('/accounts/:accountRef', {
    preHandler: [requirePermission('accounts', 'manage'), gate],
    schema: {
      tags: ['modules:account-information'],
      summary: 'Close a payout account (global administration)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['accountRef'], properties: { accountRef: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { closed: { type: 'boolean' } } }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { accountRef } = request.params as { accountRef: string };
    const account = await getPayoutAccount(fastify.db, accountRef);
    if (!account) return reply.status(404).send({ error: 'Account not found' });
    const closed = await closePayoutAccount(fastify.db, account.partyInstanceReference, accountRef);
    if (!closed) return reply.status(404).send({ error: 'Account not found or already closed' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'account', entityId: accountRef,
      processType: 'payment_processing', processAction: 'account.closed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, partyInstanceReference: account.partyInstanceReference },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountArrangement',
    });
    return reply.send({ closed: true });
  });
}
