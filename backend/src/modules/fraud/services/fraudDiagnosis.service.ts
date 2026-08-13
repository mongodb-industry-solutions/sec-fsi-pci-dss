import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  FRAUD_DIAGNOSIS_COLLECTION,
  FRAUD_DIAGNOSIS_EVENTS_COLLECTION,
  FraudDiagnosisControlRecord,
  FraudDiagnosisCaseEventRecord,
  AnalystRole,
} from '../models/fraudDiagnosis.model';
import { RiskSeverity } from '../../../shared/models/risk.model';
import { TransactionSnapshot } from '../../../shared/models/transaction.model';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitProcessEvent } from '../../provider/services/businessProcessEvent.service';
import { CARD_TRANSACTION_COLLECTION } from '../../transaction/models/cardTransaction.model';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../../gateway/models/paymentExecution.model';
import { createNotification } from '../../notification/notifications.service';

// -- Note entry - resolved view of a note_added event enriched with retraction info
export interface NoteEntry {
  noteId: string;
  noteText: string;
  visibility: 'internal' | 'customer';
  performedByRole: string;
  actionDateTime: string;           // ISO 8601
  isRetracted: boolean;
  retractionReason: string | null;
  retractionDateTime: string | null;
}

const COUNTERS_COLLECTION = 'counters';
const CASE_REF_SEQUENCE = 'fraudDiagnosisCaseReference';

