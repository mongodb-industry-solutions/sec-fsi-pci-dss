// v17.1/66: Bank transfer REST controller (ACH / SEPA / SWIFT).
// Routes mounted at /gateway/transfers → /api/v1/gateway/transfers
//   POST /preview  → stateless rail derivation + validation + fee quote (no side effects)
//   POST /bank     → execute a transfer to a registered or unregistered external account
// Auth: JWT bearer + RBAC (beneficiaries:view / beneficiaries:manage). Customer scope.

import { FastifyInstance } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { requirePermission } from '../../../vendors/middleware/acl';
import { dualPermission, resolveOwner } from '../../../vendors/middleware/dualAuth';
import { previewBankTransfer, executeBankTransfer, type ExecuteBankTransferResult } from '../services/bankTransfer.service';
import { createMandate, listMandates, cancelMandate, runDueMandates } from '../services/recurringMandate.service';
import { getExecution } from '../services/paymentExecution.service';
import { getIdempotent, saveIdempotent } from '../services/idempotency.service';
import { emitProcessEvent, attributionFromMerchantContext } from '../../provider/services/businessProcessEvent.service';
import type { BankRail, RailDestination, RecurringScheme } from '../../../shared/services/bankTransfer';
import type { MandateFrequency } from '../models/recurringMandate.model';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';

function getUser(request: unknown): JwtUserPayload | undefined {
  return (request as { user?: JwtUserPayload }).user;
}

const destinationSchema = {
  type: 'object',
  required: ['countryCode', 'currency'],
  properties: {
    countryCode: { type: 'string', minLength: 2, maxLength: 2 },
    currency: { type: 'string', minLength: 3, maxLength: 3 },
    iban: { type: 'string' },
    accountNumber: { type: 'string' },
    routingNumber: { type: 'string' },
    bic: { type: 'string' },
    correspondentBic: { type: 'string' },
    beneficiaryName: { type: 'string', maxLength: 140 },
    bankName: { type: 'string', maxLength: 100 },
  },
} as const;

// The merchant client sends amountCurrency as an { amount, currency } object; direct/staff callers
// send a bare currency-code string. Accept both and normalise to the ISO currency code.
type AmountCurrency = string | { amount?: number; currency: string };
interface PreviewBody { destination: RailDestination; amountCurrency?: AmountCurrency; rail?: BankRail }
interface ExecuteBody {
  amount: number; currency: string; destination: RailDestination;
  rail?: BankRail; reference?: string; fromAccountRef?: string; settlementSchedule?: 'T+0' | 'T+1' | 'T+2' | 'T+3';
}
function resolvePreviewCurrency(body: PreviewBody): string {
  const ac = body.amountCurrency;
  if (ac && typeof ac === 'object' && typeof ac.currency === 'string' && ac.currency) return ac.currency;
  if (typeof ac === 'string' && ac) return ac;
  return body.destination.currency;
}

