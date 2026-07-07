// v17.1 BIAN SD-65/66: Unified bank-transfer service (ACH / SEPA / SWIFT).
// All rail derivation/validation goes through the shared rail engine (DRY), and execution is
// dispatched through the payment_initiation provider (ADR-039: never a direct builtin import),
// so an external PISP can replace the builtin module without changing this flow.
//
// PCI DSS: destination banking coordinates for unregistered accounts are transaction-scoped
// (bound to the execution) and never exposed on the bus; the wire adapter resolves them.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  railResolver, feeCalculator, UnsupportedCorridorError,
  type BankRail, type RailDestination, type RecurringMandate,
} from '../../../shared/services/bankTransfer';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitProcessEvent, emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { screenTransfer, openTransferFraudCase } from './transferRiskGate';
import { getPayoutAccount } from './payoutAccount.service';
import { config as appConfig } from '../../../config';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';

/**
 * Mask a bank account identifier (IBAN or domestic account number) for display storage.
 * Keeps the first 4 and last 4 characters, masks the middle with bullets — enough to recognise
 * and trace the destination without persisting the full number (PCI DSS Req 3.3).
 * "FR7630006000011234567890189" → "FR76••••0189"; short values keep only the last 2.
 */
export function maskAccountIdentifier(raw: string): string {
  const v = raw.replace(/\s/g, '');
  if (v.length <= 6) return `••${v.slice(-2)}`;
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

/** Build the recipient identity for an external bank transfer to an unregistered account.
 *  destinationIban is the full IBAN (persisted QE:none, shown full to the owner); the masked
 *  form stays plaintext for list views. */
function buildRecipientSnapshot(destination: RailDestination): {
  beneficiaryName?: string;
  destinationIban?: string;
  destinationAccountMasked?: string;
  destinationCountry: string;
} {
  const accountId = destination.iban ?? destination.accountNumber;
  return {
    beneficiaryName: destination.beneficiaryName?.trim() || undefined,
    destinationIban: destination.iban?.replace(/\s/g, '') || undefined,
    destinationAccountMasked: accountId ? maskAccountIdentifier(accountId) : undefined,
    destinationCountry: destination.countryCode,
  };
}

export interface BankTransferPreview {
  ok: boolean;
  rail?: BankRail;
  feeAmount?: number;
  feeCurrency?: string;
  errors: string[];
}

/** Stateless preview: derive the rail, validate coordinates and quote the fee. No side effects. */
export function previewBankTransfer(
  destination: RailDestination,
  amountCurrency: string,
  override?: BankRail,
): BankTransferPreview {
  let rail: BankRail;
  try {
    rail = railResolver.resolve(destination, override);
  } catch (err) {
    if (err instanceof UnsupportedCorridorError) {
      return { ok: false, errors: ['No supported rail (SEPA/ACH/SWIFT) for this country, currency and details.'] };
    }
    throw err;
  }
  const validation = railResolver.validate(rail, destination);
  if (!validation.ok) return { ok: false, rail, errors: validation.errors };
  return { ok: true, rail, feeAmount: feeCalculator.calculate(rail, destination), feeCurrency: amountCurrency, errors: [] };
}

export interface ExecuteBankTransferInput {
  initiatorPartyRef: string;
  amount: number;
  currency: string;
  destination: RailDestination;
  rail?: BankRail;                 // user override
  reference?: string;              // ISO 20022 remittance info
  fromAccountRef?: string;         // optional chosen source payout account (SD-66); validated for ownership
  recurring?: RecurringMandate;
  settlementSchedule?: 'T+0' | 'T+1' | 'T+2' | 'T+3';
  merchantAgreementReference?: string; // SD-89: set when initiated via a merchant portal (OAuth on-behalf-of)
}

export interface ExecuteBankTransferResult {
  executionReference: string;
  status: 'submitted' | 'failed' | 'exception';
  rail?: BankRail;
  feeAmount?: number;
  currency: string;
  errors?: string[];
}

/**
 * Execute a bank transfer to a (registered or unregistered) external account.
 * Flow: validate via rail engine -> persist SD-65 execution (routing) -> dispatch to the
 * payment_initiation provider -> record submitted + audit. Settlement arrives asynchronously.
 */
export async function executeBankTransfer(
  db: Db,
  input: ExecuteBankTransferInput,
): Promise<ExecuteBankTransferResult> {
  const executionRef = uuidv4();
  const now = new Date();
  const settlementSchedule = input.settlementSchedule ?? 'T+1';

  // 1. Rail derivation + validation (single source of truth).
  const preview = previewBankTransfer(input.destination, input.currency, input.rail);
  if (!preview.ok || !preview.rail) {
    await recordException(db, executionRef, input, preview.errors, now);
    return { executionReference: executionRef, status: 'exception', currency: input.currency, errors: preview.errors };
  }
  const rail = preview.rail;

  // 1a. If the user chose a source account, verify it belongs to the initiator and is active
  //     (mirrors the P2P ownership check). A mismatch is a client error, not a rail exception.
  if (input.fromAccountRef) {
    const src = await getPayoutAccount(db, input.fromAccountRef);
    if (!src || src.partyInstanceReference !== input.initiatorPartyRef || src.payoutAccountStatus !== 'active') {
      const errors = ['Source account not found or not active.'];
      await recordException(db, executionRef, input, errors, now);
      return { executionReference: executionRef, status: 'exception', rail, currency: input.currency, errors };
    }
  }

  // 1b. Pre-initiation risk gate (G4c): FDS + HRP + AML via providers, before any funds move.
  const screen = await screenTransfer(db, {
    transferRef: executionRef,
    amount: input.amount,
    currency: input.currency,
    initiatorPartyRef: input.initiatorPartyRef,
    destinationCountry: input.destination.countryCode,
  });
  if (screen.blocked) {
    await recordException(db, executionRef, input, [screen.reason ?? 'Blocked by risk screening', ...screen.indicators], now);
    // Open an L1-reviewable fraud investigation case for the negative HRP/FDS/AML evaluation.
    await openTransferFraudCase(db, { transferRef: executionRef, initiatorPartyRef: input.initiatorPartyRef, indicators: screen.indicators, score: screen.score, amount: input.amount, currency: input.currency });
    emitComplianceEvent(db, {
      entityType: 'execution', entityId: executionRef,
      processType: 'payment_processing', processAction: 'bank.transfer.blocked',
      processOutcome: 'rejected',
      performedByPartyReference: input.initiatorPartyRef, performedByRole: 'customer',
      eventSummary: { amount: input.amount, currency: input.currency, rail, indicators: screen.indicators, score: screen.score },
      bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    });
    return { executionReference: executionRef, status: 'exception', rail, currency: input.currency, errors: [screen.reason ?? 'Blocked by risk screening'] };
  }

  // 2. Persist the SD-65 execution in routing state (append-only resolution log).
  const execution: PaymentExecutionProcedure = {
    paymentExecutionInstanceReference: executionRef,
    paymentOrderInstanceReference: executionRef,
    beneficiaryType: 'user',
    initiatorPartyReference: input.initiatorPartyRef,
    ...(input.merchantAgreementReference ? { merchantAgreementReference: input.merchantAgreementReference } : {}),
    ...(input.fromAccountRef ? { sourcePayoutAccountReference: input.fromAccountRef } : {}),
    ...buildRecipientSnapshot(input.destination),
    grossAmount: input.amount,
    netAmount: input.amount,
    feeAmount: preview.feeAmount ?? 0,
    currency: input.currency,
    paymentExecutionRail: rail,
    routingNote: `${appConfig.payout.sandbox ? '[sandbox] ' : ''}${input.reference ? `Bank transfer: ${input.reference}` : `Bank transfer via ${rail.toUpperCase()}`}`,
    paymentExecutionStatus: 'routing',
    initiatedAt: now,
    resolutionLog: [
      { stepName: 'rail.selected', stepOutcome: 'found', stepNote: `rail=${rail}${input.rail ? ' (override)' : ' (auto)'}`, stepDateTime: now },
      { stepName: 'rail.validated', stepOutcome: 'found', stepNote: `country=${input.destination.countryCode} currency=${input.currency}`, stepDateTime: now },
    ],
    bianServiceDomain: 'Payment Execution',
    bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).insertOne(execution);

  // 3. Dispatch through the payment_initiation provider (ADR-039: provider-based, never direct import).
  //    Destination coordinates stay transaction-scoped; only the PSP-opaque execution ref rides here.
  const dispatch = await dispatchProvider(
    db,
    'payment_initiation',
    'provider.payment_initiation.transfer.requested',
    {
      clientReference: executionRef,
      paymentExecutionInstanceReference: executionRef,
      railType: rail,
      amount: input.amount,
      currency: input.currency,
      settlementSchedule,
      paymentReference: input.reference ?? '',
    },
    { entityType: 'execution', entityId: executionRef, processType: 'payment_processing' },
  );

  const submitted = dispatch.status === 'sent' || dispatch.status === 'received';
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
    { paymentExecutionInstanceReference: executionRef },
    {
      $set: { paymentExecutionStatus: submitted ? 'in_flight' : 'failed', recordUpdatedDateTime: new Date() },
      $push: { resolutionLog: { stepName: 'provider.dispatch', stepOutcome: submitted ? 'found' : 'failed', stepNote: `provider=${dispatch.provider} status=${dispatch.status}`, stepDateTime: new Date() } },
    },
  );

  // 4. Audit (PCI DSS Req 10): business + compliance events share the execution ref as correlationId.
  emitProcessEvent(db, {
    entityType: 'execution', entityId: executionRef,
    processType: 'payment_processing', processAction: 'bank.transfer.submitted',
    processOutcome: submitted ? 'approved' : 'rejected',
    performedByPartyReference: input.initiatorPartyRef, performedByRole: 'customer',
    eventSummary: { amount: input.amount, currency: input.currency, rail, fee: preview.feeAmount, country: input.destination.countryCode },
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
  });
  emitComplianceEvent(db, {
    entityType: 'execution', entityId: executionRef,
    processType: 'payment_processing', processAction: 'bank.transfer.funds.moved',
    processOutcome: submitted ? 'approved' : 'rejected',
    performedByPartyReference: input.initiatorPartyRef, performedByRole: 'customer',
    eventSummary: { grossAmount: input.amount, currency: input.currency, rail, beneficiaryType: 'user' },
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
  });

  return {
    executionReference: executionRef,
    status: submitted ? 'submitted' : 'failed',
    rail,
    feeAmount: preview.feeAmount,
    currency: input.currency,
  };
}

async function recordException(
  db: Db, executionRef: string, input: ExecuteBankTransferInput, errors: string[], now: Date,
): Promise<void> {
  const execution: PaymentExecutionProcedure = {
    paymentExecutionInstanceReference: executionRef,
    paymentOrderInstanceReference: executionRef,
    beneficiaryType: 'user',
    initiatorPartyReference: input.initiatorPartyRef,
    ...(input.merchantAgreementReference ? { merchantAgreementReference: input.merchantAgreementReference } : {}),
    ...buildRecipientSnapshot(input.destination),
    grossAmount: input.amount, netAmount: input.amount, feeAmount: 0, currency: input.currency,
    routingNote: 'Bank transfer blocked at rail validation',
    paymentExecutionStatus: 'exception',
    failureReason: errors.join('; '),
    initiatedAt: now,
    resolutionLog: [{ stepName: 'rail.validated', stepOutcome: 'failed', stepNote: errors.join('; '), stepDateTime: now }],
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: now, recordUpdatedDateTime: now, schemaVersion: 1,
  };
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).insertOne(execution);
}
