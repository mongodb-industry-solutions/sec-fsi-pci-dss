import { Db } from 'mongodb';
import type { UserRole } from '../../../shared/models/identity.model';
import { getCaseById } from './fraudDiagnosis.service';
import { getTransactionById } from '../../transaction/services/cardTransaction.service';
import { CARD_TRANSACTION_COLLECTION } from '../../transaction/models/cardTransaction.model';
import { getByInstanceReference } from '../../customer/services/customerAgreement.service';
import { getMerchantById } from '../../gateway/services/merchant.service';
import { listProcessEvents } from '../../provider/services/businessProcessEvent.service';
import { PAYMENT_EXECUTION_COLLECTION } from '../../gateway/models/paymentExecution.model';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../gateway/models/payoutAccount.model';
import { PARTY_COLLECTION } from '../../identity/models/party.model';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';
import { PAYMENT_REQUEST_COLLECTION } from '../../gateway/models/paymentRequest.model';
import { COUNTERPARTY_COLLECTION, CounterpartyArrangement } from '../../identity/models/counterpartyArrangement.model';

const CUSTOMER_CREDIT_RATING_COLLECTION = 'customerCreditRatingState';

// Read-model (BFF) for the investigation case detail. Composes: at read time, over the
// event-driven core: a single, role-gated, consistently-redacted SUMMARY of the case:
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

// Counterparty of a non-card movement: the destination the investigator needs to judge the transfer.
// The PSP owns this data (a registered beneficiary or an RTP payee), so it is available to L1 as well.
// Minimisation (ADR-048): the label, the masked account, the country and the refs, never the full IBAN.
async function buildCounterparty(
  db: Db,
  exec: Record<string, unknown> | null,
  request: Record<string, unknown> | null,
  role: UserRole,
) {
  if (request) {
    const partyRef = request.requesterPartyReference as string | undefined;
    // paymentRequestProcedure.payeeName is QE:none and restricted to L2 / auditor: the read client
    // decrypts it, so it must be withheld here rather than merely not displayed.
    const canSeePayee = role === 'level2_investigator' || role === 'security_auditor';
    const party = await buildParty(db, partyRef, canSeePayee);
    return {
      kind: 'payee' as const,
      label: canSeePayee ? ((request.payeeName as string) ?? null) : null,
      labelRestricted: !canSeePayee,
      accountMasked: null,
      countryCode: null,
      partyReference: partyRef ?? null,
      arrangementReference: null,
      accountReference: (request.payeeReceivingAccountReference as string) ?? null,
      ownerParty: party,
      account: await buildAccountSummary(db, request.payeeReceivingAccountReference as string | undefined, canSeePayee),
    };
  }
  if (!exec) return null;

  const arrangementRef = exec.beneficiaryArrangementReference as string | undefined;
  const arrangement = arrangementRef
    ? await db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION)
        .findOne({ counterpartyArrangementReference: arrangementRef })
        .catch(() => null)
    : null;
  // The beneficiary record names the resolved party; fall back to the execution's own link.
  const partyRef = arrangement?.counterpartyPartyReference ?? (exec.beneficiaryPartyReference as string | undefined);

  return {
    kind: (arrangement ? 'beneficiary' : 'external_account') as 'beneficiary' | 'external_account',
    label: arrangement?.counterpartyLabel ?? (exec.beneficiaryName as string) ?? null,
    // Masked at store time (beneficiary hint) or masked at initiation (external account).
    accountMasked: arrangement?.counterpartyLookupHint ?? (exec.destinationAccountMasked as string) ?? null,
    countryCode: (exec.destinationCountry as string) ?? null,
    partyReference: partyRef ?? null,
    arrangementReference: arrangementRef ?? null,
    accountReference: (exec.resolvedPayoutAccountReference as string) ?? null,
    labelRestricted: false,
    lookupHint: arrangement?.counterpartyLookupHint ?? null,
    lookupType: arrangement?.counterpartyLookupType ?? null,
    status: arrangement?.counterpartyArrangementStatus ?? null,
    registeredAt: arrangement?.recordCreatedDateTime ?? null,
    // Who is behind the beneficiary, and which account received the money: the two questions an
    // investigator asks next. Plaintext identity + account metadata only (no IBAN, which is QE:none).
    ownerParty: await buildParty(db, partyRef),
    account: await buildAccountSummary(db, exec.resolvedPayoutAccountReference as string | undefined),
  };
}

