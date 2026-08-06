// Counterparty Administration + P2P Payment Execution, dual-auth REST controller.
// Routes mounted at /beneficiaries → /api/v1/beneficiaries
//
// Two authentication channels on ONE capability surface (v23, no separate /merchant/* tree):
//   · first-party (PSP session JWT + RBAC beneficiaries:view/manage). Customer scope: own partyRef.
//   · third-party merchant (OAuth on-behalf-of: read:beneficiaries / write:beneficiaries / write:transfers).
//     Owner is derived from token.sub (subject binding); responses are display-safe (masked hint,
//     opaque arrangement reference, NEVER counterpartyPartyReference or the raw lookup value).
// PCI DSS (least privilege) (P2P transfer audit trail) · GDPR minimisation.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { requirePermission, can } from '../../../vendors/middleware/acl';
import { dualPermission, resolveOwner } from '../../../vendors/middleware/dualAuth';
import {
  PredicateRequiredError,
  getBeneficiaryAggregates,
  listAllBeneficiaries,
  listBeneficiaries,
  getOneBeneficiary,
  updateBeneficiaryLabel,
  removeBeneficiary,
  registerBeneficiary,
} from '../../identity/services/counterpartyArrangement.service';
import { executeP2PTransfer } from '../services/p2pTransfer.service';
import { getDefaultPayoutAccount, listPayoutAccounts } from '../services/payoutAccount.service';
import { emitProcessEvent, emitComplianceEvent, attributionFromMerchantContext } from '../../provider/services/businessProcessEvent.service';
import type { CounterpartyArrangement } from '../../identity/models/counterpartyArrangement.model';
import type { Db } from 'mongodb';

function getUser(request: unknown): JwtUserPayload | undefined {
  return (request as { user?: JwtUserPayload }).user;
}

// Display-safe projection for the OAuth (merchant) channel: only the opaque arrangement reference,
// owner label, lookup type, masked hint and status. NEVER leak counterpartyPartyReference (PSP-internal
// identity) or the raw lookup value (GDPR minimisation, design).
function safeBeneficiary(b: CounterpartyArrangement) {
  return {
    counterpartyArrangementReference: b.counterpartyArrangementReference,
    counterpartyLabel: b.counterpartyLabel,
    counterpartyLookupType: b.counterpartyLookupType,
    counterpartyLookupHint: b.counterpartyLookupHint,
    counterpartyArrangementStatus: b.counterpartyArrangementStatus,
    recordCreatedDateTime: b.recordCreatedDateTime,
  };
}

// Resolve the party's source payout account for an outbound send: the active default account if present,
// otherwise the first active account. Returns null when the user has no usable payout account.
async function resolveSourcePayoutAccountRef(db: Db, partyRef: string): Promise<string | null> {
  const def = await getDefaultPayoutAccount(db, partyRef);
  if (def) return def.payoutAccountInstanceReference;
  const { results } = await listPayoutAccounts(db, partyRef, { status: 'active', limit: 1 });
  return results[0]?.payoutAccountInstanceReference ?? null;
}

