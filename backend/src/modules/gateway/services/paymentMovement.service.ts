// Payment movement read-model (v36, ADR-063). ONE normalization + merge for every financial movement:
// card transaction, payment execution (P2P / bank transfer / merchant payout) and payment request (RTP).
// The gateway module owns executions and requests, so the merge lives here and the transaction module
// consumes it: previously the same rule was implemented three times (merchant channel controller,
// customer history page, merchant app history).
//
// Deliberately flow-agnostic: a row is derived from the STORED record, never from the choreography that
// produced it, so a future DB-driven payment-workflow orchestrator can add kinds or reroute steps
// without touching this surface. Add a normalizer, not a branch in the caller.

import { Db } from 'mongodb';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { PAYMENT_REQUEST_COLLECTION, PaymentRequestProcedure } from '../models/paymentRequest.model';
import { CARD_TRANSACTION_COLLECTION } from '../../transaction/models/cardTransaction.model';
import { RISK_HOLD_STEP } from './transferReview.service';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';

/** Movement kinds a row can carry. `transfer` covers P2P and bank transfers (the execution record). */
export type MovementKind = 'card' | 'transfer' | 'rtp';

/** Scope of a movement query. `card` is the default and preserves the pre-v36 behaviour. */
export type MovementScope = 'card' | 'all';

/**
 * One row of movement history. Field names are a PUBLIC CONTRACT: leafy-wallet
 * (`PspClient.listTransactions`) reads `paymentExecutionInstanceReference`, `direction`,
 * `grossAmount`, `currency`, `paymentExecutionStatus`, `concept`, `initiatedAt` and `completedAt`.
 * Never rename these; add fields instead.
 */
export interface MovementRow {
  kind: MovementKind;
  paymentExecutionInstanceReference: string;
  direction: 'sent' | 'received';
  grossAmount?: number;
  netAmount?: number;
  feeAmount?: number;
  currency: string;
  paymentExecutionRail: string | null;
  paymentExecutionStatus: string;
  concept: string | null;
  beneficiaryName: string | null;
  destinationAccountMasked: string | null;
  beneficiaryArrangementReference?: string | null;
  initiatedAt: string | null;
  completedAt: string | null;
  /** Accepted but not delivered: funds reserved while an investigation is open (ADR-060). */
  heldForReview?: boolean;
  /** RTP only: the execution that settles the request, when it exists. */
  linkedPaymentExecutionReference?: string | null;
  /** Card display extras (absent on other kinds). */
  merchantCategoryCode?: string | null;
  channel?: string | null;
  acceptanceMethod?: string | null;
  transactionType?: string | null;
  /**
   * Investigation status of the movement, distinct from its payment status: a movement can be
   * authorized/held AND flagged. Attached by `attachFraudCases`.
   */
  fraudCase?: {
    created: boolean;
    status?: string | null;
    reference?: string | null;
    severity?: string | null;
    outcome?: string | null;
  };
  /** Sort key, stripped before the row leaves the service. */
  _sortAt?: Date | null;
}

const iso = (d?: Date | string | null): string | null =>
  d ? (d instanceof Date ? d.toISOString() : new Date(d).toISOString()) : null;

// Contract fields: emitting undefined breaks a consumer that formats them, so both fall back here.
const UNKNOWN_STATUS = 'unknown';
const FALLBACK_CURRENCY = 'USD';
const status = (value?: string | null): string => (value && value.trim()) || UNKNOWN_STATUS;
const currencyOf = (value?: string | null): string => (value && value.trim().toUpperCase()) || FALLBACK_CURRENCY;

const isHeld = (exec: { paymentExecutionStatus?: string; resolutionLog?: Array<{ stepName?: string }> }): boolean =>
  exec.paymentExecutionStatus === 'pending' && !!exec.resolutionLog?.some((s) => s.stepName === RISK_HOLD_STEP);

