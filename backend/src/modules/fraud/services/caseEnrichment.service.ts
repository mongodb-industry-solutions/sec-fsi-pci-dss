import { Db } from 'mongodb';
import type { UserRole } from '../../../shared/models/identity.model';
import { getCaseById } from './fraudDiagnosis.service';
import { getTransactionById } from '../../transaction/services/cardTransaction.service';
import { CARD_TRANSACTION_COLLECTION } from '../../transaction/models/cardTransaction.model';
import { getByInstanceReference } from '../../customer/services/customerAgreement.service';
import { getMerchantById } from '../../gateway/services/merchant.service';
import { listProcessEvents } from '../../provider/services/businessProcessEvent.service';

const CUSTOMER_CREDIT_RATING_COLLECTION = 'customerCreditRatingState';

// Read-model (BFF) for the investigation case detail. Composes — at read time, over the
// event-driven core — a single, role-gated, consistently-redacted SUMMARY of the case:
// operation, SDF (score + indicators + fraud_evaluation event history), HRP flags, KYC and
// KYB summaries. Sensitive PII (QE:none) is NOT duplicated here: it is returned only when a
// valid escalation token already unlocked it via the existing role-aware services; otherwise
// only a `sensitiveUnlocked: false` flag is exposed and the client fetches detail on demand
// from the existing escalation-gated endpoints. Eventual consistency: `asOf` marks read time
// and fields not yet delivered by an event are reported as pending.

const HRP_RISK_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };

async function buildHrp(db: Db, accountRef: string | undefined) {
  if (!accountRef) return { available: false as const };
  const profile = await db.collection(CUSTOMER_CREDIT_RATING_COLLECTION)
    .findOne({ customerAgreementReference: accountRef });
  const rawFlags: Record<string, unknown>[] =
    (profile?.customerCreditRatingClassificationFlags as Record<string, unknown>[]) ?? [];
  const flags = rawFlags.map((f) => ({
    category: f.customerCreditRatingClassificationCategory,
    riskLevel: f.customerCreditRatingClassificationLevel,
    label: f.customerCreditRatingClassificationLabel,
    description: f.customerCreditRatingClassificationDescription,
    detectedAt: f.customerCreditRatingClassificationDetectedDateTime,
    source: f.customerCreditRatingClassificationSource,
    reviewRequired: f.customerCreditRatingReviewRequiredIndicator,
  }));
  const highestRiskLevel = flags.reduce<'none' | 'low' | 'medium' | 'high'>((acc, f) => {
    const lvl = (f.riskLevel as string) ?? 'none';
    return (HRP_RISK_ORDER[lvl] ?? 0) > HRP_RISK_ORDER[acc] ? (lvl as 'low' | 'medium' | 'high') : acc;
  }, 'none');
  return { available: true as const, match: flags.length > 0, highestRiskLevel, flags };
}

