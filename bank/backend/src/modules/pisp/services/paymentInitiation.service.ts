import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYMENT_INITIATION_COLLECTION, PaymentInitiationControlRecord, PaymentProduct,
  TransactionStatus, CANCELLABLE_STATUSES,
} from '../models/paymentInitiation.model';
import { ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord } from '../../aspsp/models/accountArrangement.model';
import { isValidIban } from '../../aspsp/services/bankIdentifier.service';
import { notifyTpp } from '../../tpp-trust/services/eventNotification.service';

// Payment Initiation Service: what the bank accepts, validates and tracks. It deliberately moves NO
// money yet.
//
// Execution (the debit, the on-us book transfer, the clearing leg, `pacs.008`) is the payment hub's, and
// it is where reversible becomes irreversible. Keeping that crossing as one identifiable step in its own
// phase is a constraint recorded in this plan, not an accident of sequencing: a validated payment sitting
// at `ACTC` is an honest state, whereas a half-executed one would not be.

function collection(db: Db) {
  return db.collection<PaymentInitiationControlRecord>(PAYMENT_INITIATION_COLLECTION);
}

export interface InitiatePaymentInput {
  product: PaymentProduct;
  tppClientId: string;
  consentReference: string;
  debtorIban: string;
  creditorIban: string;
  creditorName: string;
  creditorAgentBic?: string;
  amount: number;
  currency: string;
  remittanceInformation?: string;
  endToEndIdentification?: string;
  requestedExecutionDate?: string;
  correlationId?: string;
  // Account references the consent covers for payments, so authorisation is decided by the caller's
  // consent rather than re-derived here from the debtor the caller supplied.
  permittedAccountReferences: string[];
}

// Berlin Group's own error codes, so a TPP reads a standard reason rather than prose.
export type InitiationRefusalCode =
  | 'FORMAT_ERROR'
  | 'PRODUCT_INVALID'
  | 'RESOURCE_UNKNOWN'
  | 'CONSENT_INVALID'
  | 'PAYMENT_FAILED';

export type InitiatePaymentResult =
  | { ok: true; payment: PaymentInitiationControlRecord }
  | { ok: false; status: 400 | 401 | 404; code: InitiationRefusalCode; text: string };

/**
 * Accepts a payment: validates it, records it, and leaves it technically accepted.
 *
 * Validation is the bank's own even though the PSP validates first. Re-validating is not duplication,
 * it is the ASPSP half of the split recorded in this plan: a bank never trusts the client's checks.
 */
export async function initiatePayment(db: Db, input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, status: 400, code: 'FORMAT_ERROR', text: 'instructedAmount must be a positive amount' };
  }
  // Two decimal places at most: a third would be silently rounded somewhere later. The epsilon is not
  // optional, since 12345678.91 * 100 is not exactly an integer in binary floating point.
  if (Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 1e-6) {
    return { ok: false, status: 400, code: 'FORMAT_ERROR', text: 'instructedAmount carries more precision than a currency has' };
  }
  if (!input.creditorName?.trim()) {
    return { ok: false, status: 400, code: 'FORMAT_ERROR', text: 'creditorName is required' };
  }
  for (const [field, iban] of [['debtorAccount', input.debtorIban], ['creditorAccount', input.creditorIban]] as const) {
    if (!iban || !isValidIban(iban)) {
      // mod-97 rather than a length check: a typo that passes the length is the common case.
      return { ok: false, status: 400, code: 'FORMAT_ERROR', text: `${field}.iban is not a valid IBAN` };
    }
  }
  if (input.debtorIban === input.creditorIban) {
    return { ok: false, status: 400, code: 'FORMAT_ERROR', text: 'the debtor and the creditor are the same account' };
  }

  const debtor = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .findOne({ accountIban: input.debtorIban }, { projection: { _id: 0 } });
  if (!debtor) {
    return { ok: false, status: 404, code: 'RESOURCE_UNKNOWN', text: 'the debtor account is not held at this bank' };
  }
  // The consent decides, and it is checked against the RESOLVED account rather than the IBAN the caller
  // sent: otherwise a caller could name an account the consent does not cover and be believed.
  if (!input.permittedAccountReferences.includes(debtor.accountArrangementInstanceReference)) {
    return { ok: false, status: 401, code: 'CONSENT_INVALID', text: 'the consent does not authorise payments from this account' };
  }
  if (debtor.accountStatus !== 'active') {
    return { ok: false, status: 400, code: 'PAYMENT_FAILED', text: `the debtor account is ${debtor.accountStatus}` };
  }
  if (debtor.accountCurrency !== input.currency) {
    // Cross currency is the PSP's exchange capability, not something this bank does implicitly.
    return { ok: false, status: 400, code: 'PAYMENT_FAILED', text: `the debtor account is held in ${debtor.accountCurrency}` };
  }
  if (debtor.accountBalance.availableAmount < input.amount) {
    // Refused at initiation, before anything is reserved: the point of no return is the hub's, and this
    // is not it.
    return { ok: false, status: 400, code: 'PAYMENT_FAILED', text: 'insufficient funds on the debtor account' };
  }

  const now = new Date().toISOString();
  const payment: PaymentInitiationControlRecord = {
    paymentInitiationInstanceReference: `pmt-${uuidv4()}`,
    paymentProduct: input.product,
    paymentInitiatingTppClientId: input.tppClientId,
    bankConsentAgreementInstanceReference: input.consentReference,
    paymentDebtor: { accountReference: debtor.accountArrangementInstanceReference, iban: input.debtorIban },
    paymentCreditor: { iban: input.creditorIban },
    paymentCreditorName: input.creditorName.trim(),
    paymentCreditorAgentBic: input.creditorAgentBic,
    paymentInstructedAmount: input.amount,
    paymentCurrency: input.currency,
    paymentRemittanceInformation: input.remittanceInformation,
    // The caller's own id when it sends one, which is what correlates the payment across both databases.
    paymentEndToEndIdentification: input.endToEndIdentification ?? `E2E-${uuidv4()}`,
    paymentRequestedExecutionDate: input.requestedExecutionDate,
    // Validated and accepted, not executed. The hub moves it on from here.
    transactionStatus: 'ACTC',
    transactionStatusReason: 'accepted_technical_validation',
    transactionStatusChangedDateTime: now,
    paymentCorrelationId: input.correlationId,
    bianServiceDomain: 'Payment Execution',
    bianControlRecordType: 'PaymentInitiation',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };
  await collection(db).insertOne(payment);
  return { ok: true, payment };
}