/** Execution → row. `viewerPartyRef` decides the direction; omitted means an outbound view. */
export function normalizeExecutionRow(exec: PaymentExecutionProcedure, viewerPartyRef?: string): MovementRow {
  return {
    kind: 'transfer',
    paymentExecutionInstanceReference: exec.paymentExecutionInstanceReference,
    direction: viewerPartyRef && exec.beneficiaryPartyReference === viewerPartyRef
      && exec.initiatorPartyReference !== viewerPartyRef ? 'received' : 'sent',
    grossAmount: exec.grossAmount,
    netAmount: exec.netAmount,
    feeAmount: exec.feeAmount,
    currency: currencyOf(exec.currency),
    paymentExecutionRail: exec.paymentExecutionRail ?? null,
    paymentExecutionStatus: status(exec.paymentExecutionStatus),
    concept: exec.paymentExecutionRemittanceInformation ?? exec.routingNote ?? null,
    beneficiaryName: exec.beneficiaryName ?? null,
    destinationAccountMasked: exec.destinationAccountMasked ?? null,
    beneficiaryArrangementReference: exec.beneficiaryArrangementReference ?? null,
    initiatedAt: iso(exec.initiatedAt),
    completedAt: iso(exec.completedAt),
    heldForReview: isHeld(exec),
    _sortAt: exec.completedAt ?? exec.initiatedAt ?? null,
  };
}

/**
 * Payment request (RTP) → row. `payeeName` is QE:none and restricted to L2 / auditor, so it is only
 * carried when the caller says the viewer may see it.
 */
export function normalizeRequestRow(
  req: PaymentRequestProcedure,
  opts: { viewerPartyRef?: string; includePayeeName?: boolean } = {},
): MovementRow {
  return {
    kind: 'rtp',
    paymentExecutionInstanceReference: req.paymentRequestInstanceReference,
    direction: opts.viewerPartyRef && req.requesterPartyReference === opts.viewerPartyRef ? 'received' : 'sent',
    grossAmount: req.amount,
    currency: currencyOf(req.currency),
    paymentExecutionRail: null,
    paymentExecutionStatus: status(req.status),
    concept: req.purpose ?? null,
    beneficiaryName: opts.includePayeeName ? (req.payeeName ?? null) : null,
    destinationAccountMasked: null,
    initiatedAt: iso(req.recordCreatedDateTime),
    completedAt: null,
    // An accepted request whose execution has not been dispatched is held for review (ADR-061).
    heldForReview: req.status === 'accepted',
    linkedPaymentExecutionReference: req.linkedPaymentExecutionReference ?? null,
    _sortAt: req.recordCreatedDateTime ?? null,
  };
}

/** Card transaction → row. Card rows are always outbound from the cardholder's perspective. */
export function normalizeCardRow(txn: Record<string, unknown>): MovementRow {
  const amount = (txn.cardTransactionAmount ?? {}) as { amount?: number; currency?: string };
  const at = txn.cardTransactionDateTime as Date | string | undefined;
  return {
    kind: 'card',
    paymentExecutionInstanceReference: txn.cardTransactionInstanceReference as string,
    direction: 'sent',
    grossAmount: amount.amount,
    currency: currencyOf(amount.currency),
    paymentExecutionRail: 'card',
    paymentExecutionStatus: status(txn.cardTransactionStatus as string | undefined),
    concept: (txn.cardTransactionDescription as string) ?? null,
    beneficiaryName: (txn.cardTransactionMerchantName as string) ?? null,
    destinationAccountMasked: (txn.cardTransactionMaskedPanDisplay as string) ?? null,
    initiatedAt: iso(at),
    completedAt: iso(at),
    merchantCategoryCode: (txn.cardTransactionMerchantCategoryCode as string) ?? null,
    channel: (txn.cardTransactionChannel as string) ?? null,
    acceptanceMethod: (txn.cardTransactionAcceptanceMethod as string) ?? null,
    transactionType: (txn.cardTransactionType as string) ?? null,
    // An authorized card payment with an open case is withheld, not completed (ADR-059).
    heldForReview: txn.cardTransactionStatus === 'authorized',
    _sortAt: at ? new Date(at) : null,
  };
}

/**
 * BIAN keeps the RTP intent and the execution that settles it as SEPARATE records. Presentation rule
 * (unchanged from the pre-v36 clients): show the RTP row and hide its linked execution, so one
 * movement is listed once. Single implementation of the rule.
 */
export function dedupeRtpExecutions(rows: MovementRow[]): MovementRow[] {
  const linked = new Set(
    rows.filter((r) => r.kind === 'rtp' && r.linkedPaymentExecutionReference)
      .map((r) => r.linkedPaymentExecutionReference as string),
  );
  return linked.size === 0
    ? rows
    : rows.filter((r) => !(r.kind === 'transfer' && linked.has(r.paymentExecutionInstanceReference)));
}

/**
 * Attach the investigation summary to a page of rows. A fraud case stores the movement reference in
 * `cardTransactionInstanceReference` whatever the kind (ADR-062), so one `$in` covers all of them.
 * Case fields are plaintext (not CHD), so the unencrypted client reads them.
 */