export async function getCaseEnrichment(
  db: Db,
  caseId: string,
  role: UserRole,
  escalationToken?: string,
  actor?: { ref?: string; name?: string }
): Promise<Record<string, unknown> | null> {
  const fraudCase = await getCaseById(db, caseId);
  if (!fraudCase) return null;

  const txnId = fraudCase.cardTransactionInstanceReference;
  const customerId = fraudCase.customerAgreementInstanceReference;

  // ── Operation (from the card transaction; non-sensitive view) ──────────────
  const txn = txnId
    ? await getTransactionById(db, txnId, role as never, escalationToken).catch(() => null)
    : null;
  // merchantAgreementInstanceReference is plaintext on the txn but not returned by the
  // role-aware getter; read it directly (no decryption needed) for the KYB link.
  const txnLink = txnId
    ? await db.collection(CARD_TRANSACTION_COLLECTION).findOne(
        { cardTransactionInstanceReference: txnId },
        { projection: { _id: 0, merchantAgreementInstanceReference: 1 } },
      ).catch(() => null)
    : null;
  const merchantId = (txnLink as { merchantAgreementInstanceReference?: string } | null)?.merchantAgreementInstanceReference;

  const operation = txn ? {
    transactionId: txn.cardTransactionInstanceReference,
    type: txn.cardTransactionType ?? 'purchase',
    status: txn.cardTransactionStatus,
    channel: txn.cardTransactionChannel ?? null,
    merchantCategoryCode: txn.cardTransactionMerchantCategoryCode ?? null,
    merchantName: txn.cardTransactionMerchantName,
    maskedPan: txn.cardTransactionMaskedPanDisplay,
    amount: txn.cardTransactionAmount,
    dateTime: txn.cardTransactionDateTime,
    description: txn.cardTransactionDescription ?? null,
  } : null;

  // ── SDF: score + indicators + fraud_evaluation event history ───────────────
  const assessment = fraudCase.fraudDiagnosisAssessment ?? { riskIndicators: [], fraudDiagnosisScore: undefined };
  const sdfEventsRes = await listProcessEvents(db, {
    entityType: 'fraud_case', entityId: caseId, processType: 'fraud_evaluation', limit: 50,
  }).catch(() => ({ events: [], total: 0 }));
  const sdf = {
    score: assessment.fraudDiagnosisScore ?? null,
    scorePending: assessment.fraudDiagnosisScore === undefined || assessment.fraudDiagnosisScore === null,
    indicators: assessment.riskIndicators ?? [],
    conclusion: (assessment as { fraudDiagnosisConclusion?: string }).fraudDiagnosisConclusion ?? null,
    events: (sdfEventsRes.events as Array<Record<string, unknown>>).map((e) => ({
      dateTime: e.eventDateTime, action: e.processAction, outcome: e.processOutcome, summary: e.eventSummary,
    })),
  };

  // ── KYC summary (+ sensitive only if the role/token already unlocked it) ───
  const customer = customerId
    ? await getByInstanceReference(db, customerId, role, escalationToken, actor).catch(() => null)
    : null;
  const accountRef = customer?.customerAgreementReference as string | undefined;
  const kyc = customer ? {
    customerId,
    name: customer.customerName ?? null,
    segment: customer.customerSegment ?? null,
    status: customer.customerAgreementStatus ?? null,
    enrollmentDate: customer.customerAgreementEnrollmentDate ?? null,
    kycCheck: customer.customerAgreementKycCheck ?? null,
    accountRef: accountRef ?? null,
    // Contact PII (QE:equality) — present only for L2/auditor (redacted server-side for L1).
    email: (customer.customerEmailAddress as string | undefined) ?? null,
    phone: (customer.customerMobilePhoneNumber as string | undefined) ?? null,
    contactRestricted: customer.contactPiiRestricted === true,
    sensitiveUnlocked: !!customer.sensitive,
    sensitive: customer.sensitive ?? null,
  } : null;

  // ── HRP flags (keyed by the customer's account reference) ──────────────────
  const hrp = await buildHrp(db, accountRef).catch(() => ({ available: false as const }));

  // ── KYB summary (merchant; non-sensitive business data) ────────────────────
  const merchant = merchantId ? await getMerchantById(db, merchantId).catch(() => null) : null;
  const kyb = merchant ? {
    merchantId: merchant.merchantAgreementInstanceReference,
    name: merchant.merchantName,
    status: merchant.merchantAgreementStatus,
    kybCheck: merchant.merchantAgreementKybCheck ?? null,
    riskCategory: merchant.merchantRiskCategory ?? null,
    tier: merchant.merchantTier ?? null,
    countryCode: merchant.merchantCountryCode ?? null,
    categoryCode: merchant.merchantCategoryCode ?? null,
  } : null;

  return {
    caseId,
    asOf: new Date().toISOString(),
    operation,
    sdf,
    hrp,
    kyc,
    kyb,
    references: { caseId, transactionId: txnId ?? null, customerId: customerId ?? null, merchantId: merchantId ?? null, accountRef: accountRef ?? null },
  };
}