export async function findPayment(
  db: Db,
  paymentId: string,
  tppClientId: string,
  product?: PaymentProduct,
): Promise<PaymentInitiationControlRecord | null> {
  // Scoped to the initiating TPP, and to the product in the path: a payment read under the wrong product
  // is not this payment, and answering it anyway would make the path decorative.
  return collection(db).findOne(
    {
      paymentInitiationInstanceReference: paymentId,
      paymentInitiatingTppClientId: tppClientId,
      ...(product ? { paymentProduct: product } : {}),
    },
    { projection: { _id: 0 } },
  );
}

/**
 * Moves a payment to a new status and tells the initiating TPP.
 *
 * Every lifecycle outcome is notified, not only the happy one: a rejection and a return arriving days
 * later are exactly the cases where a PSP that only polls leaves a transfer stuck in `pending`.
 */
/**
 * Finds a payment by its reference alone, for the bank's own execution path. The API-facing finder is scoped
 * to the initiating TPP on purpose; this one is not, and it is never reachable from a route.
 */
export async function findPaymentByReference(
  db: Db,
  paymentId: string,
): Promise<PaymentInitiationControlRecord | null> {
  return collection(db).findOne({ paymentInitiationInstanceReference: paymentId }, { projection: { _id: 0 } });
}

export async function changeTransactionStatus(
  db: Db,
  paymentId: string,
  status: TransactionStatus,
  reason: string,
): Promise<PaymentInitiationControlRecord | null> {
  const now = new Date().toISOString();
  await collection(db).updateOne(
    { paymentInitiationInstanceReference: paymentId },
    {
      $set: {
        transactionStatus: status,
        transactionStatusReason: reason,
        transactionStatusChangedDateTime: now,
        recordUpdatedDateTime: now,
      },
    },
  );
  const updated = await collection(db)
    .findOne({ paymentInitiationInstanceReference: paymentId }, { projection: { _id: 0 } });
  if (updated) {
    await notifyTpp(db, updated.paymentInitiatingTppClientId, {
      eventType: 'payment.status.changed',
      subjectReference: paymentId,
      status,
      // The end to end id lets the PSP find its own record without a lookup table.
      detail: { reason, endToEndIdentification: updated.paymentEndToEndIdentification },
      correlationId: updated.paymentCorrelationId,
    });
  }
  return updated;
}

export type CancelResult =
  | { ok: true; payment: PaymentInitiationControlRecord }
  | { ok: false; status: 400; code: 'CANCELLATION_INVALID'; text: string };

/**
 * Cancels a payment that has not yet been presented for settlement. Past that point a payment is
 * irrevocable and what exists is a recall or a return, which the creditor's bank may refuse: reporting
 * that as a cancellation would promise something the rails do not deliver.
 */
export async function cancelPayment(db: Db, payment: PaymentInitiationControlRecord): Promise<CancelResult> {
  if (!CANCELLABLE_STATUSES.includes(payment.transactionStatus)) {
    return {
      ok: false,
      status: 400,
      code: 'CANCELLATION_INVALID',
      text: `a payment in ${payment.transactionStatus} can no longer be cancelled`,
    };
  }
  const updated = await changeTransactionStatus(
    db, payment.paymentInitiationInstanceReference, 'CANC', 'cancelled_by_tpp',
  );
  return { ok: true, payment: updated ?? { ...payment, transactionStatus: 'CANC' } };
}

// ── The standard resource ────────────────────────────────────────────────────────────────────────

export interface BerlinGroupPayment {
  transactionStatus: TransactionStatus;
  paymentId: string;
  endToEndIdentification: string;
  debtorAccount: { iban: string };
  creditorAccount: { iban: string };
  creditorName: string;
  creditorAgent?: string;
  instructedAmount: { currency: string; amount: string };
  remittanceInformationUnstructured?: string;
  requestedExecutionDate?: string;
}

export function toBerlinGroupPayment(payment: PaymentInitiationControlRecord): BerlinGroupPayment {
  return {
    transactionStatus: payment.transactionStatus,
    paymentId: payment.paymentInitiationInstanceReference,
    endToEndIdentification: payment.paymentEndToEndIdentification,
    debtorAccount: { iban: payment.paymentDebtor.iban },
    creditorAccount: { iban: payment.paymentCreditor.iban },
    creditorName: payment.paymentCreditorName,
    creditorAgent: payment.paymentCreditorAgentBic,
    // A decimal STRING per ISO 20022: a JSON number loses cents on a large value.
    instructedAmount: { currency: payment.paymentCurrency, amount: payment.paymentInstructedAmount.toFixed(2) },
    remittanceInformationUnstructured: payment.paymentRemittanceInformation,
    requestedExecutionDate: payment.paymentRequestedExecutionDate,
  };
}
