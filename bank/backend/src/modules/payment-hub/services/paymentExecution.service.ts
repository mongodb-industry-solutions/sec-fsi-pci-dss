import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  COUNTERPARTY_BANK_COLLECTION, INTERBANK_MESSAGE_LOG_COLLECTION,
  CounterpartyBankControlRecord, InterbankMessageLogRecord, InterbankMessageType, ClearingScheme,
} from '../models/counterpartyBank.model';
import { PaymentInitiationControlRecord } from '../../pisp/models/paymentInitiation.model';
import { changeTransactionStatus, findPaymentByReference } from '../../pisp/services/paymentInitiation.service';
import { BANK_PROFILE_COLLECTION, BankProfileControlRecord } from '../../aspsp/models/bankProfile.model';
import { ownsIban, ibanBankCode } from '../../aspsp/services/bankIdentifier.service';
import { bookTransfer, debit, credit } from '../../aspsp/services/ledger.service';
import { findAccountByIban } from '../../aisp/services/accountInformation.service';
import { buildPacs008, buildPacs002, buildPacs004 } from './iso20022.service';
import { clearingPort } from '../adapters/simulatedCsm.adapter';
import { ClearingPort } from '../ports/clearing.port';

// Executing a payment: the debit, and either a book transfer or a clearing leg.
//
// **Internal or external is DERIVED, never configured.** If the creditor IBAN's bank code belongs to this
// bank's own profile it is on-us and settles immediately with no scheme involved; otherwise it goes out
// through the clearing port. The PSP initiates the same payment either way and learns the outcome from the
// status, which is what a real ASPSP does and what keeps the on-us optimisation inside the bank.
//
// **The point of no return is ONE identifiable step** (N3): `presentToScheme` for an external payment, and
// the book transfer for an internal one. Everything before it is reversible by releasing what was reserved;
// nothing after it is, which is why a post-settlement return is handled as a return and never as a
// compensation.

export type ExecutionOutcome =
  | { state: 'settled'; scheme: ClearingScheme | 'book_transfer' }
  | { state: 'in_flight'; clearingReference: string; scheme: ClearingScheme }
  | { state: 'rejected'; reasonCode: string }
  | { state: 'error'; error: string };

async function logInterbankMessage(
  db: Db,
  payment: PaymentInitiationControlRecord,
  input: {
    type: InterbankMessageType;
    direction: 'sent' | 'received';
    messageIdentification: string;
    scheme: ClearingScheme;
    payload: Record<string, unknown>;
    status?: string;
    reasonCode?: string;
    creditorBic?: string;
  },
): Promise<void> {
  const record: InterbankMessageLogRecord = {
    interbankMessageLogInstanceReference: `ibm-${uuidv4()}`,
    interbankMessageType: input.type,
    interbankMessageDirection: input.direction,
    paymentInitiationInstanceReference: payment.paymentInitiationInstanceReference,
    interbankEndToEndIdentification: payment.paymentEndToEndIdentification,
    interbankMessageIdentification: input.messageIdentification,
    interbankScheme: input.scheme,
    interbankCreditorBic: input.creditorBic,
    interbankAmount: payment.paymentInstructedAmount,
    interbankCurrency: payment.paymentCurrency,
    interbankStatus: input.status,
    interbankReasonCode: input.reasonCode,
    interbankMessagePayload: input.payload,
    recordCreatedDateTime: new Date().toISOString(),
    schemaVersion: 1,
  };
  await db.collection<InterbankMessageLogRecord>(INTERBANK_MESSAGE_LOG_COLLECTION).insertOne(record);
}

/** The scheme that reaches a counterparty, or a reason it cannot be reached. */
export async function resolveReachability(
  db: Db,
  creditorIban: string,
  product: string,
): Promise<{ scheme: ClearingScheme; counterparty: CounterpartyBankControlRecord } | { error: string }> {
  const code = ibanBankCode(creditorIban);
  if (!code) return { error: 'the creditor IBAN carries no recognisable bank code' };

  const counterparty = await db.collection<CounterpartyBankControlRecord>(COUNTERPARTY_BANK_COLLECTION)
    .findOne({ counterpartyBankIbanBankCodes: code }, { projection: { _id: 0 } });
  if (!counterparty) {
    // Refused with a reason rather than attempted and lost. This is the whole purpose of the registry.
    return { error: `no registered institution owns bank code ${code}` };
  }
  if (counterparty.counterpartyBankStatus !== 'reachable') {
    return { error: `${counterparty.counterpartyBankName} is not currently reachable` };
  }

  // The payment product the TPP chose narrows the scheme; the counterparty's membership decides whether it
  // is available. An instant request to an institution that is not in SCT Inst falls back to SEPA rather
  // than failing, because the customer asked to pay, not to use a particular rail.
  const preferred: ClearingScheme = product === 'instant-sepa-credit-transfers'
    ? 'sepa_instant'
    : product === 'cross-border-credit-transfers' ? 'swift' : 'sepa';
  if (counterparty.counterpartyBankSchemes.includes(preferred)) return { scheme: preferred, counterparty };

  const fallback = counterparty.counterpartyBankSchemes[0];
  if (!fallback) return { error: `${counterparty.counterpartyBankName} is reachable by no scheme this bank uses` };
  return { scheme: fallback, counterparty };
}

