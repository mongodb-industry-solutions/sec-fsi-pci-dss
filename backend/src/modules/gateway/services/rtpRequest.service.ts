// BIAN SD-65 Payment Order: Request to Pay domain service (v28).
// RTP is an INTENT domain, strictly separate from payment execution. This service owns the request
// record lifecycle (create/get/list/present/view/cancel + transition), the per-request timeseries
// event trail, and the business/compliance ledger emissions. Approval → linked execution lives in
// rtpLifecycle.process.ts (F5); screening/VoP in transferRiskGate + vop dispatch (F4b).
import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import {
  PAYMENT_REQUEST_COLLECTION,
  PaymentRequestProcedure,
  PaymentRequestStatus,
  PaymentRequestRail,
  StructuredRemittance,
  StructuredAddress,
} from '../models/paymentRequest.model';
import { PAYMENT_REQUEST_EVENT_COLLECTION, PaymentRequestEvent } from '../models/paymentRequestEvent.model';
import { getPayoutAccount, getDefaultPayoutAccount } from './payoutAccount.service';
import { emitProcessEvent, EventActivityAttribution } from '../../provider/services/businessProcessEvent.service';
import { createNotification, markReadByRelated } from '../../notification/notifications.service';

const BIAN_SD = 'Payment Order';
const BIAN_CR = 'PaymentRequestProcedure';

export function hashAlias(alias: string): string {
  return createHash('sha256').update(alias.trim().toLowerCase()).digest('hex');
}

export interface CreateRtpInput {
  requesterPartyReference: string;
  amount: number;
  currency?: string;
  purpose?: string;
  payeeName?: string;
  payeeAlias?: string;
  payeeCounterpartyReference?: string;
  payeeReceivingAccountReference?: string;   // if omitted, requester's default active account is used
  payerPartyReference?: string;
  payerCounterpartyReference?: string;
  payerAlias?: string;
  invoiceReference?: string;
  dueAt?: Date;
  expiresAt?: Date;
  supportedRails?: PaymentRequestRail[];
  preferredRail?: PaymentRequestRail;
  structuredRemittance?: StructuredRemittance;
  unstructuredRemittance?: string;
  structuredAddress?: StructuredAddress;
  allowPartialPayment?: boolean;
  allowMultiplePayments?: boolean;
  idempotencyKey?: string;
  attribution?: EventActivityAttribution;
}

export class RtpError extends Error {
  constructor(public code: string, message: string, public httpStatus = 422) {
    super(message);
    this.name = 'RtpError';
  }
}

function coll(db: Db) {
  return db.collection<PaymentRequestProcedure>(PAYMENT_REQUEST_COLLECTION);
}

// Append a durable per-request timeseries event row (fast back-office history; complements the ledger).
async function appendRequestEvent(
  db: Db,
  req: Pick<PaymentRequestProcedure, 'paymentRequestInstanceReference'>,
  ev: { fromStatus?: string; toStatus: string; action: string; actor?: string | null; role?: string | null; summary?: string; meta?: Record<string, unknown> },
): Promise<void> {
  const row: PaymentRequestEvent = {
    eventDateTime: new Date(),
    paymentRequestInstanceReference: req.paymentRequestInstanceReference,
    fromStatus: ev.fromStatus,
    toStatus: ev.toStatus,
    action: ev.action,
    performedByPartyReference: ev.actor ?? undefined,
    performedByRole: ev.role ?? undefined,
    summary: ev.summary,
    meta: ev.meta,
    bianServiceDomain: BIAN_SD,
    bianControlRecordType: BIAN_CR,
  };
  await db.collection<PaymentRequestEvent>(PAYMENT_REQUEST_EVENT_COLLECTION).insertOne(row).catch(() => { /* best-effort */ });
}

export async function getRtpRequest(db: Db, ref: string): Promise<PaymentRequestProcedure | null> {
  return coll(db).findOne({ paymentRequestInstanceReference: ref });
}

export interface ListRtpFilter {
  requesterPartyReference?: string;
  payerPartyReference?: string;
  status?: PaymentRequestStatus;
}

export async function listRtpRequests(db: Db, filter: ListRtpFilter, limit = 100): Promise<PaymentRequestProcedure[]> {
  const q: Record<string, unknown> = {};
  if (filter.requesterPartyReference) q.requesterPartyReference = filter.requesterPartyReference;
  if (filter.payerPartyReference) q.payerPartyReference = filter.payerPartyReference;
  if (filter.status) q.status = filter.status;
  return coll(db).find(q).sort({ recordCreatedDateTime: -1 }).limit(limit).toArray();
}

// FR-v28-12: the payee must have an active payout account to request money.
async function resolveReceivingAccount(db: Db, input: CreateRtpInput): Promise<string> {
  if (input.payeeReceivingAccountReference) {
    const acc = await getPayoutAccount(db, input.payeeReceivingAccountReference);
    if (!acc || acc.payoutAccountStatus !== 'active') {
      throw new RtpError('no_payout_account', 'Receiving payout account is not active', 422);
    }
    if (acc.partyInstanceReference !== input.requesterPartyReference) {
      throw new RtpError('account_not_owned', 'Receiving account does not belong to the requester', 403);
    }
    return acc.payoutAccountInstanceReference;
  }
  const def = await getDefaultPayoutAccount(db, input.requesterPartyReference);
  if (!def) throw new RtpError('no_payout_account', 'Payee has no active payout account to receive funds', 422);
  return def.payoutAccountInstanceReference;
}