export async function attachFraudCases(db: Db, rows: MovementRow[]): Promise<MovementRow[]> {
  const refs = rows.map((r) => r.paymentExecutionInstanceReference);
  if (refs.length === 0) return rows;
  const cases = await db.collection(FRAUD_DIAGNOSIS_COLLECTION).find(
    { cardTransactionInstanceReference: { $in: refs } },
    { projection: {
      _id: 0, cardTransactionInstanceReference: 1, fraudDiagnosisCaseStatus: 1,
      fraudDiagnosisCaseReference: 1, fraudDiagnosisCaseSeverity: 1,
      'fraudDiagnosisResolutionRecord.resolutionOutcome': 1,
    } },
  ).toArray().catch(() => []);
  const byRef = new Map(cases.map((c) => [c.cardTransactionInstanceReference as string, c as Record<string, unknown>]));
  return rows.map((r) => {
    const c = byRef.get(r.paymentExecutionInstanceReference);
    return {
      ...r,
      fraudCase: {
        created: !!c,
        status: (c?.fraudDiagnosisCaseStatus as string) ?? null,
        reference: (c?.fraudDiagnosisCaseReference as string) ?? null,
        severity: (c?.fraudDiagnosisCaseSeverity as string) ?? null,
        outcome: ((c?.fraudDiagnosisResolutionRecord as { resolutionOutcome?: string } | undefined)?.resolutionOutcome) ?? null,
      },
    };
  });
}

// ── Filters, applied to the merged set before paging, so `total` is the filtered count ──────────

/** Movement method: the two-axis taxonomy (how it was accepted) as opposed to its lifecycle state. */
export type MovementMethod = 'card' | 'payment_link' | 'redirect' | 'p2p' | 'bank' | 'rtp';

export interface MovementFilters {
  /** Lifecycle states; a UI status group covers several, so this is a list. */
  statuses?: string[];
  /** Money direction from the viewer's perspective. */
  direction?: 'in' | 'out';
  method?: MovementMethod;
  /** `any` = flagged, `none` = not flagged, anything else = that case status. Needs fraud attached. */
  fraud?: string;
  /** Free text over merchant/beneficiary, masked PAN, concept, reference and amount. */
  q?: string;
}

const BANK_RAILS = new Set(['sepa', 'ach', 'swift', 'local_bank']);
// A card refund/adjustment is money in; a state that moved nothing is neither in nor out.
const CARD_CREDIT_TYPES = new Set(['refund', 'adjustment']);
const NON_MOVEMENT_STATUS = new Set(['declined', 'failed', 'voided', 'expired', 'rejected', 'cancelled']);

export function movementDirection(row: MovementRow): 'in' | 'out' | 'neutral' {
  if (row.kind !== 'card') return row.direction === 'received' ? 'in' : 'out';
  if (NON_MOVEMENT_STATUS.has(row.paymentExecutionStatus)) return 'neutral';
  return row.transactionType && CARD_CREDIT_TYPES.has(row.transactionType) ? 'in' : 'out';
}

export function movementMethod(row: MovementRow): MovementMethod {
  if (row.kind === 'rtp') return 'rtp';
  if (row.kind === 'transfer') return BANK_RAILS.has((row.paymentExecutionRail ?? '').toLowerCase()) ? 'bank' : 'p2p';
  const accepted = (row.acceptanceMethod ?? '').toLowerCase();
  if (accepted === 'payment_link') return 'payment_link';
  if (accepted === 'redirect_checkout') return 'redirect';
  return 'card';
}

function matchesText(row: MovementRow, needle: string): boolean {
  const haystack = [
    row.beneficiaryName, row.destinationAccountMasked, row.concept, row.paymentExecutionInstanceReference,
    row.paymentExecutionRail, row.merchantCategoryCode, row.fraudCase?.reference,
    row.grossAmount != null ? String(row.grossAmount) : null,
  ];
  return haystack.some((v) => (v ?? '').toLowerCase().includes(needle));
}