/**
 * Executes an accepted payment.
 *
 * Statuses move through `changeTransactionStatus`, which notifies the TPP on every transition, so the PSP
 * hears about acceptance, settlement, rejection and a later return through one mechanism rather than three.
 */
export async function executePayment(
  db: Db,
  paymentReference: string,
  options: { port?: ClearingPort } = {},
): Promise<ExecutionOutcome> {
  const payment = await findPaymentByReference(db, paymentReference);
  if (!payment) return { state: 'error', error: 'no such payment' };
  if (payment.transactionStatus !== 'ACTC') {
    // Only a technically accepted payment is executable. Re-executing one already in flight would double
    // the debit, and this is the cheapest place to refuse that.
    return { state: 'error', error: `a payment in ${payment.transactionStatus} is not executable` };
  }

  const profile = await db.collection<BankProfileControlRecord>(BANK_PROFILE_COLLECTION).findOne({});
  if (!profile) return { state: 'error', error: 'this bank has no profile, so nothing can be routed' };

  const debtorRef = payment.paymentDebtor.accountReference;
  if (!debtorRef) return { state: 'error', error: 'the payment names no debtor account' };
  const operation = {
    accountRef: debtorRef,
    amount: payment.paymentInstructedAmount,
    currency: payment.paymentCurrency,
    correlationId: payment.paymentEndToEndIdentification,
    remittanceInformation: payment.paymentRemittanceInformation,
  };

  // ── Internal (on-us): a book transfer between two of this bank's own accounts ──────────────────
  if (ownsIban(profile, payment.paymentCreditor.iban)) {
    const creditorAccount = await findAccountByIban(db, payment.paymentCreditor.iban);
    if (!creditorAccount) {
      await changeTransactionStatus(db, paymentReference, 'RJCT', 'creditor_account_unknown');
      return { state: 'rejected', reasonCode: 'AC01' };
    }
    // ONE step, and the point of no return for this path: the debit and the credit are a single operation
    // that compensates its own debit if the credit fails.
    const booked = await bookTransfer(db, {
      amount: operation.amount,
      currency: operation.currency,
      correlationId: operation.correlationId,
      remittanceInformation: operation.remittanceInformation,
      debtorAccountRef: debtorRef,
      creditorAccountRef: creditorAccount.accountArrangementInstanceReference,
    });
    if (!booked.applied) {
      await changeTransactionStatus(db, paymentReference, 'RJCT', booked.reason ?? 'book_transfer_failed');
      return { state: 'rejected', reasonCode: booked.reason === 'insufficient_funds' ? 'AM04' : 'AC01' };
    }
    // No scheme, no message: there is nothing to present when both sides are here. Settled immediately,
    // which is the on-us optimisation the PSP is not told about because it does not need to know.
    await changeTransactionStatus(db, paymentReference, 'ACSC', 'settled_on_us');
    return { state: 'settled', scheme: 'book_transfer' };
  }

  // ── External (off-us): debit, present to the scheme, settle or fail ────────────────────────────
  const reachability = await resolveReachability(db, payment.paymentCreditor.iban, payment.paymentProduct);
  if ('error' in reachability) {
    // Refused BEFORE the debit: an unreachable beneficiary must not cost the customer their money while
    // someone works out where it went.
    await changeTransactionStatus(db, paymentReference, 'RJCT', reachability.error);
    return { state: 'rejected', reasonCode: 'AC01' };
  }
  const { scheme, counterparty } = reachability;

  const debited = await debit(db, operation, 'credit_transfer_debit');
  if (!debited.applied) {
    await changeTransactionStatus(db, paymentReference, 'RJCT', debited.reason ?? 'debit_failed');
    return { state: 'rejected', reasonCode: 'AM04' };
  }

  const { message, messageIdentification } = buildPacs008(payment, {
    debtorBic: profile.bankProfileBic,
    creditorBic: counterparty.counterpartyBankCorrespondentBic ?? counterparty.counterpartyBankBic,
    scheme,
  });
  const port = options.port ?? clearingPort();

  // THE POINT OF NO RETURN. Past this line the operation is with the scheme and what exists afterwards is a
  // return, not a cancellation. Nothing else in this function belongs on this side of it.
  const acknowledgement = await port.submit({
    message, messageIdentification, endToEndIdentification: payment.paymentEndToEndIdentification,
    scheme, creditorBic: counterparty.counterpartyBankBic,
    amount: payment.paymentInstructedAmount, currency: payment.paymentCurrency,
  });
  await logInterbankMessage(db, payment, {
    type: 'pacs.008', direction: 'sent', messageIdentification, scheme,
    payload: message as unknown as Record<string, unknown>,
    status: acknowledgement.accepted ? 'submitted' : 'refused',
    reasonCode: acknowledgement.reasonCode,
    creditorBic: counterparty.counterpartyBankBic,
  });

  if (!acknowledgement.accepted || !acknowledgement.clearingReference) {
    // The scheme would not take it, so nothing was presented and the debit is reversed. This is a
    // compensation and it is legitimate BECAUSE it is still on the reversible side of the line.
    await credit(db, operation, 'credit_transfer_credit');
    await changeTransactionStatus(db, paymentReference, 'RJCT', `scheme_refused_${acknowledgement.reasonCode ?? 'unknown'}`);
    return { state: 'rejected', reasonCode: acknowledgement.reasonCode ?? 'AC01' };
  }

  await changeTransactionStatus(db, paymentReference, 'ACSP', `presented_to_${scheme}`);
  return { state: 'in_flight', clearingReference: acknowledgement.clearingReference, scheme };
}

