import { Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { isValidIban } from '../../aspsp/services/bankIdentifier.service';
import {
  ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord,
} from '../../aspsp/models/accountArrangement.model';
import { PaymentProduct } from '../models/paymentInitiation.model';
import {
  PERIODIC_PAYMENT_COLLECTION, PeriodicPaymentControlRecord, PeriodicFrequency,
  ExecutionRule, CANCELLABLE_PERIODIC_STATUSES, PERIODIC_FREQUENCIES,
} from '../models/periodicPayment.model';
import { firstExecutionDate, validateSchedule, nextExecutionDate } from './periodicSchedule.service';

// A standing order at the bank. Creation validates the same way a single payment does, plus the schedule,
// and then STOPS: no money moves at creation, which is the same rule the single payment follows.

export interface CreatePeriodicInput {
  paymentProduct: PaymentProduct;
  tppClientId: string;
  consentReference: string;
  permittedAccountReferences: string[];
  debtorIban: string;
  creditorIban: string;
  creditorName: string;
  amount: number;
  currency: string;
  remittanceInformation?: string;
  endToEndIdentification?: string;
  startDate: string;
  endDate?: string;
  frequency: string;
  executionRule?: string;
  dayOfExecution?: number;
  correlationId?: string;
}

export type CreatePeriodicResult =
  | { ok: true; order: PeriodicPaymentControlRecord }
  | { ok: false; status: number; code: string; text: string };

// The schedule refusals, in the words a TPP integrator can act on. A code alone would send them reading
// source they do not have.
const SCHEDULE_REFUSALS: Record<string, string> = {
  start_date_invalid: 'startDate must be a real calendar date in YYYY-MM-DD form',
  end_date_invalid: 'endDate must be a real calendar date in YYYY-MM-DD form',
  end_before_start: 'endDate falls before startDate',
  day_of_execution_invalid: 'dayOfExecution must be between 1 and 31',
  no_execution_in_range: 'the schedule has no execution date between startDate and endDate',
};

export async function createPeriodicPayment(
  db: Db, input: CreatePeriodicInput,
): Promise<CreatePeriodicResult> {
  const refuse = (status: number, code: string, text: string): CreatePeriodicResult => ({ ok: false, status, code, text });

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return refuse(400, 'FORMAT_ERROR', 'instructedAmount must be a positive amount');
  }
  // The same epsilon comparison the single payment uses: 12345678.91 * 100 is not an integer in binary
  // floating point, so a plain equality check rejects valid amounts.
  if (Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 1e-6) {
    return refuse(400, 'FORMAT_ERROR', 'instructedAmount carries more precision than a currency has');
  }
  if (!input.creditorName?.trim()) return refuse(400, 'FORMAT_ERROR', 'creditorName is required');

  for (const [field, iban] of [['debtorAccount', input.debtorIban], ['creditorAccount', input.creditorIban]] as const) {
    if (!iban || !isValidIban(iban)) {
      return refuse(400, 'FORMAT_ERROR', `${field}.iban is not a valid IBAN`);
    }
  }
  if (input.debtorIban === input.creditorIban) {
    return refuse(400, 'FORMAT_ERROR', 'the debtor and the creditor are the same account');
  }

  if (!PERIODIC_FREQUENCIES.includes(input.frequency as PeriodicFrequency)) {
    return refuse(400, 'FORMAT_ERROR', `frequency must be one of ${PERIODIC_FREQUENCIES.join(', ')}`);
  }
  if (input.executionRule && input.executionRule !== 'following' && input.executionRule !== 'preceding') {
    return refuse(400, 'FORMAT_ERROR', 'executionRule must be following or preceding');
  }

  const plan = {
    startDate: input.startDate ?? '',
    endDate: input.endDate,
    frequency: input.frequency as PeriodicFrequency,
    dayOfExecution: input.dayOfExecution,
    executionRule: input.executionRule as ExecutionRule | undefined,
  };
  const scheduleRefusal = validateSchedule(plan);
  if (scheduleRefusal) {
    return refuse(400, 'FORMAT_ERROR', SCHEDULE_REFUSALS[scheduleRefusal] ?? scheduleRefusal);
  }

  const debtor = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .findOne({ accountIban: input.debtorIban }, { projection: { _id: 0 } });
  if (!debtor) return refuse(404, 'RESOURCE_UNKNOWN', 'the debtor account is not held at this bank');

  // Checked against the RESOLVED account, never the IBAN the caller sent, so naming an account the consent
  // does not cover cannot be believed.
  if (!input.permittedAccountReferences.includes(debtor.accountArrangementInstanceReference)) {
    return refuse(401, 'CONSENT_INVALID', 'the consent does not authorise payments from this account');
  }
  if (debtor.accountStatus !== 'active') {
    return refuse(400, 'PAYMENT_FAILED', `the debtor account is ${debtor.accountStatus}`);
  }
  if (debtor.accountCurrency !== input.currency) {
    return refuse(400, 'PAYMENT_FAILED', `the debtor account is held in ${debtor.accountCurrency}`);
  }
  // Deliberately NOT a balance check. A standing order authorises future collections, and today's balance
  // says nothing about a payment due next month. Refusing here would reject a perfectly good order because
  // the account happens to be low right now.

  const now = new Date().toISOString();
  const order: PeriodicPaymentControlRecord = {
    periodicPaymentInstanceReference: randomUUID(),
    paymentProduct: input.paymentProduct,
    paymentInitiatingTppClientId: input.tppClientId,
    bankConsentAgreementInstanceReference: input.consentReference,
    paymentDebtor: { accountReference: debtor.accountArrangementInstanceReference, iban: input.debtorIban },
    paymentCreditor: { iban: input.creditorIban },
    paymentCreditorName: input.creditorName.trim(),
    paymentInstructedAmount: input.amount,
    paymentCurrency: input.currency,
    paymentRemittanceInformation: input.remittanceInformation,
    paymentEndToEndIdentification: input.endToEndIdentification ?? randomUUID(),
    periodicStartDate: input.startDate,
    periodicEndDate: input.endDate,
    periodicFrequency: plan.frequency,
    periodicExecutionRule: plan.executionRule,
    periodicDayOfExecution: input.dayOfExecution,
    // Derived, never taken from the request: a caller who could set this could make the bank collect whenever
    // it liked.
    periodicNextExecutionDate: firstExecutionDate(plan) ?? undefined,
    periodicPaymentStatus: 'active',
    periodicExecutions: [],
    // The ORDER is accepted; no execution has happened, which is what `ACTC` says and `ACSC` would not.
    transactionStatus: 'ACTC',
    transactionStatusChangedDateTime: now,
    paymentCorrelationId: input.correlationId,
    bianServiceDomain: 'Payment Initiation',
    bianControlRecordType: 'PeriodicPaymentProcedure',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };

  await db.collection<PeriodicPaymentControlRecord>(PERIODIC_PAYMENT_COLLECTION).insertOne(order);
  return { ok: true, order };
}