// Party behind a reference, with the agreement id so the client can open the customer record
// (customers:view). partyName is plaintext by design; email/phone are QE and are NOT read here.
async function buildParty(db: Db, partyRef?: string, includeName = true) {
  if (!partyRef) return null;
  const party = await db.collection(PARTY_COLLECTION)
    .findOne({ partyInstanceReference: partyRef }, { projection: { _id: 0, partyInstanceReference: 1, partyName: 1, partyType: 1 } })
    .catch(() => null);
  if (!party) return null;
  const agreement = await db.collection(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ partyInstanceReference: partyRef }, { projection: { _id: 0, customerAgreementInstanceReference: 1 } })
    .catch(() => null);
  return {
    reference: partyRef,
    name: includeName ? ((party as { partyName?: string }).partyName ?? null) : null,
    type: (party as { partyType?: string }).partyType ?? null,
    customerAgreementInstanceReference: (agreement as { customerAgreementInstanceReference?: string } | null)?.customerAgreementInstanceReference ?? null,
  };
}

// Account metadata + balance: the balance is what shows an investigator that the money is held and
// not delivered. The IBAN / routing number are QE:none and deliberately not read on this surface.
async function buildAccountSummary(db: Db, accountRef?: string, includeHolder = true) {
  if (!accountRef) return null;
  const acct = await db.collection(PAYOUT_ACCOUNT_COLLECTION).findOne(
    { payoutAccountInstanceReference: accountRef },
    { projection: {
      _id: 0, payoutAccountInstanceReference: 1, payoutAccountAlias: 1, payoutAccountBankName: 1,
      payoutAccountHolderName: 1, payoutAccountCurrency: 1, payoutAccountCountryCode: 1,
      payoutAccountType: 1, payoutAccountStatus: 1, payoutAccountBalance: 1, partyInstanceReference: 1,
    } },
  ).catch(() => null);
  if (!acct) return null;
  const a = acct as Record<string, unknown>;
  const balance = (a.payoutAccountBalance ?? {}) as { availableAmount?: number; pendingAmount?: number };
  return {
    reference: accountRef,
    alias: (a.payoutAccountAlias as string) ?? null,
    bankName: (a.payoutAccountBankName as string) ?? null,
    holderName: includeHolder ? ((a.payoutAccountHolderName as string) ?? null) : null,
    currency: (a.payoutAccountCurrency as string) ?? null,
    countryCode: (a.payoutAccountCountryCode as string) ?? null,
    type: (a.payoutAccountType as string) ?? null,
    status: (a.payoutAccountStatus as string) ?? null,
    partyReference: (a.partyInstanceReference as string) ?? null,
    balance: { available: balance.availableAmount ?? null, pending: balance.pendingAmount ?? null },
  };
}