/**
 * Polls the scheme for a submission already presented, and applies what it says.
 *
 * Separate from execution on purpose: settlement is asynchronous, and a function that returned a settled
 * payment synchronously would be lying about the one thing this boundary exists to model.
 */
export async function reconcileSubmission(
  db: Db,
  paymentReference: string,
  clearingReference: string,
  options: { port?: ClearingPort } = {},
): Promise<ExecutionOutcome> {
  const payment = await findPaymentByReference(db, paymentReference);
  if (!payment) return { state: 'error', error: 'no such payment' };

  const port = options.port ?? clearingPort();
  const report = await port.statusOf(clearingReference);
  const scheme = (payment.paymentProduct === 'cross-border-credit-transfers' ? 'swift' : 'sepa') as ClearingScheme;

  const { message, messageIdentification } = buildPacs002({
    originalMessageIdentification: clearingReference,
    originalEndToEndIdentification: payment.paymentEndToEndIdentification,
    status: report.status,
    reasonCode: report.reasonCode,
  });
  await logInterbankMessage(db, payment, {
    type: 'pacs.002', direction: 'received', messageIdentification, scheme,
    payload: message as unknown as Record<string, unknown>,
    status: report.status, reasonCode: report.reasonCode,
  });

  if (report.status === 'ACSP') return { state: 'in_flight', clearingReference, scheme };

  if (report.status === 'RJCT') {
    // Refused after presentation. The debit is reversed because the money never left the scheme, and the
    // status carries the scheme's own reason code rather than a paraphrase.
    await credit(db, {
      accountRef: payment.paymentDebtor.accountReference!,
      amount: payment.paymentInstructedAmount,
      currency: payment.paymentCurrency,
      correlationId: payment.paymentEndToEndIdentification,
    }, 'credit_transfer_credit');
    await changeTransactionStatus(db, paymentReference, 'RJCT', `scheme_rejected_${report.reasonCode ?? 'unknown'}`);
    return { state: 'rejected', reasonCode: report.reasonCode ?? 'AC01' };
  }

  await changeTransactionStatus(db, paymentReference, 'ACSC', 'settled_by_scheme');
  return { state: 'settled', scheme };
}

/**
 * A return arriving AFTER settlement.
 *
 * Deliberately not called a compensation: the payment settled, the money moved, and the creditor's bank is
 * sending it back. Naming this a compensation would encode a promise the rails do not keep, since a return
 * can be refused. The customer is credited and the PSP is notified, and the payment stays settled with a
 * return recorded against it rather than being rewritten as though it never happened.
 */
export async function applyInboundReturn(
  db: Db,
  paymentReference: string,
  reasonCode: string,
): Promise<ExecutionOutcome> {
  const payment = await findPaymentByReference(db, paymentReference);
  if (!payment) return { state: 'error', error: 'no such payment' };
  if (payment.transactionStatus !== 'ACSC') {
    return { state: 'error', error: `only a settled payment can be returned, not one in ${payment.transactionStatus}` };
  }

  const { message, messageIdentification } = buildPacs004({
    originalEndToEndIdentification: payment.paymentEndToEndIdentification,
    amount: payment.paymentInstructedAmount,
    currency: payment.paymentCurrency,
    reasonCode,
  });
  await logInterbankMessage(db, payment, {
    type: 'pacs.004', direction: 'received', messageIdentification,
    scheme: (payment.paymentProduct === 'cross-border-credit-transfers' ? 'swift' : 'sepa') as ClearingScheme,
    payload: message as unknown as Record<string, unknown>,
    status: 'returned', reasonCode,
  });

  await credit(db, {
    accountRef: payment.paymentDebtor.accountReference!,
    amount: payment.paymentInstructedAmount,
    currency: payment.paymentCurrency,
    correlationId: payment.paymentEndToEndIdentification,
    remittanceInformation: `return ${reasonCode}`,
  }, 'return');

  // `RJCT` would say it never settled, which is false and would leave the PSP unable to explain the two
  // movements on the statement. The status change is what notifies the PSP either way.
  await changeTransactionStatus(db, paymentReference, 'ACSC', `returned_${reasonCode}`);
  return { state: 'settled', scheme: 'book_transfer' };
}