export async function transferController(fastify: FastifyInstance) {

  // POST /api/v1/gateway/transfers/preview: derive rail, validate, quote fee (stateless, no side effects).
  // Session RBAC (beneficiaries:view) OR OAuth write:transfers (merchant on-behalf-of).
  fastify.post('/preview', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'view', scope: 'write:transfers' }),
    schema: {
      tags: ['transfers'],
      summary: 'Preview a bank transfer: derive rail, validate details, quote fee (SD-65/66)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['destination'],
        properties: {
          destination: destinationSchema,
          amountCurrency: {
            oneOf: [
              { type: 'string' },
              { type: 'object', properties: { amount: { type: 'number' }, currency: { type: 'string' } }, required: ['currency'] },
            ],
          },
          rail: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as PreviewBody;
    const result = previewBankTransfer(body.destination, resolvePreviewCurrency(body), body.rail);
    return reply.send(result);
  });

  // POST /api/v1/gateway/transfers/bank: execute the transfer via the payment_initiation provider.
  // Session RBAC (beneficiaries:manage) OR OAuth write:transfers (owner from token.sub).
  fastify.post('/bank', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'beneficiaries', action: 'manage', scope: 'write:transfers' }),
    schema: {
      tags: ['transfers'],
      summary: 'Execute a bank transfer to an external account (ACH/SEPA/SWIFT) (SD-65/66)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['amount', 'currency', 'destination'],
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          destination: destinationSchema,
          rail: { type: 'string' },
          reference: { type: 'string', maxLength: 140 },
          fromAccountRef: { type: 'string' },
          settlementSchedule: { type: 'string', enum: ['T+0', 'T+1', 'T+2', 'T+3'] },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as ExecuteBody;

    if (request.merchantContext) {
      // OAuth on-behalf-of: owner from token.sub (translate to party); attribute the action.
      const owner = await resolveOwner(request, reply);
      if (!owner) return;
      if (!owner.ownerPartyRef) {
        return reply.status(404).send({ error: 'party_not_found', error_description: 'No party is linked to this token subject.' });
      }
      const result = await executeBankTransfer(fastify.db, {
        initiatorPartyRef: owner.ownerPartyRef,
        amount: body.amount,
        currency: body.currency,
        destination: body.destination,
        rail: body.rail,
        reference: body.reference,
        fromAccountRef: body.fromAccountRef,
        settlementSchedule: body.settlementSchedule,
        // stamp the initiating merchant so this execution is visible only in its history.
        merchantAgreementReference: request.merchantContext.merchantId,
      });
      emitProcessEvent(fastify.db, {
        entityType: 'execution', entityId: result.executionReference,
        processType: 'payment_processing', processAction: 'merchant.transfer.bank',
        processOutcome: result.status === 'submitted' ? 'approved' : 'rejected',
        performedByPartyReference: owner.ownerPartyRef, performedByRole: 'customer',
        eventSummary: { amount: body.amount, currency: body.currency, rail: result.rail, status: result.status },
        bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
        attribution: attributionFromMerchantContext(request.merchantContext),
      });
      return reply.code(result.status === 'submitted' ? 202 : 422).send(result);
    }

    // Session channel: initiator from the JWT + idempotency (existing behavior).
    const user = getUser(request);
    if (!user?.partyRef) return reply.code(401).send({ error: 'Unauthenticated' });

    const idemKey = request.headers['idempotency-key'] as string | undefined;
    if (idemKey) {
      const prior = await getIdempotent<ExecuteBankTransferResult>(fastify.db, 'transfer.bank', user.partyRef, idemKey);
      if (prior) return reply.code(prior.status === 'submitted' ? 202 : 422).send(prior);
    }

    const result = await executeBankTransfer(fastify.db, {
      initiatorPartyRef: user.partyRef,
      amount: body.amount,
      currency: body.currency,
      destination: body.destination,
      rail: body.rail,
      reference: body.reference,
      fromAccountRef: body.fromAccountRef,
      settlementSchedule: body.settlementSchedule,
    });
    if (idemKey) await saveIdempotent(fastify.db, 'transfer.bank', user.partyRef, idemKey, result);
    return reply.code(result.status === 'submitted' ? 202 : 422).send(result);
  });

  // POST /api/v1/gateway/transfers/own
  //
  // A transfer between two accounts the SAME person holds. It is a real credit transfer over SEPA, ACH or
  // SWIFT, not a PSP book entry: the accounts are at banks, and the banks move the money.
  //
  // The destination is named by its account REFERENCE rather than by its coordinates, which is the whole
  // point of a separate route. The browser never needs the full IBAN of an account it already owns (data
  // minimisation), and the server is the one that proves both accounts belong to the caller, which a client
  // asserting "this is mine" could not.
  fastify.post('/own', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: {
      tags: ['transfers'],
      summary: 'Transfer between two accounts of the same owner',
      description:
        'A real credit transfer between two accounts the caller holds, executed by the bank that holds the '
        + 'debtor account. Both accounts are verified to belong to the caller server-side.\n\n'
        + 'It has no third party, so counterparty screening and payee verification do not apply; access '
        + 'control and traceability do, and the compliance event records that distinction rather than '
        + 'reusing the peer-to-peer pipeline and fabricating a result about someone who is not involved.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['fromAccountRef', 'toAccountRef', 'amount'],
        properties: {
          fromAccountRef: { type: 'string' },
          toAccountRef: { type: 'string' },
          amount: { type: 'number', exclusiveMinimum: 0 },
          reference: { type: 'string', maxLength: 140 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    if (!user?.partyRef) return reply.code(401).send({ error: 'Unauthenticated' });
    const body = request.body as { fromAccountRef: string; toAccountRef: string; amount: number; reference?: string };

    if (body.fromAccountRef === body.toAccountRef) {
      return reply.code(422).send({ error: 'The source and destination accounts are the same.' });
    }

    // Both sides, scoped to the caller's party in the QUERY: an account that is not theirs is not found
    // rather than refused, so this cannot be used to probe for other people's account references.
    const accounts = await fastify.db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
      .find({
        partyInstanceReference: user.partyRef,
        payoutAccountInstanceReference: { $in: [body.fromAccountRef, body.toAccountRef] },
      })
      .toArray();
    const from = accounts.find((a) => a.payoutAccountInstanceReference === body.fromAccountRef);
    const to = accounts.find((a) => a.payoutAccountInstanceReference === body.toAccountRef);
    if (!from || !to) {
      return reply.code(404).send({ error: 'One of the accounts does not exist or is not yours.' });
    }
    if (from.payoutAccountStatus !== 'active' || to.payoutAccountStatus !== 'active') {
      return reply.code(422).send({ error: 'Both accounts must be active.' });
    }
    if (!to.payoutAccountIban) {
      // Without coordinates there is nothing to instruct the bank with. The PSP revenue ledger and a wallet
      // are the accounts this excludes, and they are not destinations for a customer transfer.
      return reply.code(422).send({ error: 'The destination account has no bank coordinates.' });
    }

    const idemKey = request.headers['idempotency-key'] as string | undefined;
    if (idemKey) {
      const prior = await getIdempotent<ExecuteBankTransferResult>(fastify.db, 'transfer.own', user.partyRef, idemKey);
      if (prior) return reply.code(prior.status === 'submitted' ? 202 : 422).send(prior);
    }

    // The SAME service as any other bank transfer. Same owner and third party differ only in how the
    // destination was resolved, which is the property P5.1 asks for: one path, one set of controls.
    const result = await executeBankTransfer(fastify.db, {
      initiatorPartyRef: user.partyRef,
      amount: body.amount,
      currency: from.payoutAccountCurrency,
      destination: {
        countryCode: to.payoutAccountCountryCode,
        iban: to.payoutAccountIban,
        bic: to.payoutAccountBicSwift,
        beneficiaryName: to.payoutAccountHolderName ?? to.payoutAccountAlias,
      } as RailDestination,
      reference: body.reference ?? `Transfer to ${to.payoutAccountAlias ?? 'my account'}`,
      fromAccountRef: body.fromAccountRef,
      // Proven above by resolving both accounts against the caller's own party, which is why the service
      // takes it as an input rather than re-deriving it.
      sameOwnerDestination: true,
    });
    if (idemKey) await saveIdempotent(fastify.db, 'transfer.own', user.partyRef, idemKey, result);
    return reply.code(result.status === 'submitted' ? 202 : 422).send(result);
  });

  // GET /api/v1/gateway/transfers/:ref/status, real-time execution status (customer-scoped).
  fastify.get('/:ref/status', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: {
      tags: ['transfers'],
      summary: 'Get bank-transfer execution status (SD-65)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    if (!user?.partyRef) return reply.code(401).send({ error: 'Unauthenticated' });
    const { ref } = request.params as { ref: string };
    const exec = await getExecution(fastify.db, ref);
    if (!exec) return reply.code(404).send({ error: 'Execution not found.' });
    // Customer scope: only the initiator may read their own transfer status.
    if (user.role === 'customer' && exec.initiatorPartyReference !== user.partyRef) {
      return reply.code(403).send({ error: 'Access denied.' });
    }
    return reply.send({
      executionReference: exec.paymentExecutionInstanceReference,
      status: exec.paymentExecutionStatus,
      rail: exec.paymentExecutionRail,
      grossAmount: exec.grossAmount,
      feeAmount: exec.feeAmount,
      currency: exec.currency,
      failureReason: exec.failureReason,
      resolutionLog: exec.resolutionLog,
      completedAt: exec.completedAt,
    });
  });

  // ── Recurring mandates (ACH Direct Debit / SEPA SDD) ──────────────────────────

  // POST /api/v1/gateway/transfers/mandates: create a recurring mandate.
  fastify.post('/mandates', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: {
      tags: ['transfers'],
      summary: 'Create a recurring payment mandate (ACH SDD / SEPA SDD) (SD-66)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['scheme', 'amount', 'currency', 'destination', 'frequency'],
        properties: {
          scheme: { type: 'string', enum: ['ach_direct_debit', 'sepa_sdd'] },
          amount: { type: 'number', exclusiveMinimum: 0 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          destination: destinationSchema,
          frequency: { type: 'string', enum: ['weekly', 'monthly', 'quarterly', 'yearly'] },
          reference: { type: 'string', maxLength: 140 },
          maxRuns: { type: 'number', minimum: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    if (!user?.partyRef) return reply.code(401).send({ error: 'Unauthenticated' });
    const b = request.body as { scheme: RecurringScheme; amount: number; currency: string; destination: RailDestination; frequency: MandateFrequency; reference?: string; maxRuns?: number };
    try {
      const mandate = await createMandate(fastify.db, { ownerPartyReference: user.partyRef, ...b });
      return reply.code(201).send(mandate);
    } catch (err) {
      const code = (err as { code?: number }).code === 400 ? 400 : 500;
      return reply.code(code).send({ error: err instanceof Error ? err.message : 'Could not create mandate.' });
    }
  });

  // GET /api/v1/gateway/transfers/mandates: list the caller's mandates.
  fastify.get('/mandates', {
    preHandler: requirePermission('beneficiaries', 'view'),
    schema: { tags: ['transfers'], summary: 'List recurring mandates (SD-66)', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = getUser(request);
    if (!user?.partyRef) return reply.code(401).send({ error: 'Unauthenticated' });
    return reply.send({ results: await listMandates(fastify.db, user.partyRef) });
  });

  // DELETE /api/v1/gateway/transfers/mandates/:ref, cancel a mandate.
  fastify.delete('/mandates/:ref', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: { tags: ['transfers'], summary: 'Cancel a recurring mandate (SD-66)', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } },
  }, async (request, reply) => {
    const user = getUser(request);
    if (!user?.partyRef) return reply.code(401).send({ error: 'Unauthenticated' });
    const { ref } = request.params as { ref: string };
    const ok = await cancelMandate(fastify.db, ref, user.partyRef);
    return ok ? reply.send({ cancelled: true }) : reply.code(404).send({ error: 'Mandate not found or not active.' });
  });

  // POST /api/v1/gateway/transfers/mandates/run-due: run all due mandates (scheduler/admin).
  fastify.post('/mandates/run-due', {
    preHandler: requirePermission('beneficiaries', 'manage'),
    schema: { tags: ['transfers'], summary: 'Run all due recurring mandates (scheduler hook)', security: [{ bearerAuth: [] }] },
  }, async (_request, reply) => {
    return reply.send(await runDueMandates(fastify.db));
  });
}