export function filterMovements(rows: MovementRow[], filters: MovementFilters): MovementRow[] {
  const statuses = filters.statuses?.length ? new Set(filters.statuses) : undefined;
  const needle = filters.q?.trim().toLowerCase();
  return rows.filter((row) => {
    if (statuses && !statuses.has(row.paymentExecutionStatus)) return false;
    if (filters.direction && movementDirection(row) !== filters.direction) return false;
    if (filters.method && movementMethod(row) !== filters.method) return false;
    if (filters.fraud) {
      const flagged = !!row.fraudCase?.created;
      if (filters.fraud === 'none' && flagged) return false;
      if (filters.fraud === 'any' && !flagged) return false;
      if (filters.fraud !== 'none' && filters.fraud !== 'any' && row.fraudCase?.status !== filters.fraud) return false;
    }
    if (needle && !matchesText(row, needle)) return false;
    return true;
  });
}

/** True when the filter set can only be resolved with investigation data attached. */
export function needsFraudCases(filters: MovementFilters): boolean {
  return !!filters.fraud || !!filters.q?.trim();
}

export function sortAndPage(rows: MovementRow[], page: number, limit: number): { results: MovementRow[]; total: number } {
  const sorted = [...rows].sort((a, b) => (b._sortAt?.getTime() ?? 0) - (a._sortAt?.getTime() ?? 0));
  const slice = sorted.slice((page - 1) * limit, page * limit);
  return { total: sorted.length, results: slice.map(({ _sortAt, ...row }) => { void _sortAt; return row; }) };
}

export interface MovementQuery {
  /** Scope the movements to one party (customer or merchant on-behalf-of channel). */
  partyRef?: string;
  /** Merchant isolation: only movements attributed to this merchant agreement. */
  merchantRef?: string;
  /** RTP payee name is QE:none / L2-only. */
  includePayeeName?: boolean;
  /** Upper bound per source before the merge; the merged page is applied afterwards. */
  sourceLimit?: number;
}

/**
 * Non-card movements (executions + requests) for a scope, normalized and RTP-de-duped. Card rows are
 * merged in by the caller, which owns the QE-aware card query and its fraud-case enrichment.
 * The merge is in memory on purpose: `cardTransactionLog` is QE-enabled and aggregation stages such
 * as `$unionWith` are restricted over encrypted collections.
 */
export async function listNonCardMovements(db: Db, q: MovementQuery = {}): Promise<MovementRow[]> {
  const cap = q.sourceLimit ?? 200;

  const execFilter: Record<string, unknown> = {};
  if (q.merchantRef) execFilter.merchantAgreementReference = q.merchantRef;
  if (q.partyRef) {
    execFilter.$or = [{ initiatorPartyReference: q.partyRef }, { beneficiaryPartyReference: q.partyRef }];
  }
  const execs = await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
    .find(execFilter).sort({ initiatedAt: -1 }).limit(cap).toArray().catch(() => []);

  // RTP carries no merchant attribution, so a merchant-isolated view has no requests of its own:
  // including them would both break isolation and duplicate the rows the merchant channel's clients
  // already fetch from the RTP API themselves.
  const reqFilter: Record<string, unknown> = {};
  if (q.partyRef) {
    reqFilter.$or = [{ payerPartyReference: q.partyRef }, { requesterPartyReference: q.partyRef }];
  }
  const requests = q.merchantRef
    ? []
    : await db.collection<PaymentRequestProcedure>(PAYMENT_REQUEST_COLLECTION)
        .find(reqFilter).sort({ recordCreatedDateTime: -1 }).limit(cap).toArray().catch(() => []);

  const rows = [
    ...execs.map((e) => normalizeExecutionRow(e, q.partyRef)),
    ...requests.map((r) => normalizeRequestRow(r, { viewerPartyRef: q.partyRef, includePayeeName: q.includePayeeName })),
  ];
  return dedupeRtpExecutions(rows);
}

/** One movement by reference, whatever kind it is. Returns null when nothing matches. */
export async function getMovementByRef(
  db: Db,
  ref: string,
  opts: { includePayeeName?: boolean } = {},
): Promise<MovementRow | null> {
  const exec = await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
    .findOne({ paymentExecutionInstanceReference: ref }).catch(() => null);
  if (exec) return normalizeExecutionRow(exec);

  const req = await db.collection<PaymentRequestProcedure>(PAYMENT_REQUEST_COLLECTION)
    .findOne({ paymentRequestInstanceReference: ref }).catch(() => null);
  if (req) return normalizeRequestRow(req, { includePayeeName: opts.includePayeeName });

  const txn = await db.collection(CARD_TRANSACTION_COLLECTION)
    .findOne({ cardTransactionInstanceReference: ref }).catch(() => null);
  return txn ? normalizeCardRow(txn as Record<string, unknown>) : null;
}
