import { PaymentProduct, PaymentPartyAccount, TransactionStatus } from './paymentInitiation.model';

// A standing order: one authorisation, many executions on a schedule.
//
// Berlin Group treats it as its own resource rather than a flag on a payment, and that is the right shape:
// a single payment has one status and one outcome, while a standing order has a status of its own PLUS an
// outcome per execution. Folding the two together would leave no place to say "the order is active and the
// third collection failed".
export const PERIODIC_PAYMENT_COLLECTION = 'periodicPaymentProcedure';

// The standard's frequency codes (ISO 20022 EventFrequency7Code), not a bespoke enumeration. A TPP that
// integrates against any other bank already sends these.
export type PeriodicFrequency =
  | 'Daily'
  | 'Weekly'
  | 'EveryTwoWeeks'
  | 'Monthly'
  | 'EveryTwoMonths'
  | 'Quarterly'
  | 'SemiAnnual'
  | 'Annual';

export const PERIODIC_FREQUENCIES: PeriodicFrequency[] = [
  'Daily', 'Weekly', 'EveryTwoWeeks', 'Monthly', 'EveryTwoMonths', 'Quarterly', 'SemiAnnual', 'Annual',
];

// What to do when the scheduled day is not a working day. `following` moves forward, `preceding` moves back.
// Berlin Group spells these exactly this way, so they are not normalised into something tidier.
export type ExecutionRule = 'following' | 'preceding';

// The order's own lifecycle, distinct from the transaction status of any one execution.
export type PeriodicPaymentStatus = 'active' | 'suspended' | 'cancelled' | 'completed';

// One collection attempt. Kept on the order rather than in a separate collection because it is only ever
// read with its order, and a standing order has a bounded number of them.
export interface PeriodicExecution {
  executionDate: string;
  // The single payment this execution created, so the two records stay navigable in both directions.
  paymentInitiationInstanceReference?: string;
  transactionStatus: TransactionStatus;
  transactionStatusReason?: string;
}

export interface PeriodicPaymentControlRecord {
  // The standard's paymentId for the standing order itself.
  periodicPaymentInstanceReference: string;
  paymentProduct: PaymentProduct;
  paymentInitiatingTppClientId: string;
  bankConsentAgreementInstanceReference: string;
  paymentDebtor: PaymentPartyAccount;
  paymentCreditor: PaymentPartyAccount;
  paymentCreditorName: string;
  paymentInstructedAmount: number;
  paymentCurrency: string;
  paymentRemittanceInformation?: string;
  paymentEndToEndIdentification: string;

  // ── The schedule ───────────────────────────────────────────────────────────────────────────────
  periodicStartDate: string;
  // Absent means open-ended, which is what a standing order usually is.
  periodicEndDate?: string;
  periodicFrequency: PeriodicFrequency;
  periodicExecutionRule?: ExecutionRule;
  // 1 to 31 for a monthly-or-longer frequency. A day the month does not have is clamped to its last, which
  // is why the 31st of February is not an error.
  periodicDayOfExecution?: number;
  // Derived, never supplied: a caller that could set the next execution date could make the bank collect
  // whenever it liked.
  periodicNextExecutionDate?: string;

  periodicPaymentStatus: PeriodicPaymentStatus;
  periodicPaymentStatusReason?: string;
  periodicExecutions: PeriodicExecution[];
  // The order's overall transaction status, which is what the standard's status endpoint returns for it.
  transactionStatus: TransactionStatus;
  transactionStatusChangedDateTime: string;

  paymentCorrelationId?: string;
  bianServiceDomain: string;
  bianControlRecordType: 'PeriodicPaymentProcedure';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}

// A standing order can be cancelled while it is still collecting. Unlike a single payment, there is no
// point of no return for the ORDER: only an individual execution already presented is irrevocable.
export const CANCELLABLE_PERIODIC_STATUSES: PeriodicPaymentStatus[] = ['active', 'suspended'];