export async function createRtpRequest(db: Db, input: CreateRtpInput): Promise<PaymentRequestProcedure> {
  if (!(input.amount > 0)) throw new RtpError('invalid_amount', 'Amount must be greater than zero', 422);

  // Idempotent create: replay returns the original record.
  if (input.idempotencyKey) {
    const prior = await coll(db).findOne({ idempotencyKey: input.idempotencyKey, requesterPartyReference: input.requesterPartyReference });
    if (prior) return prior;
  }

  const receivingAccount = await resolveReceivingAccount(db, input);

  // Resolve the payer party from the requester's beneficiary (SD-54) when only the counterparty token
  // is provided (e.g. the merchant flow, which never handles raw party refs). Verifies ownership.
  let payerPartyReference = input.payerPartyReference;
  if (!payerPartyReference && input.payerCounterpartyReference) {
    const arr = await db.collection<{ counterpartyPartyReference?: string }>('counterpartyArrangement')
      .findOne({ counterpartyArrangementReference: input.payerCounterpartyReference, ownerPartyReference: input.requesterPartyReference } as Record<string, unknown>,
        { projection: { counterpartyPartyReference: 1 } });
    payerPartyReference = arr?.counterpartyPartyReference;
  }

  // Privacy model: the requester's own name is server-derived from their SD-13 party (authoritative,
  // authorized basic datum the payer may see on approval), not taken from client input. Falls back to
  // any client-provided payeeName only if the party lookup yields nothing.
  let payeeName = input.payeeName;
  try {
    const party = await db.collection<{ partyName?: string }>('party')
      .findOne({ partyInstanceReference: input.requesterPartyReference } as Record<string, unknown>, { projection: { partyName: 1 } });
    if (party?.partyName) payeeName = party.partyName;
  } catch { /* keep client-provided fallback */ }

  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 14 * 24 * 3600 * 1000);

  const req: PaymentRequestProcedure = {
    paymentRequestInstanceReference: uuidv4(),
    requestVersion: 1,
    requesterPartyReference: input.requesterPartyReference,
    payeeName,
    payeeCounterpartyReference: input.payeeCounterpartyReference,
    payeeAlias: input.payeeAlias,
    payeeAliasHash: input.payeeAlias ? hashAlias(input.payeeAlias) : undefined,
    payeeReceivingAccountReference: receivingAccount,
    payerPartyReference,
    payerCounterpartyReference: input.payerCounterpartyReference,
    payerAlias: input.payerAlias,
    payerAliasHash: input.payerAlias ? hashAlias(input.payerAlias) : undefined,
    amount: input.amount,
    currency: input.currency ?? 'EUR',
    purpose: input.purpose,
    invoiceReference: input.invoiceReference,
    dueAt: input.dueAt,
    expiresAt,
    allowPartialPayment: input.allowPartialPayment ?? false,
    allowMultiplePayments: input.allowMultiplePayments ?? false,
    supportedRails: input.supportedRails ?? ['sepa'],
    preferredRail: input.preferredRail,
    structuredRemittance: input.structuredRemittance,
    unstructuredRemittance: input.unstructuredRemittance,
    structuredAddress: input.structuredAddress,
    riskFlags: [],
    policyDecisions: [],
    status: 'created',
    presentationChannel: 'in_app',
    deliveryChannel: 'in_app',
    idempotencyKey: input.idempotencyKey,
    bianServiceDomain: BIAN_SD,
    bianControlRecordType: BIAN_CR,
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  // QE cannot encrypt null (error 31041). Strip undefined keys so omitted encrypted fields
  // (payeeName/payeeAlias/payerAlias/unstructuredRemittance/structuredAddress) are simply absent.
  const doc = Object.fromEntries(Object.entries(req).filter(([, v]) => v !== undefined)) as unknown as PaymentRequestProcedure;
  await coll(db).insertOne(doc);
  await appendRequestEvent(db, req, { toStatus: 'created', action: 'created', actor: input.requesterPartyReference, summary: 'RTP request created' });
  emitProcessEvent(db, {
    entityType: 'payment_request',
    entityId: req.paymentRequestInstanceReference,
    processType: 'payment_processing',
    processAction: 'rtp.request.created',
    processOutcome: 'submitted',
    performedByPartyReference: input.requesterPartyReference,
    performedByRole: null,
    eventSummary: { amount: req.amount, currency: req.currency, purpose: req.purpose },
    bianServiceDomain: BIAN_SD,
    bianControlRecordType: BIAN_CR,
    attribution: input.attribution,
  });
  return req;
}