export async function beneficiaryController(fastify: FastifyInstance) {

  // Payee standing data is a payment-diversion fraud vector, so every change to it is auditable:
  // who, when, through which channel, on whose list (PSD2 Art. 13 RTS trusted beneficiaries,
  // AMLD Art. 40 record keeping, PCI DSS). Values stay masked.
  const emitLifecycle = (
    action: 'beneficiary.registered' | 'beneficiary.relabelled' | 'beneficiary.removed',
    args: {
      request: FastifyRequest;
      beneficiaryRef: string;
      ownerPartyReference: string;
      channel: string;
      summary?: Record<string, unknown>;
    },
  ) => {
    const user = getUser(args.request);
    emitComplianceEvent(fastify.db, {
      entityType: 'beneficiary', entityId: args.beneficiaryRef,
      processType: 'payment_processing', processAction: action,
      processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: {
        channel: args.channel,
        ownerPartyReference: args.ownerPartyReference,
        ...(args.summary ?? {}),
      },
      bianServiceDomain: 'SD-54 Counterparty Administration',
      bianControlRecordType: 'CounterpartyArrangement',
    });
  };

  // ── GET /beneficiaries (+ /:ownerRef), list a party's beneficiaries ──────────────────────────
  // Session: staff list all (optional filters), customer auto-scoped to own; full records.
  // OAuth: owner from token.sub, display-safe projection. Scope read:beneficiaries.
  const listHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { ownerRef } = request.params as { ownerRef?: string };
    const q = request.query as { ownerRef?: string; q?: string; caseRef?: string; status?: 'active' | 'removed'; page?: number; limit?: number };

    if (request.merchantContext) {
      const owner = await resolveOwner(request, reply, ownerRef);
      if (!owner) return;
      if (!owner.ownerPartyRef) return reply.send({ results: [], total: 0, page: q.page ?? 1, limit: q.limit ?? 20 });
      const { results, total } = await listBeneficiaries(fastify.db, owner.ownerPartyRef, { page: q.page, limit: q.limit });
      return reply.send({ results: results.map(safeBeneficiary), total, page: q.page ?? 1, limit: q.limit ?? 20 });
    }

    // Session channel.
    const user = getUser(request);
    const isCustomer = user?.role === 'customer';

    // Own scope: forced to the caller's own party reference, whatever the request asked for.
    if (isCustomer) {
      if (ownerRef !== undefined && user?.partyRef !== ownerRef) {
        return reply.status(403).send({ error: 'Access denied.' });
      }
      const { results, total } = await listAllBeneficiaries(fastify.db, {
        ownerRef: user?.partyRef, status: q.status, page: q.page, limit: q.limit, skipPredicateCheck: true,
      });
      // The display-safe projection applies to every channel.
      return reply.send({ results: results.map(safeBeneficiary), total, page: q.page ?? 1, limit: q.limit ?? 20 });
    }

    // beneficiaries:view is drill-down for a known owner; a cross-party read needs
    // beneficiaries:investigate. ADR-048.
    const effectiveOwner = ownerRef ?? q.ownerRef;
    if (!effectiveOwner) {
      const maySearch = await can(fastify.db, user?.role, 'beneficiaries', 'investigate');
      if (!maySearch) {
        return reply.status(403).send({
          error: 'Cross-party beneficiary search requires the investigate capability; provide an owner party reference instead.',
          code: 'ACL_DENIED', resource: 'beneficiaries', action: 'investigate', role: user?.role ?? null,
        });
      }
    }

    try {
      const { results, total } = await listAllBeneficiaries(fastify.db, {
        ...(effectiveOwner ? { ownerRef: effectiveOwner } : {}),
        ...(q.q ? { q: q.q } : {}),
        ...(q.caseRef ? { caseRef: q.caseRef } : {}),
        status: q.status, page: q.page, limit: q.limit,
      });
      // One compliance event per record surfaced (PCI DSS).
      for (const b of results) {
        emitComplianceEvent(fastify.db, {
          entityType: 'beneficiary', entityId: b.counterpartyArrangementReference,
          processType: 'payment_processing', processAction: 'beneficiary.record.disclosed',
          processOutcome: 'approved',
          performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
          eventSummary: {
            channel: 'staff_search',
            ownerPartyReference: b.ownerPartyReference,
            predicate: effectiveOwner ? 'ownerRef' : q.caseRef ? 'caseRef' : 'q',
          },
          bianServiceDomain: 'SD-54 Counterparty Administration',
          bianControlRecordType: 'CounterpartyArrangement',
        });
      }
      return reply.send({ results: results.map(safeBeneficiary), total, page: q.page ?? 1, limit: q.limit ?? 20 });
    } catch (err) {
      if (err instanceof PredicateRequiredError) {
        return reply.status(400).send({ error: err.message, code: 'PREDICATE_REQUIRED' });
      }
      throw err;
    }
  };

  const listSchema = (withOwner: boolean) => ({
    tags: ['beneficiaries'],
    summary: 'Search beneficiary arrangements (SD-54, session RBAC or OAuth read:beneficiaries)',
    description: 'v32 (ADR-048): a search surface, not an enumeration surface. A discriminating predicate is '
      + 'required (`ownerRef`, `caseRef`, or `q` of at least 3 characters) and a cross-party read additionally '
      + 'requires `beneficiaries:investigate`. Responses use the display-safe projection on every channel: the '
      + 'counterparty party reference and the raw lookup value are never returned. One compliance event is '
      + 'emitted per record disclosed (PCI DSS Req 10.2.2).',
    security: [{ bearerAuth: [] }],
    ...(withOwner ? { params: { type: 'object', required: ['ownerRef'], properties: { ownerRef: { type: 'string' } } } } : {}),
    querystring: {
      type: 'object',
      properties: {
        ownerRef: { type: 'string', description: 'Owner party reference. Required for a drill-down read (beneficiaries:view).' },
        q: { type: 'string', description: 'Search term, minimum 3 characters. Cross-party search requires beneficiaries:investigate.' },
        caseRef: { type: 'string', description: 'Investigation case reference, an alternative discriminating predicate.' },
        status: { type: 'string', enum: ['active', 'removed'] },
        page: { type: 'number', default: 1 },
        limit: { type: 'number', default: 20, maximum: 100 },
      },
    },
  });

  fastify.get('/', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'view', scope: 'read:beneficiaries' }),
    schema: listSchema(false),
  }, listHandler);

  // GET /api/v1/beneficiaries/aggregates: counts and distributions, no identifiers. ADR-048.
  fastify.get('/aggregates', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Beneficiary aggregate metrics, no identifiers (SD-54, v32)',
      description: 'Totals and distributions only. Emits no disclosure event because no record is disclosed.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            byStatus: { type: 'object', additionalProperties: true },
            byLookupType: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  }, async (_request, reply) => reply.send(await getBeneficiaryAggregates(fastify.db)));

  // GET /api/v1/beneficiaries/by-ref/:beneficiaryRef, staff single-record lookup (must precede /:ownerRef).
  fastify.get('/by-ref/:beneficiaryRef', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Get a beneficiary arrangement by reference (SD-54)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['beneficiaryRef'], properties: { beneficiaryRef: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { beneficiaryRef } = request.params as { beneficiaryRef: string };
    const record = await getOneBeneficiary(fastify.db, beneficiaryRef);
    if (!record) return reply.status(404).send({ error: 'Beneficiary not found' });
    if (user?.role === 'customer' && record.ownerPartyReference !== user.partyRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    return reply.send(record);
  });

  fastify.get('/:ownerRef', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'view', scope: 'read:beneficiaries' }),
    schema: listSchema(true),
  }, listHandler);

  // GET /api/v1/beneficiaries/:ownerRef/:beneficiaryRef, staff single-arrangement view.
  fastify.get('/:ownerRef/:beneficiaryRef', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Get a single beneficiary arrangement (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef', 'beneficiaryRef'],
        properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };
    if (user?.role === 'customer' && user.partyRef !== ownerRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    const record = await getOneBeneficiary(fastify.db, beneficiaryRef);
    if (!record) return reply.status(404).send({ error: 'Beneficiary not found' });
    return reply.send(record);
  });

  // PATCH /api/v1/beneficiaries/:ownerRef/:beneficiaryRef, update label/alias (staff/customer).
  fastify.patch('/:ownerRef/:beneficiaryRef', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: {
      tags: ['beneficiaries'],
      summary: 'Update beneficiary label/alias (SD-54)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['ownerRef', 'beneficiaryRef'],
        properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['counterpartyLabel'],
        properties: { counterpartyLabel: { type: 'string', minLength: 1, maxLength: 80 } },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef: string; beneficiaryRef: string };
    if (user?.role === 'customer' && user.partyRef !== ownerRef) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
    const { counterpartyLabel } = request.body as { counterpartyLabel: string };
    const updated = await updateBeneficiaryLabel(fastify.db, beneficiaryRef, counterpartyLabel);
    if (!updated) return reply.status(404).send({ error: 'Beneficiary not found or already removed' });
    emitLifecycle('beneficiary.relabelled', {
      request, beneficiaryRef, ownerPartyReference: ownerRef, channel: 'session',
      summary: { newLabel: updated.counterpartyLabel },
    });
    return reply.send(updated);
  });

  // ── POST /beneficiaries (+ /:ownerRef), add a beneficiary by phone/email lookup ────────────────
  // Anti-enumeration: registerBeneficiary returns a neutral result for not-found/duplicate.
  // OAuth: owner from token.sub, display-safe result. Scope write:beneficiaries.
  const createHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { ownerRef } = request.params as { ownerRef?: string };
    const owner = await resolveOwner(request, reply, ownerRef);
    if (!owner) return;
    const oauth = owner.channel === 'oauth';
    if (oauth && !owner.ownerPartyRef) return reply.status(404).send({ error: 'party_not_found' });

    const body = request.body as { lookupType: 'phone' | 'email'; lookupValue: string; label?: string };
    try {
      const result = await registerBeneficiary(fastify.db, {
        ownerPartyReference: owner.ownerPartyRef!,
        lookupType: body.lookupType,
        lookupValue: body.lookupValue,
        label: body.label,
      });
      if (result.counterpartyArrangementReference) {
        emitLifecycle('beneficiary.registered', {
          request, beneficiaryRef: result.counterpartyArrangementReference,
          ownerPartyReference: owner.ownerPartyRef!,
          channel: oauth ? 'oauth_merchant' : 'session',
          summary: { lookupType: body.lookupType, lookupHint: result.counterpartyLookupHint ?? null },
        });
      }
      return reply.send(result);
    } catch (err: unknown) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode === 422) return reply.status(422).send({ error: e.message });
      throw err;
    }
  };

  const createSchema = (withOwner: boolean) => ({
    tags: ['beneficiaries'],
    summary: 'Add a beneficiary by phone/email lookup (SD-54, session RBAC or OAuth write:beneficiaries)',
    security: [{ bearerAuth: [] }],
    ...(withOwner ? { params: { type: 'object', required: ['ownerRef'], properties: { ownerRef: { type: 'string' } } } } : {}),
    body: {
      type: 'object',
      required: ['lookupType', 'lookupValue'],
      properties: {
        lookupType: { type: 'string', enum: ['phone', 'email'] },
        lookupValue: { type: 'string' },
        label: { type: 'string', maxLength: 80 },
      },
    },
  });

  fastify.post('/', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'manage', scope: 'write:beneficiaries' }),
    schema: createSchema(false),
  }, createHandler);

  fastify.post('/:ownerRef', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'manage', scope: 'write:beneficiaries' }),
    schema: createSchema(true),
  }, createHandler);

  // ── DELETE /beneficiaries/:beneficiaryRef (+ /:ownerRef/:beneficiaryRef), soft-delete ──────────
  const removeHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef?: string; beneficiaryRef: string };
    const owner = await resolveOwner(request, reply, ownerRef);
    if (!owner) return;
    if (!owner.ownerPartyRef) return reply.status(404).send({ error: 'Beneficiary not found' });
    const ok = await removeBeneficiary(fastify.db, owner.ownerPartyRef, beneficiaryRef);
    if (!ok) return reply.status(404).send({ error: 'Beneficiary not found' });
    emitLifecycle('beneficiary.removed', {
      request, beneficiaryRef, ownerPartyReference: owner.ownerPartyRef,
      channel: owner.channel === 'oauth' ? 'oauth_merchant' : 'session',
    });
    return reply.send({ counterpartyArrangementReference: beneficiaryRef, counterpartyArrangementStatus: 'removed' });
  };

  const removeSchema = (withOwner: boolean) => ({
    tags: ['beneficiaries'],
    summary: 'Remove a beneficiary (SD-54, session RBAC or OAuth write:beneficiaries)',
    security: [{ bearerAuth: [] }],
    params: withOwner
      ? { type: 'object', required: ['ownerRef', 'beneficiaryRef'], properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } } }
      : { type: 'object', required: ['beneficiaryRef'], properties: { beneficiaryRef: { type: 'string' } } },
  });

  fastify.delete('/:beneficiaryRef', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'manage', scope: 'write:beneficiaries' }),
    schema: removeSchema(false),
  }, removeHandler);

  fastify.delete('/:ownerRef/:beneficiaryRef', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'manage', scope: 'write:beneficiaries' }),
    schema: removeSchema(true),
  }, removeHandler);

  // ── POST /beneficiaries/:beneficiaryRef/transfer (+ /:ownerRef/:beneficiaryRef/transfer) ─────────
  // Send money to a saved beneficiary: P2P transfer . The merchant supplies only an amount,
  // the opaque arrangement reference, an optional source account and note (no CHD, no IBAN); the PSP
  // resolves the recipient and (when omitted) the default source account server-side.
  const transferHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { ownerRef, beneficiaryRef } = request.params as { ownerRef?: string; beneficiaryRef: string };
    const owner = await resolveOwner(request, reply, ownerRef);
    if (!owner) return;

    // Validate the amount before resolving the party so a bad amount is a clear 422 (not a 404).
    const body = request.body as { fromAccountRef?: string; amount: number; note?: string };
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
      return reply.status(422).send({ error: 'invalid_amount', error_description: 'Amount must be greater than zero.' });
    }
    if (!owner.ownerPartyRef) return reply.status(404).send({ error: 'party_not_found' });

    const oauth = owner.channel === 'oauth';
    // Session requires an explicit source account (existing behavior); OAuth resolves the default
    // server-side when the merchant does not pass one.
    let fromAccountRef = body.fromAccountRef;
    if (!fromAccountRef && oauth) {
      fromAccountRef = (await resolveSourcePayoutAccountRef(fastify.db, owner.ownerPartyRef)) ?? undefined;
      if (!fromAccountRef) {
        return reply.status(422).send({ error: 'no_source_account', error_description: 'You have no active payout account to send from.' });
      }
    }
    if (!fromAccountRef) {
      return reply.status(422).send({ error: 'fromAccountRef is required.' });
    }

    const result = await executeP2PTransfer(fastify.db, {
      initiatorPartyRef: owner.ownerPartyRef,
      counterpartyArrangementRef: beneficiaryRef,
      fromAccountRef,
      amount: body.amount,
      note: body.note,
      // stamp the initiating merchant so a merchant-originated send is visible only in that
      // merchant's history. Absent for first-party sends.
      ...(oauth ? { merchantAgreementReference: request.merchantContext?.merchantId } : {}),
    });

    if (oauth) {
      // Attribute the merchant-originated action (audit, PCI DSS).
      emitProcessEvent(fastify.db, {
        entityType: 'execution', entityId: result.transferReference || beneficiaryRef,
        processType: 'payment_processing', processAction: 'merchant.beneficiary.send',
        processOutcome: result.status === 'failed' ? 'rejected' : 'approved',
        performedByPartyReference: owner.ownerPartyRef, performedByRole: 'customer',
        eventSummary: { amount: result.amount, currency: result.currency, status: result.status, beneficiaryArrangement: beneficiaryRef },
        bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
        attribution: attributionFromMerchantContext(request.merchantContext),
      });
      // Display-safe result, no recipient account/party identity leaked to the merchant.
      const safe = {
        transferReference: result.transferReference,
        amount: result.amount,
        currency: result.currency,
        status: result.status,
        ...(result.failureReason ? { failureReason: result.failureReason } : {}),
      };
      return reply.code(result.status === 'failed' ? 422 : 202).send(safe);
    }

    // Session channel: preserve existing full-result behavior.
    if (!result.transferReference) {
      return reply.status(422).send({ error: result.failureReason ?? 'Transfer failed.' });
    }
    return reply.send(result);
  };

  const transferSchema = (withOwner: boolean) => ({
    tags: ['beneficiaries'],
    summary: 'Send money to a beneficiary, P2P transfer (SD-65, session RBAC or OAuth write:transfers)',
    security: [{ bearerAuth: [] }],
    params: withOwner
      ? { type: 'object', required: ['ownerRef', 'beneficiaryRef'], properties: { ownerRef: { type: 'string' }, beneficiaryRef: { type: 'string' } } }
      : { type: 'object', required: ['beneficiaryRef'], properties: { beneficiaryRef: { type: 'string' } } },
    body: {
      type: 'object',
      required: ['amount'],
      properties: {
        fromAccountRef: { type: 'string' },
        amount: { type: 'number', exclusiveMinimum: 0 },
        currency: { type: 'string' },
        note: { type: 'string', maxLength: 140 },
      },
    },
  });

  fastify.post('/:beneficiaryRef/transfer', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'manage', scope: 'write:transfers' }),
    schema: transferSchema(false),
  }, transferHandler);

  fastify.post('/:ownerRef/:beneficiaryRef/transfer', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'manage', scope: 'write:transfers' }),
    schema: transferSchema(true),
  }, transferHandler);
}