export async function findPeriodicPayment(
  db: Db, reference: string, tppClientId: string,
): Promise<PeriodicPaymentControlRecord | null> {
  // Scoped to the initiating TPP in the QUERY: another third party's standing order is not found rather
  // than refused, so this cannot be used to discover that a reference exists.
  return db.collection<PeriodicPaymentControlRecord>(PERIODIC_PAYMENT_COLLECTION).findOne(
    { periodicPaymentInstanceReference: reference, paymentInitiatingTppClientId: tppClientId },
    { projection: { _id: 0 } },
  );
}

export type CancelResult = { ok: true; order: PeriodicPaymentControlRecord } | { ok: false; reason: string };

/** Cancels the order. Executions already presented are untouched: only the future is revocable. */
export async function cancelPeriodicPayment(
  db: Db, order: PeriodicPaymentControlRecord,
): Promise<CancelResult> {
  if (!CANCELLABLE_PERIODIC_STATUSES.includes(order.periodicPaymentStatus)) {
    return { ok: false, reason: `a ${order.periodicPaymentStatus} standing order cannot be cancelled` };
  }
  const now = new Date().toISOString();
  await db.collection<PeriodicPaymentControlRecord>(PERIODIC_PAYMENT_COLLECTION).updateOne(
    { periodicPaymentInstanceReference: order.periodicPaymentInstanceReference },
    {
      $set: {
        periodicPaymentStatus: 'cancelled',
        transactionStatus: 'CANC',
        transactionStatusChangedDateTime: now,
        recordUpdatedDateTime: now,
      },
      // The order stops collecting, which is what cancelling one means.
      $unset: { periodicNextExecutionDate: '' },
    },
  );
  return {
    ok: true,
    order: {
      ...order, periodicPaymentStatus: 'cancelled', transactionStatus: 'CANC', transactionStatusChangedDateTime: now,
    },
  };
}

/** Advances the schedule after an execution, completing the order when its end date is reached. */
export async function advanceSchedule(
  db: Db, order: PeriodicPaymentControlRecord, executedDate: string,
): Promise<string | null> {
  const next = nextExecutionDate({
    startDate: order.periodicStartDate,
    endDate: order.periodicEndDate,
    frequency: order.periodicFrequency,
    dayOfExecution: order.periodicDayOfExecution,
    executionRule: order.periodicExecutionRule,
  }, executedDate);

  const now = new Date().toISOString();
  if (!next) {
    // The series is over. `completed` rather than `cancelled`: nobody stopped it, it finished.
    await db.collection<PeriodicPaymentControlRecord>(PERIODIC_PAYMENT_COLLECTION).updateOne(
      { periodicPaymentInstanceReference: order.periodicPaymentInstanceReference },
      {
        $set: {
          periodicPaymentStatus: 'completed', transactionStatus: 'ACSC',
          transactionStatusChangedDateTime: now, recordUpdatedDateTime: now,
        },
        $unset: { periodicNextExecutionDate: '' },
      },
    );
    return null;
  }
  await db.collection<PeriodicPaymentControlRecord>(PERIODIC_PAYMENT_COLLECTION).updateOne(
    { periodicPaymentInstanceReference: order.periodicPaymentInstanceReference },
    { $set: { periodicNextExecutionDate: next, recordUpdatedDateTime: now } },
  );
  return next;
}

/** The Berlin Group view of a standing order. The internal field names are ours; this is theirs. */
export function toBerlinGroupPeriodicPayment(order: PeriodicPaymentControlRecord): Record<string, unknown> {
  return {
    paymentId: order.periodicPaymentInstanceReference,
    transactionStatus: order.transactionStatus,
    debtorAccount: { iban: order.paymentDebtor.iban },
    creditorAccount: { iban: order.paymentCreditor.iban },
    creditorName: order.paymentCreditorName,
    // Decimal string per ISO 20022, not a float: a JSON number would let a currency amount lose a cent.
    instructedAmount: { currency: order.paymentCurrency, amount: order.paymentInstructedAmount.toFixed(2) },
    remittanceInformationUnstructured: order.paymentRemittanceInformation,
    endToEndIdentification: order.paymentEndToEndIdentification,
    startDate: order.periodicStartDate,
    endDate: order.periodicEndDate,
    frequency: order.periodicFrequency,
    executionRule: order.periodicExecutionRule,
    dayOfExecution: order.periodicDayOfExecution,
    nextExecutionDate: order.periodicNextExecutionDate,
    executionCount: order.periodicExecutions.length,
  };
}