// Internal transition helper: validate, persist, event-trail, ledger emit.
export async function transitionRequest(
  db: Db,
  ref: string,
  toStatus: PaymentRequestStatus,
  ctx: {
    action: string;
    actor?: string | null;
    role?: string | null;
    outcome?: 'approved' | 'rejected' | 'pending' | 'failed' | 'settled' | 'submitted';
    set?: Partial<PaymentRequestProcedure>;
    summary?: string;
    meta?: Record<string, unknown>;
    attribution?: EventActivityAttribution;
  },
): Promise<PaymentRequestProcedure> {
  const req = await getRtpRequest(db, ref);
  if (!req) throw new RtpError('not_found', 'Payment request not found', 404);
  // Idempotent no-op if already in the target status.
  if (req.status === toStatus) return req;
  const { assertTransition } = await import('./rtpStateMachine');
  assertTransition(req.status, toStatus);

  const update = { ...(ctx.set ?? {}), status: toStatus, recordUpdatedDateTime: new Date() };
  await coll(db).updateOne({ paymentRequestInstanceReference: ref, status: req.status }, { $set: update });
  const updated = { ...req, ...update } as PaymentRequestProcedure;

  await appendRequestEvent(db, req, {
    fromStatus: req.status, toStatus, action: ctx.action, actor: ctx.actor, role: ctx.role, summary: ctx.summary, meta: ctx.meta,
  });
  emitProcessEvent(db, {
    entityType: 'payment_request',
    entityId: ref,
    processType: 'payment_processing',
    processAction: ctx.action,
    processOutcome: ctx.outcome ?? 'pending',
    performedByPartyReference: ctx.actor ?? null,
    performedByRole: ctx.role ?? null,
    eventSummary: { toStatus, ...(ctx.meta ?? {}) },
    bianServiceDomain: BIAN_SD,
    bianControlRecordType: BIAN_CR,
    attribution: ctx.attribution,
  });
  return updated;
}

// Present/deliver the request to the payer and notify them (they must approve). FR-v28-03/-11.
export async function presentRtpRequest(db: Db, ref: string, actor?: string): Promise<PaymentRequestProcedure> {
  const updated = await transitionRequest(db, ref, 'presented', {
    action: 'rtp.request.presented', actor, outcome: 'pending', summary: 'RTP presented to payer',
  });
  if (updated.payerPartyReference) {
    await createNotification(db, {
      recipientPartyReference: updated.payerPartyReference,
      notificationType: 'payment_request',
      title: 'A payment request needs your approval',
      detail: `${updated.payeeName ?? 'A payee'} requested ${updated.amount} ${updated.currency}`,
      href: `/system/payment/history/${updated.paymentRequestInstanceReference}`,
      relatedReference: updated.paymentRequestInstanceReference,
      actionable: true,
    });
  }
  return updated;
}

// Payer rejects the request (in-app, authenticated). Captures the rejection authorizationContext.
export async function rejectRtpRequest(
  db: Db,
  ref: string,
  ctx: { actor?: string; role?: string; deviceUserAgent?: string; authMethod?: 'session_jwt' | 'oauth_session'; attribution?: EventActivityAttribution },
): Promise<PaymentRequestProcedure> {
  const updated = await transitionRequest(db, ref, 'rejected', {
    action: 'rtp.request.rejected', actor: ctx.actor, role: ctx.role, outcome: 'rejected', summary: 'RTP rejected by payer',
    attribution: ctx.attribution,
    set: {
      authorizationContext: {
        authMethod: ctx.authMethod ?? 'session_jwt',
        subject: ctx.actor ?? 'unknown',
        channel: 'in_app',
        deviceUserAgent: ctx.deviceUserAgent,
        authenticatedAt: new Date(),
        authResult: 'rejected',
      },
    },
  });
  if (updated.payerPartyReference) await markReadByRelated(db, updated.payerPartyReference, ref);
  await createNotification(db, {
    recipientPartyReference: updated.requesterPartyReference,
    notificationType: 'payment_request',
    title: 'Your payment request was declined',
    detail: `Request for ${updated.amount} ${updated.currency} was declined`,
    href: `/system/payment/history/${ref}`,
    relatedReference: ref,
    actionable: false,
  });
  return updated;
}

export async function viewRtpRequest(db: Db, ref: string, actor?: string): Promise<PaymentRequestProcedure> {
  return transitionRequest(db, ref, 'viewed', { action: 'rtp.request.viewed', actor, outcome: 'pending', summary: 'RTP viewed by payer' });
}

export async function cancelRtpRequest(db: Db, ref: string, actor?: string): Promise<PaymentRequestProcedure> {
  const updated = await transitionRequest(db, ref, 'cancelled', { action: 'rtp.request.cancelled', actor, outcome: 'rejected', summary: 'RTP cancelled by requester' });
  // Clear any pending-approval alert for the payer.
  if (updated.payerPartyReference) await markReadByRelated(db, updated.payerPartyReference, ref);
  // Notify payee (requester) it lapsed.
  await createNotification(db, {
    recipientPartyReference: updated.requesterPartyReference,
    notificationType: 'payment_request',
    title: 'Your payment request was cancelled',
    detail: `Request for ${updated.amount} ${updated.currency} was cancelled`,
    href: `/system/payment/history/${ref}`,
    relatedReference: ref,
    actionable: false,
  });
  return updated;
}
