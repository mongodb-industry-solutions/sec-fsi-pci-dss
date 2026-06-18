import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CARD_TRANSACTION_COLLECTION,
  CardTransactionLogControlRecord,
} from '../models/cardTransaction.model';
import { getDbForRole } from '../../../vendors/encryption/roleClients';
import { canReadSensitive } from '../../../vendors/middleware/rbac';
import { createFraudCase } from '../../fraud/services/fraudDiagnosis.service';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';
import { PARTY_COLLECTION, PartyControlRecord } from '../../identity/models/party.model';
import { emitProcessEvent, emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { getChdCrypto } from '../../../vendors/encryption/chdCrypto';
import { getCardByToken, upsertCardByToken } from '../../customer/services/paymentCard.service';
import { sendMerchantPaymentCallback } from '../../gateway/services/merchantCallback.service';
import { getEventBus, makeEvent } from '../../../vendors/eventbus';

export interface CreateTransactionInput {
  cardToken: string;
  accountReference: string;
  amount: number;
  currency: string;
  cardTransactionMerchantName: string;
  cardTransactionMerchantCategoryCode: string;
  cardTransactionChannel: string;
  cardTransactionMaskedPanDisplay: string;
  cardTransactionType: string;
  cardTransactionDescription: string;
  cardTransactionNarrative?: string;
  // Acquiring-side link (SD-89): the merchant this payment was made to. Optional.
  merchantAgreementInstanceReference?: string;
  // Card-on-file auto-registration (SD-88): present for a NEW card so the PSP can save it to the
  // payer's wallet after a successful payment. Omitted when paying with an already-saved card.
  paymentCardExpirationDate?: string;
  paymentCardNetwork?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
  gatewayPayload: object;
  // Transient card verification values forwarded to the card issuer for authorization ONLY, as a real
  // authorization request would carry. NEVER persisted on the transaction and stripped from every
  // audit log (PCI DSS Req 3.2 / Req 10.7). Used in-memory for the issuer decision, then discarded.
  cardVerification?: { cardNumber?: string; cvv?: string; expiry?: string };
  // P13.1 (D1): set by CVV-bearing channels (interactive checkout / payment-link / simulator). When
  // true and no CVV reached the issuer, the issuer declines (a CVV was expected but missing). Left
  // unset for card-on-file / recurring tokenized payments, which legitimately carry no CVV.
  requireCardVerification?: boolean;
}

// Thrown when a payment is attempted with a card-on-file the customer has deactivated (suspended)
// or removed (revoked). The PSP rejects it regardless of the issuer's decision (BIAN SD-15).
export class CardNotActiveError extends Error {
  constructor(public readonly status: string) {
    super(`Card is ${status}: the PSP declined this operation`);
    this.name = 'CardNotActiveError';
  }
}

// The card issuer (internal module or an external issuer integration) declined the card after
// analysis. The issuer is AUTHORITATIVE: when it declines, the PSP does not authorize the payment.
// This is the security gate that an external issuer would enforce in a real deployment (BIAN SD-15 /
// SD-88). Carries the issuer's response code + reason for the audit and the customer-facing message.
export class CardIssuerDeclinedError extends Error {
  constructor(public readonly responseCode: string, public readonly reason: string) {
    super(`Card issuer declined the card (${responseCode}): ${reason}`);
    this.name = 'CardIssuerDeclinedError';
  }
}

function shouldCreateFraudCase(amount: number, mcc: string): { create: boolean; reasons: string[] } {
  const threshold = parseInt(process.env.FRAUD_AMOUNT_THRESHOLD ?? '500', 10);
  const riskMccList = (process.env.RISK_MCC_LIST ?? '5812,6011,7995').split(',').map((m) => m.trim());
  const reasons: string[] = [];
  if (amount > threshold) reasons.push('amount_threshold');
  if (riskMccList.includes(mcc)) reasons.push('high_risk_mcc');
  return { create: reasons.length > 0, reasons };
}

function deriveSeverity(amount: number, riskIndicators: string[]): 'low' | 'medium' | 'high' | 'critical' {
  if (amount > 1000 || riskIndicators.length >= 2) return 'critical';
  if (amount > 500) return 'high';
  if (amount > 200) return 'medium';
  return 'low';
}

// P13.3 (D2): when the FDS verdict drives the case, map the FDS riskScore (0–100) to the case severity
// so the case is congruent with the gate verdict (no more disconnected riskIndicators.length*40).
function deriveSeverityFromScore(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Resolve a customer's agreement from an account reference that may be either an
 * email (QE:equality on party) or a business key (customerAgreementReference).
 * Returns both the agreement UUID (for fraud-case linkage) and the canonical
 * account reference (ACC-xxx) used to normalize cardTransactionAccountReference.
 */
export async function resolveCustomerAgreement(db: Db, accountReference: string): Promise<{ uuid?: string; reference?: string }> {
  try {
    const l1Db = await getDbForRole('level1_analyst', false);
    let agreement: { customerAgreementInstanceReference?: string; customerAgreementReference?: string } | null = null;
    if (accountReference.includes('@')) {
      const party = await db
        .collection<PartyControlRecord>(PARTY_COLLECTION)
        .findOne({ partyEmailAddress: accountReference } as Partial<PartyControlRecord>);
      if (party?.partyInstanceReference) {
        agreement = await l1Db
          .collection<{ customerAgreementInstanceReference: string; customerAgreementReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
          .findOne({ partyInstanceReference: party.partyInstanceReference } as Record<string, unknown>);
      }
    } else {
      agreement = await l1Db
        .collection<{ customerAgreementInstanceReference: string; customerAgreementReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
        .findOne({ customerAgreementReference: accountReference } as Record<string, unknown>);
    }
    return { uuid: agreement?.customerAgreementInstanceReference, reference: agreement?.customerAgreementReference };
  } catch {
    return {};
  }
}

// Outcome of an authorization journey (resolved when the saga reaches a terminal payment event).
export interface AuthorizationOutcome {
  cardTransactionInstanceReference: string;
  cardTransactionStatus: 'authorized' | 'declined';
  fraudCaseCreated: boolean;
  fraudDiagnosisInstanceReference?: string;
  declineReason?: string;
  declineCode?: string;
}

// Non-CHD context needed to finish an authorized payment, kept transiently between initiate and the
// event-driven completion (in-process; a broker deployment would carry this in the saga state).
interface PendingContext {
  input: CreateTransactionInput; // cardVerification stripped before storing
  canonicalAccountRef: string;
  resolvedUuid?: string;
}

// The FDS verdict the saga aggregates from fds.scoring.completed and hands to completeAuthorized, so
// the fraud case is congruent with the gate result (score/severity/indicators come from the verdict).
export interface FdsVerdict { riskScore: number; recommendation: 'approve' | 'review' | 'decline'; fraudFlag: boolean; rulesFired: string[] }
const pendingContext = new Map<string, PendingContext>();

// EDA entry point (dev.v8 F3). Creates the transaction PENDING and drives authorization through the
// event bus: it publishes `card.payment.authorization.requested`, runs the issuer check out-of-band
// (CHD goes straight to the issuer, never on the bus) and emits `card.issuer.validation.completed`.
// The PaymentAuthorizationSaga reacts and reaches the single `card.payment.authorization.completed`
// (outcome in payload). Returns the txn id immediately + a `settled` promise (server-side callers
// await it; the API can return pending and let the client wait via SSE on the same closing event).
export async function initiateTransaction(
  db: Db,
  input: CreateTransactionInput,
): Promise<{ cardTransactionInstanceReference: string; cardTransactionStatus: 'pending'; settled: Promise<AuthorizationOutcome> }> {
  const txnId = uuidv4();
  const now = new Date();
  const txWriteDb = await getDbForRole('security_auditor', false);

  // PSP-level control (BIAN SD-15): a deactivated/removed card-on-file is rejected up front,
  // regardless of the issuer (new/unsaved tokens pass through).
  const onFile = await getCardByToken(db, input.cardToken);
  if (onFile && onFile.paymentCardStatus !== 'active') {
    throw new CardNotActiveError(onFile.paymentCardStatus);
  }

  const resolved = await resolveCustomerAgreement(db, input.accountReference);
  const canonicalAccountRef = resolved.reference ?? input.accountReference;

  const txn: CardTransactionLogControlRecord = {
    cardTransactionInstanceReference: txnId,
    paymentCardReference: input.cardToken,
    cardTransactionAccountReference: canonicalAccountRef,
    rawGatewayPayload: input.gatewayPayload,
    processorTransactionMetadata: { processedAt: now.toISOString() },
    cardTransactionAmount: { amount: input.amount, currency: input.currency },
    cardTransactionDateTime: now,
    cardTransactionStatus: 'pending',
    cardTransactionType: input.cardTransactionType as CardTransactionLogControlRecord['cardTransactionType'],
    cardTransactionChannel: input.cardTransactionChannel as CardTransactionLogControlRecord['cardTransactionChannel'],
    cardTransactionInitiationType: 'customerInitiated',
    cardTransactionMerchantCategoryCode: input.cardTransactionMerchantCategoryCode,
    cardTransactionMerchantName: input.cardTransactionMerchantName,
    cardTransactionMaskedPanDisplay: input.cardTransactionMaskedPanDisplay,
    ...(input.merchantAgreementInstanceReference && { merchantAgreementInstanceReference: input.merchantAgreementInstanceReference }),
    cardTransactionDescription: input.cardTransactionDescription,
    ...(input.cardTransactionNarrative && { cardTransactionNarrative: input.cardTransactionNarrative }),
    bianServiceDomain: 'Card Transaction',
    bianControlRecordType: 'CardTransactionLog',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 3,
  };
  await txWriteDb.collection(CARD_TRANSACTION_COLLECTION).insertOne(txn as object);

  // Stash the non-CHD context the completion step needs (strip the verification values).
  const safeInput: CreateTransactionInput = { ...input, cardVerification: undefined };
  pendingContext.set(txnId, { input: safeInput, canonicalAccountRef, resolvedUuid: resolved.uuid });

  const bus = getEventBus();
  // The process opening event (§5.1). Its eventId is the causation parent of every Phase-1 gate
  // *.requested (§5.0 causation chain).
  const requestedEvent = makeEvent({
    eventType: 'card.payment.authorization.requested',
    correlationId: txnId,
    businessProcess: 'card_payment',
    source: 'psp.core',
    // Phase-1 gates the saga must aggregate before authorizing (dev.v8 F4).
    payload: { amount: input.amount, currency: input.currency, merchantName: input.cardTransactionMerchantName, maskedPan: input.cardTransactionMaskedPanDisplay, channel: input.cardTransactionChannel, gatesExpected: ['card.issuer', 'fds', 'hrp'] },
    bian: { serviceDomain: 'SD-254 Card Transaction', controlRecord: 'CardTransactionRecord' },
  });
  void bus.publish(requestedEvent);
  const gateCausationId = requestedEvent.eventId;

  // Resolves when the saga reaches the single closing event for this journey; outcome lives in the
  // payload (§6.1), not in the event name.
  const settled = new Promise<AuthorizationOutcome>((resolve) => {
    const sub = bus.subscribe('card.payment.authorization.completed', (e) => {
      sub.unsubscribe();
      const p = e.payload as { outcome?: 'authorized' | 'declined'; fraudCaseCreated?: boolean; fraudDiagnosisInstanceReference?: string; decisionReason?: string; responseCode?: string };
      resolve({
        cardTransactionInstanceReference: txnId,
        cardTransactionStatus: p.outcome === 'declined' ? 'declined' : 'authorized',
        fraudCaseCreated: !!p.fraudCaseCreated,
        fraudDiagnosisInstanceReference: p.fraudDiagnosisInstanceReference,
        declineReason: p.decisionReason,
        declineCode: p.responseCode,
      });
    }, { correlationId: txnId });
  });

  // Phase-1 gates run out-of-band: the orchestrator only PUBLISHES each gate's *.requested. The
  // Provider Group reactors perform the actual provider call and publish the matching *.completed;
  // the saga aggregates the verdicts. Card data rides only the encrypted `chd` carrier on the issuer
  // request — plaintext never touches the bus.
  void emitGateRequests(txnId, input, gateCausationId, onFile?.paymentCardNetwork);

  return { cardTransactionInstanceReference: txnId, cardTransactionStatus: 'pending', settled };
}

// Publish the three Phase-1 gate requests for a journey. The orchestrator only emits requests; the
// Provider Group reactors perform the provider calls and publish the completions. Card verification
// values are encrypted into the opaque `chd` carrier here, so plaintext never touches the bus.
const CHD_AAD_EVENT = 'card.issuer.validation.requested';
async function emitGateRequests(txnId: string, input: CreateTransactionInput, causationParent: string, onFileNetwork?: string): Promise<void> {
  const bus = getEventBus();
  const issuerNetwork = input.paymentCardNetwork ?? onFileNetwork;
  const cv = input.cardVerification;

  let chd: string | undefined;
  if (cv?.cvv || cv?.cardNumber) {
    try {
      chd = await getChdCrypto().encrypt(
        { ...(cv.cardNumber ? { cardNumber: cv.cardNumber } : {}), cvv: cv.cvv ?? '', ...(cv.expiry ? { expiry: cv.expiry } : {}) },
        { correlationId: txnId, eventType: CHD_AAD_EVENT },
      );
    } catch { /* crypto unavailable (no master key) — proceed reference-led, no CHD on the wire */ }
  }

  void bus.publish(makeEvent({
    eventType: 'card.issuer.validation.requested', correlationId: txnId, businessProcess: 'card_payment', source: 'psp.core', causationId: causationParent,
    payload: { cardToken: input.cardToken, maskedPan: input.cardTransactionMaskedPanDisplay, amount: input.amount, currency: input.currency, ...(issuerNetwork ? { cardNetwork: issuerNetwork } : {}), ...(chd ? { chd } : {}), ...(input.requireCardVerification ? { cvvExpected: true } : {}) },
    bian: { serviceDomain: 'SD-88 Payment Card', controlRecord: 'PaymentCardValidation' },
  }));
  void bus.publish(makeEvent({
    eventType: 'fds.scoring.requested', correlationId: txnId, businessProcess: 'card_payment', source: 'psp.core', causationId: causationParent,
    payload: { accountReference: input.accountReference, cardToken: input.cardToken, amount: input.amount, currency: input.currency, channel: input.cardTransactionChannel, merchantName: input.cardTransactionMerchantName, merchantCategoryCode: input.cardTransactionMerchantCategoryCode },
    bian: { serviceDomain: 'SD-63 Fraud Evaluation', controlRecord: 'FraudEvaluationAssessment' },
  }));
  void bus.publish(makeEvent({
    eventType: 'hrp.screening.requested', correlationId: txnId, businessProcess: 'card_payment', source: 'psp.core', causationId: causationParent,
    payload: { subjectPartyReference: input.accountReference, accountReference: input.accountReference, amount: input.amount, currency: input.currency, merchantName: input.cardTransactionMerchantName },
    bian: { serviceDomain: 'SD-13 Party Reference', controlRecord: 'PartyReferenceDataDirectoryEntry' },
  }));
}

// Emit the issuer outcome onto the bus. Also called by the inbound callback for a real async issuer
// (processCardIssuerCallback), so internal and external issuers funnel into the same event.
// `causationId` links it to its card.issuer.validation.requested (§5.0 causation chain).
export function publishIssuerValidationCompleted(txnId: string, decision: { approved: boolean; responseCode?: string; decisionReason?: string }, causationId?: string): void {
  void getEventBus().publish(makeEvent({
    eventType: 'card.issuer.validation.completed',
    correlationId: txnId,
    businessProcess: 'card_payment',
    source: 'callback.card-issuer',
    causationId,
    payload: { transactionId: txnId, outcome: decision.approved ? 'approved' : 'declined', ...decision },
    bian: { serviceDomain: 'SD-88 Payment Card', controlRecord: 'PaymentCardValidation' },
  }));
}

// Finish an APPROVED payment: card-on-file, fraud case, audit event, merchant callback, status flip.
// Idempotent on the pending context (a second call is a no-op). Returns the fraud-case outcome.
export async function completeAuthorized(db: Db, txnId: string, fdsVerdict?: FdsVerdict): Promise<{ fraudCaseCreated: boolean; fraudDiagnosisInstanceReference?: string }> {
  const ctx = pendingContext.get(txnId);
  if (!ctx) return { fraudCaseCreated: false };
  pendingContext.delete(txnId);
  const { input, canonicalAccountRef, resolvedUuid } = ctx;
  const now = new Date();
  const txWriteDb = await getDbForRole('security_auditor', false);

  await txWriteDb.collection(CARD_TRANSACTION_COLLECTION).updateOne(
    { cardTransactionInstanceReference: txnId },
    { $set: { cardTransactionStatus: 'authorized', recordUpdatedDateTime: now } },
  );

  // Card-on-file auto-registration (SD-88): using a card to pay IS the registration. Idempotent.
  if (resolvedUuid) {
    try {
      const upsert = await upsertCardByToken(db, {
        customerAgreementInstanceReference: resolvedUuid,
        cardToken: input.cardToken,
        paymentCardMaskedPanDisplay: input.cardTransactionMaskedPanDisplay,
        paymentCardIsPreferred: false,
        ...(input.paymentCardExpirationDate ? { paymentCardExpirationDate: input.paymentCardExpirationDate } : {}),
        ...(input.paymentCardNetwork ? { paymentCardNetwork: input.paymentCardNetwork } : {}),
      });
      emitComplianceEvent(db, {
        entityType: 'card', entityId: upsert.paymentCardInstanceReference, processType: 'card_management',
        processAction: upsert.created ? 'card.registered' : 'card.matched', processOutcome: 'approved',
        performedByPartyReference: null, performedByRole: null,
        eventSummary: { via: 'payment', created: upsert.created, cardToken: input.cardToken, maskedPan: input.cardTransactionMaskedPanDisplay, customerAgreementInstanceReference: resolvedUuid, cardTransactionInstanceReference: txnId },
        bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
      });
    } catch { /* never block on card-on-file save */ }
  }

  // The FDS verdict (handed in by the saga) drives the fraud case when present — the case
  // score/severity/indicators are the FDS verdict, so the case is congruent with the
  // fds.scoring.completed gate result. When no verdict is available (FDS unreachable / fail-open),
  // fall back to the PSP amount+MCC rule, which shares the FDS amount threshold (FRAUD_AMOUNT_THRESHOLD).
  const fds = fdsVerdict;
  let create: boolean;
  let reasons: string[];
  let severity: 'low' | 'medium' | 'high' | 'critical';
  let score: number | undefined;
  if (fds) {
    create = fds.recommendation !== 'approve' || fds.fraudFlag;
    reasons = fds.rulesFired.length ? fds.rulesFired : create ? ['fds_flagged'] : [];
    severity = deriveSeverityFromScore(fds.riskScore);
    score = fds.riskScore;
  } else {
    const fallback = shouldCreateFraudCase(input.amount, input.cardTransactionMerchantCategoryCode);
    create = fallback.create;
    reasons = fallback.reasons;
    severity = deriveSeverity(input.amount, reasons);
  }
  let fraudCaseRef: string | undefined;
  if (create) {
    const snapshot = {
      cardTransactionAmount: { amount: input.amount, currency: input.currency },
      cardTransactionMerchantName: input.cardTransactionMerchantName,
      cardTransactionDateTime: now,
      cardTransactionStatus: 'authorized' as const,
      cardTransactionMaskedPanDisplay: input.cardTransactionMaskedPanDisplay,
    };
    const fraudCase = await createFraudCase(db, txnId, resolvedUuid ?? input.accountReference, reasons, severity, snapshot, score);
    fraudCaseRef = fraudCase.fraudDiagnosisInstanceReference;
  }

  emitProcessEvent(db, {
    entityType: 'transaction', entityId: txnId, processType: 'payment_processing',
    processAction: 'transaction.authorized', processOutcome: 'approved',
    performedByPartyReference: null, performedByRole: null,
    eventSummary: {
      amount: input.amount, currency: input.currency, channel: input.cardTransactionChannel,
      merchantName: input.cardTransactionMerchantName, fraudCaseCreated: create,
      cardTransactionInstanceReference: txnId, cardToken: input.cardToken,
      ...(input.merchantAgreementInstanceReference ? { merchantAgreementInstanceReference: input.merchantAgreementInstanceReference } : {}),
      accountReference: canonicalAccountRef,
      ...(resolvedUuid ? { customerAgreementInstanceReference: resolvedUuid } : {}),
      ...(fraudCaseRef ? { fraudDiagnosisInstanceReference: fraudCaseRef } : {}),
    },
    bianServiceDomain: 'Card Transaction', bianControlRecordType: 'CardTransactionRecord', processMeta: { ruleIds: reasons },
  });

  if (input.merchantAgreementInstanceReference) {
    try {
      await sendMerchantPaymentCallback(db, {
        merchantAgreementInstanceReference: input.merchantAgreementInstanceReference,
        amount: input.amount, currency: input.currency,
        merchantReference: ((input.gatewayPayload as { merchantReference?: string; paymentReference?: string } | undefined)?.merchantReference)
          ?? ((input.gatewayPayload as { paymentReference?: string } | undefined)?.paymentReference) ?? txnId,
        contextRef: txnId, contextType: 'transaction', triggeredBy: 'payment.callback', result: 'approved',
        cardToken: input.cardToken, maskedPan: input.cardTransactionMaskedPanDisplay, responseCode: '0000', cardTransactionInstanceReference: txnId,
      });
    } catch { /* callback never blocks the outcome */ }
  }

  return { fraudCaseCreated: create, fraudDiagnosisInstanceReference: fraudCaseRef };
}

// Finish a DECLINED payment: flip status, drop the pending context, audit the decline.
export async function declineTransaction(db: Db, txnId: string, reason: string, code: string): Promise<void> {
  pendingContext.delete(txnId);
  const txWriteDb = await getDbForRole('security_auditor', false);
  await txWriteDb.collection(CARD_TRANSACTION_COLLECTION).updateOne(
    { cardTransactionInstanceReference: txnId },
    { $set: { cardTransactionStatus: 'declined', recordUpdatedDateTime: new Date() } },
  );
  emitProcessEvent(db, {
    entityType: 'transaction', entityId: txnId, processType: 'payment_processing',
    processAction: 'transaction.declined', processOutcome: 'rejected',
    performedByPartyReference: null, performedByRole: null,
    eventSummary: { cardTransactionInstanceReference: txnId, decisionReason: reason, responseCode: code },
    bianServiceDomain: 'Card Transaction', bianControlRecordType: 'CardTransactionRecord',
  });
}

// Backward-compatible synchronous entry point: drives the EDA flow and resolves to the final outcome,
// preserving the previous behavior (returns the authorized result, or throws on an issuer decline).
// Used by the gateway (checkout / payment-link) and the current API path; the client async + SSE flow
// uses initiateTransaction directly.
export async function createTransaction(db: Db, input: CreateTransactionInput) {
  const { settled } = await initiateTransaction(db, input);
  const o = await settled;
  if (o.cardTransactionStatus === 'declined') {
    throw new CardIssuerDeclinedError(o.declineCode ?? 'declined', o.declineReason ?? 'card_issuer_declined');
  }
  return {
    cardTransactionInstanceReference: o.cardTransactionInstanceReference,
    cardTransactionStatus: 'authorized' as const,
    fraudCaseCreated: o.fraudCaseCreated,
    ...(o.fraudDiagnosisInstanceReference && { fraudDiagnosisInstanceReference: o.fraudDiagnosisInstanceReference }),
  };
}

export async function getTransactionById(
  db: Db,
  id: string,
  role: 'level1_analyst' | 'level2_investigator' | 'security_auditor' | 'customer' | 'merchant_officer' = 'level1_analyst',
  escalationToken?: string
) {
  // v2: use role-aware QE client. L2 auto-decrypts sensitive fields; L1 returns Binary.
  const { validateToken } = await import('../../../vendors/security/escalationTokens');
  const hasValidToken = validateToken(escalationToken).valid;
  const roleDb = await getDbForRole(role, hasValidToken);

  const txn = await roleDb.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .findOne({ cardTransactionInstanceReference: id } as Partial<CardTransactionLogControlRecord>);
  if (!txn) return null;

  // Fail-closed authorization: sensitive QE:none fields are exposed only to roles explicitly
  // allowed (auditor, or L2 with a valid escalation token) — never merely because the bytes
  // came back as a plain object. Protects even if the demo DB stores them in plaintext.
  const canSee = canReadSensitive(role, hasValidToken);
  const raw = txn.rawGatewayPayload as unknown;
  const gatewayDecrypted =
    canSee &&
    raw !== undefined && raw !== null &&
    typeof raw === 'object' &&
    !('sub_type' in (raw as object) && 'buffer' in (raw as object));

  return {
    cardTransactionInstanceReference:    txn.cardTransactionInstanceReference,
    cardTransactionAmount:               txn.cardTransactionAmount,
    cardTransactionDateTime:             txn.cardTransactionDateTime,
    cardTransactionStatus:               txn.cardTransactionStatus,
    cardTransactionType:                 txn.cardTransactionType,
    cardTransactionMerchantName:         txn.cardTransactionMerchantName,
    cardTransactionMerchantCategoryCode: txn.cardTransactionMerchantCategoryCode,
    cardTransactionMaskedPanDisplay:     txn.cardTransactionMaskedPanDisplay,
    cardTransactionChannel:              txn.cardTransactionChannel,
    cardTransactionInitiationType:       txn.cardTransactionInitiationType,
    cardTransactionDescription:          txn.cardTransactionDescription,
    cardTransactionNarrative:            txn.cardTransactionNarrative,
    paymentCardReference:                txn.paymentCardReference,
    cardTransactionAccountReference:     txn.cardTransactionAccountReference,
    // Plaintext FK to the payee merchant (no PII) — lets the investigation UI link to KYB.
    merchantAgreementInstanceReference:  txn.merchantAgreementInstanceReference,
    ...(gatewayDecrypted && {
      sensitive: {
        rawGatewayPayload:            txn.rawGatewayPayload,
        processorTransactionMetadata: txn.processorTransactionMetadata,
      },
    }),
  };
}

/** Returns unique merchant name + MCC pairs from seeded transactions, sorted by name. */
export async function getDistinctMerchants(db: Db) {
  const results = await db
    .collection(CARD_TRANSACTION_COLLECTION)
    .aggregate([
      {
        $group: {
          _id: {
            name: '$cardTransactionMerchantName',
            mcc: '$cardTransactionMerchantCategoryCode',
          },
        },
      },
      { $project: { _id: 0, name: '$_id.name', mcc: '$_id.mcc' } },
      { $sort: { name: 1 } },
    ])
    .toArray();

  return results as { name: string; mcc: string }[];
}

export async function getTransactionsByCardToken(db: Db, value: string) {
  // Detect masked PAN (contains * or matches ****-****-****-XXXX pattern)
  // and route to the correct plaintext field.
  const isMaskedPan = value.includes('*') || /^\*{4}[-\s]?\*{4}[-\s]?\*{4}[-\s]?\d{4}$/.test(value);

  const query = isMaskedPan
    ? { cardTransactionMaskedPanDisplay: value }
    : { paymentCardReference: value };

  const results = await db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .find(query as Partial<CardTransactionLogControlRecord>)
    .sort({ cardTransactionDateTime: -1 })
    .toArray();

  return { results, count: results.length };
}

export async function getAllTransactions(
  db: Db,
  filters: { status?: string; merchant?: string; cardToken?: string; email?: string },
  page: number,
  limit: number
) {
  const query: Record<string, unknown> = {};
  if (filters.status)    query['cardTransactionStatus']       = filters.status;
  if (filters.merchant)  query['cardTransactionMerchantName'] = { $regex: filters.merchant, $options: 'i' };
  if (filters.cardToken) query['paymentCardReference']        = filters.cardToken;

  // Lookup by email resolves the customer's canonical account reference, then
  // matches cardTransactionAccountReference (QE:equality) directly. This covers
  // BOTH seeded transactions (accountReference = ACC-xxx) and simulator-created
  // ones (normalized to ACC-xxx on write), regardless of saved-card linkage.
  // A QE-capable client is required for the equality token on the encrypted field.
  let readDb = db;
  if (filters.email) {
    const qeDb = await getDbForRole('level1_analyst', false);
    readDb = qeDb;

    const party = await qeDb
      .collection<PartyControlRecord>(PARTY_COLLECTION)
      .findOne({ partyEmailAddress: filters.email } as Partial<PartyControlRecord>);
    if (!party) return { results: [], total: 0, page, limit };

    const agreement = await qeDb
      .collection<{ customerAgreementReference?: string }>(CUSTOMER_AGREEMENT_COLLECTION)
      .findOne({ partyInstanceReference: party.partyInstanceReference } as Record<string, unknown>);
    const accRef = agreement?.customerAgreementReference;
    if (!accRef) return { results: [], total: 0, page, limit };

    query['cardTransactionAccountReference'] = accRef;
  }

  const skip = (page - 1) * limit;
  const [results, total] = await Promise.all([
    readDb.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
      .find(query)
      .sort({ cardTransactionDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    readDb.collection(CARD_TRANSACTION_COLLECTION).countDocuments(query),
  ]);

  // Enrich each row with its linked fraud case (BIAN SD-83). The fraud/risk status is a SEPARATE
  // concept from the payment authorization status (cardTransactionStatus): a payment can be
  // "authorized" yet still flagged or confirmed fraud. The list surfaces both so they are not
  // conflated. Fraud-case fields are plaintext (not CHD), so the unencrypted client reads them.
  const txnIds = results.map((r) => r.cardTransactionInstanceReference);
  if (txnIds.length > 0) {
    const cases = await db
      .collection(FRAUD_DIAGNOSIS_COLLECTION)
      .find(
        { cardTransactionInstanceReference: { $in: txnIds } },
        { projection: { _id: 0, cardTransactionInstanceReference: 1, fraudDiagnosisCaseStatus: 1, fraudDiagnosisCaseReference: 1, fraudDiagnosisCaseSeverity: 1, 'fraudDiagnosisResolutionRecord.resolutionOutcome': 1 } },
      )
      .toArray();
    const byTxn = new Map(cases.map((c) => [c.cardTransactionInstanceReference as string, c]));
    for (const r of results as Record<string, unknown>[]) {
      const c = byTxn.get(r.cardTransactionInstanceReference as string);
      r.fraudCaseCreated = !!c;
      if (c) {
        r.fraudDiagnosisCaseStatus = c.fraudDiagnosisCaseStatus ?? null;
        r.fraudDiagnosisCaseReference = c.fraudDiagnosisCaseReference ?? null;
        r.fraudDiagnosisCaseSeverity = c.fraudDiagnosisCaseSeverity ?? null;
        r.fraudDiagnosisResolutionOutcome =
          (c.fraudDiagnosisResolutionRecord as { resolutionOutcome?: string } | undefined)?.resolutionOutcome ?? null;
      }
    }
  }

  return { results, total, page, limit };
}

/**
 * Acquiring-side view (BIAN SD-89 Merchant Relations): list the payments a merchant
 * RECEIVED, scoped by merchantAgreementInstanceReference (plaintext, indexed).
 *
 * PCI DSS data minimization (Req 3 / Req 7): the projection deliberately EXCLUDES
 * the payer's PII — no account reference / email, no rawGatewayPayload. The merchant
 * sees only the acquiring essentials: masked PAN, amount, status, type, channel,
 * descriptor and timestamp. No QE client needed (no encrypted field is queried).
 */
export async function getMerchantTransactions(
  db: Db,
  merchantId: string,
  page: number,
  limit: number,
  filters?: { status?: string; search?: string },
) {
  const query: Record<string, unknown> = { merchantAgreementInstanceReference: merchantId };
  if (filters?.status) query['cardTransactionStatus'] = filters.status;
  if (filters?.search) {
    // Plaintext fields only (no PII): masked PAN suffix or descriptor. Case-insensitive.
    const rx = { $regex: filters.search, $options: 'i' };
    query['$or'] = [
      { cardTransactionMaskedPanDisplay: rx },
      { cardTransactionDescription: rx },
      { cardTransactionMerchantName: rx },
    ];
  }
  const projection = {
    _id: 0,
    cardTransactionInstanceReference: 1,
    cardTransactionAmount: 1,
    cardTransactionDateTime: 1,
    cardTransactionStatus: 1,
    cardTransactionType: 1,
    cardTransactionChannel: 1,
    cardTransactionMerchantName: 1,
    cardTransactionMaskedPanDisplay: 1,
    cardTransactionDescription: 1,
  };
  const skip = (page - 1) * limit;
  const [results, total] = await Promise.all([
    db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
      .find(query)
      .project(projection)
      .sort({ cardTransactionDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection(CARD_TRANSACTION_COLLECTION).countDocuments(query),
  ]);
  return { results, total, page, limit };
}

/**
 * Acquiring-side analytics (BIAN Merchant Activity Analysis flavor) for a merchant's
 * received payments. Pure aggregation over plaintext fields — no PII, no decryption.
 * `$toDate` tolerates both Date and ISO-string `cardTransactionDateTime` values.
 */
export async function getMerchantStats(db: Db, merchantId: string) {
  const coll = db.collection(CARD_TRANSACTION_COLLECTION);
  const match = { merchantAgreementInstanceReference: merchantId };

  const [totalsAgg, byStatus, byMonth, byCurrency] = await Promise.all([
    coll.aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$cardTransactionAmount.amount' }, avgAmount: { $avg: '$cardTransactionAmount.amount' } } },
    ]).toArray(),
    coll.aggregate([
      { $match: match },
      { $group: { _id: '$cardTransactionStatus', count: { $sum: 1 }, amount: { $sum: '$cardTransactionAmount.amount' } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    coll.aggregate([
      { $match: match },
      { $group: { _id: { y: { $year: { $toDate: '$cardTransactionDateTime' } }, m: { $month: { $toDate: '$cardTransactionDateTime' } } }, count: { $sum: 1 }, amount: { $sum: '$cardTransactionAmount.amount' } } },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]).toArray(),
    coll.aggregate([
      { $match: match },
      { $group: { _id: '$cardTransactionAmount.currency', count: { $sum: 1 }, amount: { $sum: '$cardTransactionAmount.amount' } } },
      { $sort: { amount: -1 } },
    ]).toArray(),
  ]);

  const totals = totalsAgg[0] ?? { count: 0, totalAmount: 0, avgAmount: 0 };
  return {
    count: totals.count ?? 0,
    totalAmount: totals.totalAmount ?? 0,
    avgAmount: totals.avgAmount ?? 0,
    byStatus:   byStatus.map((s) => ({ status: s._id as string, count: s.count as number, amount: s.amount as number })),
    byMonth:    byMonth.map((s) => ({ year: (s._id as { y: number }).y, month: (s._id as { m: number }).m, count: s.count as number, amount: s.amount as number })),
    byCurrency: byCurrency.map((s) => ({ currency: s._id as string, count: s.count as number, amount: s.amount as number })),
  };
}