// Movement summary for a non-card case, shaped like the card `operation` block so the UI renders one
// panel for every kind. `heldForReview` tells the investigator the money is immobilised, not delivered.
function executionOperation(kind: string, exec: Record<string, unknown> | null, request: Record<string, unknown> | null) {
  if (request) {
    return {
      transactionId: request.paymentRequestInstanceReference as string,
      kind,
      type: 'request_to_pay',
      status: (request.status as string) ?? null,
      channel: 'rtp',
      amount: { amount: request.amount as number, currency: request.currency as string },
      dateTime: (request.recordCreatedDateTime as Date) ?? null,
      description: (request.purpose as string) ?? null,
      rail: null,
      heldForReview: (request.status as string) === 'accepted',
    };
  }
  if (!exec) return null;
  const log = (exec.resolutionLog as Array<{ stepName?: string }> | undefined) ?? [];
  return {
    transactionId: exec.paymentExecutionInstanceReference as string,
    kind,
    type: 'transfer',
    status: (exec.paymentExecutionStatus as string) ?? null,
    channel: 'transfer',
    amount: { amount: (exec.grossAmount ?? exec.netAmount) as number, currency: exec.currency as string },
    dateTime: (exec.initiatedAt as Date) ?? (exec.recordCreatedDateTime as Date) ?? null,
    description: (exec.paymentExecutionRemittanceInformation as string) ?? (exec.routingNote as string) ?? null,
    rail: (exec.paymentExecutionRail as string) ?? null,
    heldForReview: exec.paymentExecutionStatus === 'pending' && log.some((s) => s.stepName === 'risk.hold'),
  };
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
  // Movement discriminator: absent means a legacy card case.
  const transactionKind = fraudCase.transactionKind ?? 'card';

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

  const cardOperation = txn ? {
    transactionId: txn.cardTransactionInstanceReference,
    kind: 'card',
    type: txn.cardTransactionType ?? 'purchase',
    status: txn.cardTransactionStatus,
    channel: txn.cardTransactionChannel ?? null,
    merchantCategoryCode: txn.cardTransactionMerchantCategoryCode ?? null,
    merchantName: txn.cardTransactionMerchantName,
    maskedPan: txn.cardTransactionMaskedPanDisplay,
    amount: txn.cardTransactionAmount,
    dateTime: txn.cardTransactionDateTime,
    description: txn.cardTransactionDescription ?? null,
    heldForReview: txn.cardTransactionStatus === 'authorized',
  } : null;

  // ── Non-card movement (P2P / bank transfer / RTP): resolve the execution or the request ────
  // The discriminator is authoritative when present. It is absent on cases opened before ADR-062 (and
  // on any legacy doc), so when no card transaction resolves we probe both movement collections with
  // the shared reference: an unstamped case must still render as the movement it actually is.
  const execRef = fraudCase.paymentExecutionInstanceReference
    ?? (!cardOperation && transactionKind !== 'rtp' ? txnId : undefined);
  const requestRef = fraudCase.paymentRequestInstanceReference
    ?? (!cardOperation ? txnId : undefined);
  const execution = !cardOperation && execRef
    ? await db.collection(PAYMENT_EXECUTION_COLLECTION).findOne({ paymentExecutionInstanceReference: execRef }).catch(() => null)
    : null;
  const request = !cardOperation && !execution && requestRef
    ? await db.collection(PAYMENT_REQUEST_COLLECTION).findOne({ paymentRequestInstanceReference: requestRef }).catch(() => null)
    : null;

  // Effective kind: the stamped value, or inferred from whichever record answered. A registered
  // beneficiary arrangement makes it a P2P transfer; an unregistered destination a bank transfer.
  const resolvedKind = transactionKind !== 'card'
    ? transactionKind
    : execution
      ? ((execution as { beneficiaryArrangementReference?: string }).beneficiaryArrangementReference ? 'p2p' : 'bank_transfer')
      : request ? 'rtp' : 'card';

  const operation = cardOperation ?? executionOperation(resolvedKind, execution, request);
  const counterparty = cardOperation ? null : await buildCounterparty(db, execution, request, role).catch(() => null);
  // Payer side of a non-card movement: the account the funds are held on.
  const sourceAccount = cardOperation ? null : await buildAccountSummary(
    db,
    (execution as { sourcePayoutAccountReference?: string } | null)?.sourcePayoutAccountReference
      ?? (request as { payerFundingAccountReference?: string } | null)?.payerFundingAccountReference,
  ).catch(() => null);

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
    // Contact PII (QE:equality), present only for L2/auditor (redacted server-side for L1).
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
    transactionKind: resolvedKind,
    operation,
    // Set for a non-card movement; the client renders it in place of the merchant/KYB panel.
    counterparty,
    sourceAccount,
    sdf,
    hrp,
    kyc,
    kyb,
    references: {
      caseId, transactionId: txnId ?? null, customerId: customerId ?? null,
      merchantId: merchantId ?? null, accountRef: accountRef ?? null,
      executionRef: (execution as { paymentExecutionInstanceReference?: string } | null)?.paymentExecutionInstanceReference ?? null,
      paymentRequestRef: (request as { paymentRequestInstanceReference?: string } | null)?.paymentRequestInstanceReference ?? null,
    },
  };
}