// Atomic, restart-safe sequence for the human-readable case reference.
// The previous in-memory counter reset on every server start, producing DUPLICATE
// references (e.g. two cases both "FD-2026-001001"). The case reference is the
// BIAN business key of the Fraud Diagnosis control record and must be unique;
// a unique index on the field enforces it at the data layer (see createIndexes).
async function nextCaseRef(db: Db): Promise<string> {
  const res = await db
    .collection<{ _id: string; seq: number }>(COUNTERS_COLLECTION)
    .findOneAndUpdate(
      { _id: CASE_REF_SEQUENCE },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
  const seq = (res as { seq?: number } | null)?.seq ?? 1;
  const year = new Date().getFullYear();
  return `FD-${year}-${String(seq).padStart(6, '0')}`;
}

// MongoDB duplicate-key error code. We only treat a collision on the case-reference
// business-key index as recoverable; anything else propagates.
const MONGO_DUPLICATE_KEY = 11000;
function isCaseRefDuplicate(e: unknown): boolean {
  const err = e as { code?: number; keyPattern?: Record<string, unknown> } | null;
  return err?.code === MONGO_DUPLICATE_KEY && !!err?.keyPattern?.fraudDiagnosisCaseReference;
}

// Self-healing: advance the sequence counter to at least the highest numeric suffix
// currently present in the collection. The seeded counter ($setOnInsert seq:1000) can
// drift BELOW existing references when the counter document was created by a runtime
// $inc (seq starting at 1) before the seed ran, or when the DB predates ADR-024. That
// makes nextCaseRef hand out references that already exist (E11000 on insert). Calling
// this on a collision realigns the counter so the very next allocation is unique, with
// no DB reset required. Uses the $max UPDATE OPERATOR (not an aggregation pipeline): the
// QE/CSFLE-enabled client rejects pipeline updates (analyze_query, code 31146), and $max
// only ever raises the counter; never lowers an already-advanced one.
async function reconcileCaseRefCounter(db: Db): Promise<void> {
  const docs = await db
    .collection(FRAUD_DIAGNOSIS_COLLECTION)
    .find({}, { projection: { _id: 0, fraudDiagnosisCaseReference: 1 } })
    .toArray();
  let max = 1000;
  for (const d of docs as Array<{ fraudDiagnosisCaseReference?: string }>) {
    const m = /(\d+)\s*$/.exec(d.fraudDiagnosisCaseReference ?? '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  await db.collection<{ _id: string; seq: number }>(COUNTERS_COLLECTION).updateOne(
    { _id: CASE_REF_SEQUENCE },
    { $max: { seq: max } },
    { upsert: true },
  );
}

export async function createFraudCase(
  db: Db,
  txnId: string,
  customerRef: string,
  riskIndicators: string[],
  severity: RiskSeverity,
  transactionSnapshot: TransactionSnapshot,
  // P13.3 (D2): the authoritative fraud score from the FDS verdict. When provided, it IS the case
  // score (congruent with fds.scoring.completed). When omitted (manual/legacy), fall back to the
  // indicator-count heuristic so existing callers keep working.
  fraudScore?: number,
) {
  const caseId = uuidv4();
  const now = new Date();
  const resolvedScore = typeof fraudScore === 'number'
    ? Math.min(100, Math.round(fraudScore))
    : Math.min(100, riskIndicators.length * 40);

  const fraudCase: Omit<FraudDiagnosisControlRecord, never> = {
    fraudDiagnosisInstanceReference: caseId,
    fraudDiagnosisCaseReference: '', // assigned per-attempt below (self-healing against counter drift)
    cardTransactionInstanceReference: txnId,
    customerAgreementInstanceReference: customerRef,
    transactionSnapshot,
    fraudDiagnosisCaseStatus: 'open',
    fraudDiagnosisCaseSeverity: severity,
    fraudDiagnosisRequestDateTime: now,
    fraudDiagnosisAssessment: {
      riskIndicators,
      fraudDiagnosisScore: resolvedScore,
    },
    bianServiceDomain: 'Fraud Diagnosis',
    bianControlRecordType: 'FraudDiagnosis',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  const openEvent: FraudDiagnosisCaseEventRecord = {
    fraudDiagnosisInstanceReference: caseId,
    actionDateTime: now,
    actionType: 'case_opened',
    performedByInstanceReference: 'system',
    performedByName: 'Automated detection',
    performedByRole: 'payment_service',
    actionDetails: { trigger: riskIndicators[0] ?? 'manual' },
    schemaVersion: 1,
  };

  // Allocate the human-readable reference and insert, retrying if the counter has
  // drifted behind existing references. On the first collision we realign the counter
  // (reconcile) so the next attempt is guaranteed unique. A payment must never fail
  // because of a stale demo counter.
  let inserted = false;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    fraudCase.fraudDiagnosisCaseReference = await nextCaseRef(db);
    try {
      await db.collection(FRAUD_DIAGNOSIS_COLLECTION).insertOne(fraudCase as object);
      inserted = true;
    } catch (e) {
      if (isCaseRefDuplicate(e)) {
        await reconcileCaseRefCounter(db);
        continue;
      }
      throw e;
    }
  }
  if (!inserted) {
    throw new Error('Could not allocate a unique fraudDiagnosisCaseReference after reconciling the counter.');
  }
  await db.collection(FRAUD_DIAGNOSIS_EVENTS_COLLECTION).insertOne(openEvent as object);

  void dispatchProvider(db, 'fraud_detection', 'fraud.create.case', {
    fraudDiagnosisInstanceReference: caseId,
    cardTransactionInstanceReference: txnId,
    customerAgreementInstanceReference: customerRef,
    fraudDiagnosisScore: fraudCase.fraudDiagnosisAssessment.fraudDiagnosisScore,
    riskIndicatorCount: riskIndicators.length,
    severity,
  }, { entityType: 'fraud_case', entityId: caseId, processType: 'fraud_evaluation' })
    .catch(() => { /* fire-and-forget: dispatch failure does not block case creation */ });

  emitProcessEvent(db, {
    entityType: 'fraud_case',
    entityId: caseId,
    processType: 'fraud_evaluation',
    processAction: 'fraud.case.opened',
    processOutcome: 'pending',
    performedByPartyReference: null,
    performedByRole: null,
    eventSummary: {
      transactionId: txnId,
      severity,
      riskIndicators,
      score: fraudCase.fraudDiagnosisAssessment.fraudDiagnosisScore,
    },
    bianServiceDomain: 'Fraud Diagnosis',
    bianControlRecordType: 'FraudDiagnosisCase',
  });

  // Notify the customer that their transaction is under review (flagged). Non-blocking.
  const agreement = await db.collection(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne<{ partyInstanceReference?: string }>({ customerAgreementInstanceReference: customerRef });
  await createNotification(db, {
    recipientPartyReference: agreement?.partyInstanceReference ?? '',
    notificationType: 'transaction_status',
    title: 'Your transaction is under security review',
    detail: 'We flagged a recent transaction for a routine security review. We will let you know the outcome.',
    href: `/system/payment/history/${txnId}`,
    relatedReference: `status-flagged-${caseId}`,
    transactionId: txnId,
    caseReference: fraudCase.fraudDiagnosisCaseReference,
    actionable: false,
  }).catch(() => { /* notification must never block case creation */ });

  return { fraudDiagnosisInstanceReference: caseId };
}

// Terminal statuses: a case in one of these is not an active investigation. Used to
// decide whether a manual open should dedup to an existing case or start a new one.
const RESOLVED_STATUSES: FraudDiagnosisControlRecord['fraudDiagnosisCaseStatus'][] = ['resolved_cleared', 'resolved_fraud', 'closed'];

// Map an payment-execution status onto the display-only cardTransactionStatus enum
// carried by the shared TransactionSnapshot. This is presentation only (no CHD), so a coarse
// mapping is fine: completed -> settled, terminal failures -> declined, everything else pending.
function execStatusToSnapshotStatus(status: string): TransactionSnapshot['cardTransactionStatus'] {
  if (status === 'completed') return 'settled';
  if (status === 'failed' || status === 'exception' || status === 'reversed') return 'declined';
  if (status === 'refunded') return 'disputed';
  return 'pending';
}

// manually open a fraud case from a payment execution (transfer), mirroring the
// automated P2P compliance path (modules/gateway/services/p2pCompliance.process.ts). Builds a
// DISPLAY-SAFE snapshot (no CHD, no raw IBAN), creates the case, then stamps it with the
// paymentExecutionInstanceReference + transactionKind discriminator. Dedups to an existing
// non-resolved case for the same execution instead of creating a duplicate.
export async function openCaseFromExecution(
  db: Db,
  executionId: string,
  reason: string | undefined,
): Promise<
  | { fraudDiagnosisInstanceReference: string; fraudDiagnosisCaseReference: string; alreadyExisted: boolean }
  | { notFound: true }
> {
  // Dedup: an active (non-resolved/closed) case already covers this execution.
  const existing = await db.collection<FraudDiagnosisControlRecord>(FRAUD_DIAGNOSIS_COLLECTION).findOne({
    paymentExecutionInstanceReference: executionId,
    fraudDiagnosisCaseStatus: { $nin: RESOLVED_STATUSES },
  });
  if (existing) {
    return {
      fraudDiagnosisInstanceReference: existing.fraudDiagnosisInstanceReference,
      fraudDiagnosisCaseReference: existing.fraudDiagnosisCaseReference,
      alreadyExisted: true,
    };
  }

  const exec = await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
    .findOne({ paymentExecutionInstanceReference: executionId });
  if (!exec) return { notFound: true };

  // Derive the subject customer agreement from the initiator (fallback: beneficiary) party.
  const partyRef = exec.initiatorPartyReference ?? exec.beneficiaryPartyReference;
  let customerRef = partyRef ?? executionId;
  if (partyRef) {
    const agreement = await db.collection<{ customerAgreementInstanceReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
      .findOne({ partyInstanceReference: partyRef } as Record<string, unknown>, { projection: { customerAgreementInstanceReference: 1 } });
    if (agreement?.customerAgreementInstanceReference) customerRef = agreement.customerAgreementInstanceReference;
  }

  const amount = exec.grossAmount ?? 0;
  const severity: RiskSeverity =
    amount > 1000 ? 'critical' :
    amount > 500  ? 'high'     :
    amount > 200  ? 'medium'   : 'low';

  const direction = exec.initiatorPartyReference ? 'outbound' : 'inbound';

  // DISPLAY-SAFE snapshot: amount, currency, rail, status, direction, beneficiaryName and the MASKED
  // destination account only. No CHD, no raw IBAN. Extra transfer-context fields ride alongside the
  // core TransactionSnapshot shape (same approach as the automated P2P path).
  const snapshot = {
    cardTransactionAmount: { amount, currency: exec.currency },
    cardTransactionMerchantName: exec.beneficiaryName ?? `Transfer${exec.destinationAccountMasked ? ` to ${exec.destinationAccountMasked}` : ''}`,
    cardTransactionDateTime: exec.initiatedAt ?? exec.recordCreatedDateTime,
    cardTransactionStatus: execStatusToSnapshotStatus(exec.paymentExecutionStatus),
    cardTransactionMaskedPanDisplay: exec.destinationAccountMasked ?? 'Bank transfer',
    transferRail: exec.paymentExecutionRail,
    transferStatus: exec.paymentExecutionStatus,
    transferDirection: direction,
    beneficiaryName: exec.beneficiaryName,
    destinationAccountMasked: exec.destinationAccountMasked,
  } as TransactionSnapshot;

  const created = await createFraudCase(
    db,
    executionId,
    customerRef,
    [reason ? `manual_review: ${reason}` : 'manual_review'],
    severity,
    snapshot,
  );

  // Discriminate as a P2P/transfer case and link the execution, exactly like the P2P process.
  await db.collection(FRAUD_DIAGNOSIS_COLLECTION).updateOne(
    { fraudDiagnosisInstanceReference: created.fraudDiagnosisInstanceReference },
    { $set: { paymentExecutionInstanceReference: executionId, transactionKind: 'p2p', recordUpdatedDateTime: new Date() } },
  );

  const caseDoc = await getCaseById(db, created.fraudDiagnosisInstanceReference);
  return {
    fraudDiagnosisInstanceReference: created.fraudDiagnosisInstanceReference,
    fraudDiagnosisCaseReference: caseDoc?.fraudDiagnosisCaseReference ?? '',
    alreadyExisted: false,
  };
}

export async function getCases(
  db: Db,
  filters: { status?: string; severity?: string; transactionId?: string; customerId?: string; caseReference?: string },
  page: number,
  limit: number
) {
  const query: Record<string, unknown> = {};
  if (filters.status)        query['fraudDiagnosisCaseStatus']          = filters.status;
  if (filters.severity)      query['fraudDiagnosisCaseSeverity']        = filters.severity;
  if (filters.transactionId) query['cardTransactionInstanceReference']   = filters.transactionId;
  if (filters.customerId)    query['customerAgreementInstanceReference'] = filters.customerId;
  // Case-reference search (e.g. "FD-2026-001001"); case-insensitive contains.
  if (filters.caseReference) query['fraudDiagnosisCaseReference']        = { $regex: filters.caseReference, $options: 'i' };

  const skip = (page - 1) * limit;
  const [results, total] = await Promise.all([
    db.collection<FraudDiagnosisControlRecord>(FRAUD_DIAGNOSIS_COLLECTION)
      .find(query)
      .sort({ fraudDiagnosisRequestDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection(FRAUD_DIAGNOSIS_COLLECTION).countDocuments(query),
  ]);

  return { results, total, page, limit };
}

export async function getCaseById(db: Db, id: string) {
  return db.collection<FraudDiagnosisControlRecord>(FRAUD_DIAGNOSIS_COLLECTION)
    .findOne({ fraudDiagnosisInstanceReference: id });
}

/**
 * Fraud investigation analytics for L1 / L2 / auditor dashboards.
 * Aggregation over operational case metadata only; fraudDiagnosisCase carries no
 * cardholder PII (PCI DSS). `$toDate` tolerates Date or ISO-string dates.
 */
export async function getFraudStats(db: Db) {
  const coll = db.collection(FRAUD_DIAGNOSIS_COLLECTION);

  const [byStatus, bySeverity, byMonth, totalAgg] = await Promise.all([
    coll.aggregate([
      { $group: { _id: '$fraudDiagnosisCaseStatus', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    coll.aggregate([
      { $group: { _id: '$fraudDiagnosisCaseSeverity', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    coll.aggregate([
      { $group: { _id: { y: { $year: { $toDate: '$fraudDiagnosisRequestDateTime' } }, m: { $month: { $toDate: '$fraudDiagnosisRequestDateTime' } } }, count: { $sum: 1 } } },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]).toArray(),
    coll.aggregate([{ $count: 'total' }]).toArray(),
  ]);

  const countFor = (status: string) => (byStatus.find((s) => s._id === status)?.count as number) ?? 0;
  return {
    total: (totalAgg[0]?.total as number) ?? 0,
    open: countFor('open'),
    underReview: countFor('under_review'),
    escalated: countFor('escalated'),
    resolvedFraud: countFor('resolved_fraud'),
    resolvedCleared: countFor('resolved_cleared'),
    byStatus:   byStatus.map((s) => ({ status: s._id as string, count: s.count as number })),
    bySeverity: bySeverity.map((s) => ({ severity: s._id as string, count: s.count as number })),
    byMonth:    byMonth.map((s) => ({ year: (s._id as { y: number }).y, month: (s._id as { m: number }).m, count: s.count as number })),
  };
}

/**
 * Data-integrity oversight for the Security Auditor (PCI DSS): verifies the
 * Fraud Diagnosis control records are well-formed. Aggregates only; no PII.
 *  - duplicateReferences: case references appearing on more than one case (must be 0;
 *    enforced by the unique index after a clean re-seed; see ADR-024).
 *  - orphan references: cases whose linked transaction / customer no longer resolve.
 */
export async function getFraudIntegrity(db: Db) {
  const cases = db.collection(FRAUD_DIAGNOSIS_COLLECTION);

  // NOTE: use find()+projection, NOT distinct(): under CSFLE/QE the driver attaches
  // encryptionInformation to `distinct`, which the server rejects (code 40415).
  // The referenced ids are plaintext fields, so a projected find reads them fine.
  const [dupAgg, totalCases, caseRefs, txnDocs, custDocs] = await Promise.all([
    cases.aggregate([
      { $group: { _id: '$fraudDiagnosisCaseReference', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    cases.countDocuments({}),
    cases.find({}, { projection: { _id: 0, cardTransactionInstanceReference: 1, customerAgreementInstanceReference: 1 } }).toArray(),
    db.collection(CARD_TRANSACTION_COLLECTION).find({}, { projection: { _id: 0, cardTransactionInstanceReference: 1 } }).toArray(),
    db.collection(CUSTOMER_AGREEMENT_COLLECTION).find({}, { projection: { _id: 0, customerAgreementInstanceReference: 1 } }).toArray(),
  ]);

  const txnSet = new Set(
    (txnDocs as Array<{ cardTransactionInstanceReference?: string }>).map((t) => t.cardTransactionInstanceReference).filter(Boolean) as string[],
  );
  const custSet = new Set(
    (custDocs as Array<{ customerAgreementInstanceReference?: string }>).map((c) => c.customerAgreementInstanceReference).filter(Boolean) as string[],
  );
  let orphanTransactionRefs = 0;
  // Group unresolved customer references with how many cases point at each, so the
  // auditor can review them as a list (each links to Cases filtered by that customerId).
  const orphanCustomerMap = new Map<string, number>();
  for (const c of caseRefs as Array<{ cardTransactionInstanceReference?: string; customerAgreementInstanceReference?: string }>) {
    if (c.cardTransactionInstanceReference && !txnSet.has(c.cardTransactionInstanceReference)) orphanTransactionRefs++;
    if (c.customerAgreementInstanceReference && !custSet.has(c.customerAgreementInstanceReference)) {
      orphanCustomerMap.set(c.customerAgreementInstanceReference, (orphanCustomerMap.get(c.customerAgreementInstanceReference) ?? 0) + 1);
    }
  }
  const orphanCustomerReferences = Array.from(orphanCustomerMap.entries())
    .map(([reference, count]) => ({ reference, count }))
    .sort((a, b) => b.count - a.count);

  const duplicateReferences = dupAgg.map((d) => ({ reference: d._id as string, count: d.count as number }));
  return {
    totalCases,
    duplicateReferences,
    duplicateCount: duplicateReferences.length,
    orphanTransactionRefs,
    orphanCustomerReferences,
    orphanCustomerRefs: orphanCustomerReferences.length,
    healthy: duplicateReferences.length === 0 && orphanTransactionRefs === 0 && orphanCustomerReferences.length === 0,
  };
}

export async function updateCase(
  db: Db,
  id: string,
  patch: {
    fraudDiagnosisCaseStatus?: FraudDiagnosisControlRecord['fraudDiagnosisCaseStatus'];
    fraudDiagnosisCaseNotes?: string;
    fraudDiagnosisCustomerSubjectNotes?: string;
    fraudDiagnosisAnalystInstanceReference?: string;
    fraudDiagnosisResolutionRecord?: FraudDiagnosisControlRecord['fraudDiagnosisResolutionRecord'];
    fraudDiagnosisEscalationAcceptedAt?: Date | null;
  }
) {
  const now = new Date();
  const update: Record<string, unknown> = { recordUpdatedDateTime: now };

  if (patch.fraudDiagnosisCaseStatus !== undefined)
    update['fraudDiagnosisCaseStatus'] = patch.fraudDiagnosisCaseStatus;
  if (patch.fraudDiagnosisAnalystInstanceReference !== undefined)
    update['fraudDiagnosisAnalystInstanceReference'] = patch.fraudDiagnosisAnalystInstanceReference;
  if (patch.fraudDiagnosisResolutionRecord !== undefined)
    update['fraudDiagnosisResolutionRecord'] = patch.fraudDiagnosisResolutionRecord;
  if (patch.fraudDiagnosisCaseNotes !== undefined)
    update['fraudDiagnosisCaseNotes'] = patch.fraudDiagnosisCaseNotes;
  if (patch.fraudDiagnosisCustomerSubjectNotes !== undefined)
    update['fraudDiagnosisCustomerSubjectNotes'] = patch.fraudDiagnosisCustomerSubjectNotes;
  if ('fraudDiagnosisEscalationAcceptedAt' in patch)
    update['fraudDiagnosisEscalationAcceptedAt'] = patch.fraudDiagnosisEscalationAcceptedAt ?? null;

  const result = await db.collection(FRAUD_DIAGNOSIS_COLLECTION).findOneAndUpdate(
    { fraudDiagnosisInstanceReference: id },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (result) await publishCaseResolved(db, result as unknown as FraudDiagnosisControlRecord, patch.fraudDiagnosisCaseStatus);
  return result ?? null;
}

// A resolved case closes the payment decision it opened: the payout process listens and either
// releases the withheld payout (cleared) or returns the hold and declines it (confirmed fraud).
async function publishCaseResolved(
  db: Db,
  fraudCase: FraudDiagnosisControlRecord,
  newStatus?: FraudDiagnosisControlRecord['fraudDiagnosisCaseStatus'],
): Promise<void> {
  if (newStatus !== 'resolved_cleared' && newStatus !== 'resolved_fraud') return;
  const txnId = fraudCase.cardTransactionInstanceReference;
  if (!txnId) return;
  try {
    const { getEventBus, makeEvent } = await import('../../../vendors/eventbus');
    await getEventBus().publish(makeEvent({
      eventType: 'fraud.case.resolved', correlationId: txnId, businessProcess: 'fraud_investigation',
      source: 'fraud.diagnosis',
      payload: {
        fraudDiagnosisInstanceReference: fraudCase.fraudDiagnosisInstanceReference,
        cardTransactionInstanceReference: txnId,
        outcome: newStatus === 'resolved_cleared' ? 'cleared' : 'confirmed_fraud',
      },
      bian: { serviceDomain: 'SD-83 Fraud Diagnosis', controlRecord: 'FraudDiagnosisCase' },
    }));
  } catch (err) {
    // The case resolution itself must never fail because the payment follow-up could not be published.
    console.error('[fraud] publish fraud.case.resolved failed:', err);
  }
}

export async function getCaseEvents(db: Db, caseId: string) {
  const events = await db.collection<FraudDiagnosisCaseEventRecord>(FRAUD_DIAGNOSIS_EVENTS_COLLECTION)
    .find({ fraudDiagnosisInstanceReference: caseId })
    .sort({ actionDateTime: 1 })
    .toArray();
  return { caseId, events };
}

export async function getAllAuditEvents(
  db: Db,
  page: number,
  limit: number
) {
  const skip = (page - 1) * limit;

  const events = await db.collection(FRAUD_DIAGNOSIS_EVENTS_COLLECTION)
    .aggregate([
      { $sort: { actionDateTime: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: FRAUD_DIAGNOSIS_COLLECTION,
          localField: 'fraudDiagnosisInstanceReference',
          foreignField: 'fraudDiagnosisInstanceReference',
          as: 'caseData',
          pipeline: [{ $project: { fraudDiagnosisCaseReference: 1 } }],
        },
      },
      {
        $addFields: {
          fraudDiagnosisCaseReference: { $arrayElemAt: ['$caseData.fraudDiagnosisCaseReference', 0] },
        },
      },
      { $project: { caseData: 0 } },
    ])
    .toArray();

  const total = await db.collection(FRAUD_DIAGNOSIS_EVENTS_COLLECTION).countDocuments();

  return { events, total, page, limit };
}

// PCI DSS: each audit entry must identify the INDIVIDUAL user who acted,
// not just the role (multiple L1/L2 share a role). `actor` carries the acting user's unique id
// (partyRef/sub) and display name from their JWT; BIAN records this as performedByPartyReference.
export async function appendAuditEvent(
  db: Db,
  caseId: string,
  actionType: FraudDiagnosisCaseEventRecord['actionType'],
  performedByRole: FraudDiagnosisCaseEventRecord['performedByRole'],
  details: Record<string, unknown>,
  actor?: { ref?: string; name?: string }
): Promise<void> {
  const event: FraudDiagnosisCaseEventRecord = {
    fraudDiagnosisInstanceReference: caseId,
    actionDateTime: new Date(),
    actionType,
    performedByInstanceReference: actor?.ref ?? 'rbac-layer',
    performedByName: actor?.name,
    performedByRole,
    actionDetails: details,
    schemaVersion: 1,
  };
  await db.collection(FRAUD_DIAGNOSIS_EVENTS_COLLECTION).insertOne(event as object);
}

// -- append-only notes --------------------------------------------

export async function addCaseNote(
  db: Db,
  caseId: string,
  noteText: string,
  visibility: 'internal' | 'customer',
  performedByRole: AnalystRole,
  actor?: { ref?: string; name?: string }
): Promise<{ noteId: string; actionDateTime: Date }> {
  const noteId = uuidv4();
  const actionDateTime = new Date();
  const event: FraudDiagnosisCaseEventRecord = {
    fraudDiagnosisInstanceReference: caseId,
    actionDateTime,
    actionType: 'note_added',
    performedByInstanceReference: actor?.ref ?? 'rbac-layer',
    performedByName: actor?.name,
    performedByRole,
    actionDetails: { noteId, noteText, visibility },
    schemaVersion: 1,
  };
  await db.collection(FRAUD_DIAGNOSIS_EVENTS_COLLECTION).insertOne(event as object);
  return { noteId, actionDateTime };
}

export async function retractCaseNote(
  db: Db,
  caseId: string,
  retractedNoteId: string,
  retractionReason: string | undefined,
  performedByRole: AnalystRole,
  actor?: { ref?: string; name?: string }
): Promise<'ok' | 'not_found' | 'already_retracted' | 'wrong_role'> {
  const col = db.collection<FraudDiagnosisCaseEventRecord>(FRAUD_DIAGNOSIS_EVENTS_COLLECTION);

  const original = await col.findOne({
    fraudDiagnosisInstanceReference: caseId,
    actionType: 'note_added',
    'actionDetails.noteId': retractedNoteId,
  } as object);

  if (!original) return 'not_found';
  if (original.performedByRole !== performedByRole) return 'wrong_role';

  const alreadyRetracted = await col.findOne({
    fraudDiagnosisInstanceReference: caseId,
    actionType: 'note_retracted',
    'actionDetails.retractedNoteId': retractedNoteId,
  } as object);
  if (alreadyRetracted) return 'already_retracted';

  const now = new Date();
  const retractionEvent: FraudDiagnosisCaseEventRecord = {
    fraudDiagnosisInstanceReference: caseId,
    actionDateTime: now,
    actionType: 'note_retracted',
    performedByInstanceReference: actor?.ref ?? 'rbac-layer',
    performedByName: actor?.name,
    performedByRole,
    actionDetails: {
      noteId: uuidv4(),
      retractedNoteId,
      retractionReason: retractionReason ?? null,
      visibility: original.actionDetails['visibility'],
    },
    schemaVersion: 1,
  };
  await db.collection(FRAUD_DIAGNOSIS_EVENTS_COLLECTION).insertOne(retractionEvent as object);
  return 'ok';
}

export async function getCaseNotes(
  db: Db,
  caseId: string,
  visibilityFilter?: 'internal' | 'customer'
): Promise<NoteEntry[]> {
  const col = db.collection<FraudDiagnosisCaseEventRecord>(FRAUD_DIAGNOSIS_EVENTS_COLLECTION);

  const events = await col
    .find({
      fraudDiagnosisInstanceReference: caseId,
      actionType: { $in: ['note_added', 'note_retracted'] },
    } as object)
    .sort({ actionDateTime: 1 })
    .toArray();

  // Build retraction index: retractedNoteId → retraction event
  const retractions = new Map<string, FraudDiagnosisCaseEventRecord>();
  for (const e of events) {
    if (e.actionType === 'note_retracted') {
      retractions.set(e.actionDetails['retractedNoteId'] as string, e);
    }
  }

  const notes: NoteEntry[] = [];
  for (const e of events) {
    if (e.actionType !== 'note_added') continue;
    const noteId = e.actionDetails['noteId'] as string;
    const visibility = e.actionDetails['visibility'] as 'internal' | 'customer';

    if (visibilityFilter && visibility !== visibilityFilter) continue;

    const retraction = retractions.get(noteId);
    notes.push({
      noteId,
      noteText: e.actionDetails['noteText'] as string,
      visibility,
      performedByRole: e.performedByRole,
      actionDateTime: e.actionDateTime.toISOString(),
      isRetracted: !!retraction,
      retractionReason: retraction ? (retraction.actionDetails['retractionReason'] as string | null) : null,
      retractionDateTime: retraction ? retraction.actionDateTime.toISOString() : null,
    });
  }
  return notes;
}
