// v17.1/66: Unified bank-transfer service (ACH / SEPA / SWIFT).
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
import { screenTransfer, openTransferFraudCase, TransferScreeningResult } from './transferRiskGate';
import { RISK_HOLD_STEP } from './transferReview.service';
import { getPayoutAccount } from './payoutAccount.service';
import { holdCardFunds, releaseCardHold } from './payoutAccountBalance.service';
import { initiatePaymentAtBank, selectPaymentProduct } from '../../../providers/payment-initiation/services/bankcorePis.client';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';
import { config as appConfig } from '../../../config';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';

/**
 * Mask a bank account identifier (IBAN or domestic account number) for display storage.
 * Keeps the first 4 and last 4 characters, masks the middle with bullets: enough to recognise
 * and trace the destination without persisting the full number (PCI DSS).
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
  // Set by a caller that has already PROVEN the destination is another account of the initiator, by
  // resolving it from a reference scoped to their party. Never accepted from a client request body.
  sameOwnerDestination?: boolean;
  rail?: BankRail;                 // user override
  reference?: string;              // ISO 20022 remittance info
  fromAccountRef?: string;         // optional chosen source payout account ; validated for ownership
  recurring?: RecurringMandate;
  settlementSchedule?: 'T+0' | 'T+1' | 'T+2' | 'T+3';
  merchantAgreementReference?: string; // set when initiated via a merchant portal (OAuth on-behalf-of)
}

export interface ExecuteBankTransferResult {
  executionReference: string;
  status: 'submitted' | 'failed' | 'exception' | 'pending';
  rail?: BankRail;
  feeAmount?: number;
  currency: string;
  errors?: string[];
  holdReason?: string;             // set with status 'pending': held for investigation, not delivered
}

/**
 * Execute a bank transfer to a (registered or unregistered) external account.
 * Flow: validate via rail engine -> persist execution (routing) -> dispatch to the
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
  // A risk signal holds the transfer instead of rejecting it: the execution is parked in `pending` and
  // nothing is dispatched to the rail until the investigation closes (ADR-060).
  if (screen.hold) {
    // Immobilise the funds FIRST when the transfer is drawn from an internal account: a held movement
    // must have its money reserved, and `reverseHeldTransfer` releases exactly this hold on confirmed
    // fraud. Parking the execution without holding would make that reversal move money that was never
    // reserved. No source account (transfer not drawn from a PSP account) means nothing to hold.
    // The reservation is the bank's when the account is linked, and this path runs BEFORE the delegation is
    // resolved below, so it is resolved here too rather than holding a projection.
    const linkedSource = input.fromAccountRef
      ? await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION).findOne({
        payoutAccountInstanceReference: input.fromAccountRef,
        payoutAccountBankAccountReference: { $exists: true },
        payoutAccountConsentReference: { $exists: true },
      })
      : null;
    if (input.fromAccountRef && !(appConfig.bankcore.enabled && linkedSource)) {
      const held = await holdCardFunds(db, input.fromAccountRef, input.amount);
      if (!held) {
        const errors = ['Insufficient available balance to hold this transfer for review.'];
        await recordException(db, executionRef, input, errors, now);
        return { executionReference: executionRef, status: 'exception', rail, currency: input.currency, errors };
      }
    }
    // Compensation: a failure past the reservation must not leave the funds held with no execution.
    try {
      await recordRiskHold(db, executionRef, input, rail, screen, now);
    } catch (err) {
      if (input.fromAccountRef) {
        await releaseCardHold(db, input.fromAccountRef, input.amount).catch(() => { /* best effort */ });
      }
      console.error('[bank-transfer] could not persist the held execution; hold released:', err);
      const errors = ['Could not hold this transfer for review. No funds were moved.'];
      return { executionReference: executionRef, status: 'exception', rail, currency: input.currency, errors };
    }
    // Open an L1-reviewable fraud investigation case for the negative HRP/FDS/AML evaluation.
    await openTransferFraudCase(db, {
      transferRef: executionRef, initiatorPartyRef: input.initiatorPartyRef, indicators: screen.indicators,
      score: screen.score, amount: input.amount, currency: input.currency, kind: 'bank_transfer',
      beneficiaryLabel: input.destination.beneficiaryName,
    });
    emitComplianceEvent(db, {
      entityType: 'execution', entityId: executionRef,
      processType: 'payment_processing', processAction: 'transfer.held.for.review',
      processOutcome: 'pending',
      performedByPartyReference: input.initiatorPartyRef, performedByRole: 'customer',
      eventSummary: { amount: input.amount, currency: input.currency, rail, indicators: screen.indicators, score: screen.score },
      bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    });
    return { executionReference: executionRef, status: 'pending', rail, currency: input.currency, holdReason: screen.reason ?? 'Held for security review.' };
  }

  const destinationIban = input.destination.iban?.replace(/\s/g, '');
  // Whether the destination is one of the initiator's OWN accounts.
  //
  // Told to this service by the caller that RESOLVED it, not re-derived here, and that is not a matter of
  // trust: the same-owner route looks both accounts up by reference scoped to the caller's party, which is a
  // stronger proof than matching an IBAN. Re-deriving it here is also impossible without a schema change,
  // since `payoutAccountIban` is encrypted with no equality index and the driver refuses the query outright.
  //
  // Consequence, recorded rather than hidden: a same-owner transfer typed into the EXTERNAL form as raw
  // coordinates is not classified as same-owner. Fixing that needs an equality index on the PSP's IBAN.
  const sameOwner = input.sameOwnerDestination === true;

  // The debtor account, and whether the bank that holds it is the one that must execute (P5.1/P5.3).
  const sourceAccount = input.fromAccountRef
    ? await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ payoutAccountInstanceReference: input.fromAccountRef })
    : null;
  const delegateToBank = Boolean(
    appConfig.bankcore.enabled
    && sourceAccount?.payoutAccountBankAccountReference
    && sourceAccount?.payoutAccountAspspReference
    && sourceAccount?.payoutAccountConsentReference,
  );

  // 2. Persist the execution in routing state (append-only resolution log).
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
    // P5.5: a same-owner movement gets its own method rather than falling back to the P2P classification.
    // The fallback was silent, which is what made it wrong: nothing said the classification was a guess.
    ...(sameOwner ? { paymentExecutionMovementMethod: 'same_owner_transfer' } : {}),
    ...(delegateToBank ? { paymentExecutionDelegatedToAspsp: true } : {}),
    routingNote: `${appConfig.payout.sandbox ? '[sandbox] ' : ''}${input.reference ? `Bank transfer: ${input.reference}` : `Bank transfer via ${rail.toUpperCase()}`}`,
    // ISO 20022 remittance info: the clean concept/reference the user typed (queryable for AML/FDS).
    ...(input.reference ? { paymentExecutionRemittanceInformation: input.reference } : {}),
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

  // 3. Dispatch. As PISP to the bank holding the debtor account when there is one, otherwise through the
  //    built-in provider (ADR-039: provider-based, never a direct import). Destination coordinates stay
  //    transaction-scoped; only the PSP-opaque execution ref rides here.
  let submitted: boolean;
  let dispatchNote: string;
  let bankPaymentReference: string | undefined;

  if (delegateToBank && sourceAccount) {
    const initiated = await initiatePaymentAtBank({
      debtorAccount: sourceAccount,
      creditorIban: destinationIban ?? '',
      creditorName: input.destination.beneficiaryName?.trim() || 'Beneficiary',
      creditorAgentBic: input.destination.bic,
      amount: input.amount,
      currency: input.currency,
      remittanceInformation: input.reference,
      endToEndIdentification: executionRef,
      // The PSP picks the PRODUCT from the corridor; the bank picks the rail it actually executes on.
      product: selectPaymentProduct({
        currency: input.currency,
        creditorCountryCode: input.destination.countryCode,
      }),
    });
    submitted = Boolean(initiated.bankPaymentReference);
    bankPaymentReference = initiated.bankPaymentReference;
    dispatchNote = submitted
      ? `aspsp payment=${initiated.bankPaymentReference} status=${initiated.transactionStatus}`
      : `aspsp refused: ${initiated.error}`;
  } else {
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
    submitted = dispatch.status === 'sent' || dispatch.status === 'received';
    dispatchNote = `provider=${dispatch.provider} status=${dispatch.status}`;
  }

  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
    { paymentExecutionInstanceReference: executionRef },
    {
      $set: {
        paymentExecutionStatus: submitted ? 'in_flight' : 'failed',
        ...(bankPaymentReference ? { aspspPaymentReference: bankPaymentReference } : {}),
        recordUpdatedDateTime: new Date(),
      },
      $push: { resolutionLog: { stepName: 'provider.dispatch', stepOutcome: submitted ? 'found' : 'failed', stepNote: dispatchNote, stepDateTime: new Date() } },
    },
  );

  // 4. Audit (PCI DSS): business + compliance events share the execution ref as correlationId.
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
    // P5.6: a transfer between two accounts of the same beneficial owner has NO third party, so there is no
    // counterparty to screen and no payee to verify. Recording that explicitly is the point: reusing the
    // third-party pipeline would fabricate a screening result about someone who is not involved. Access
    // control and traceability still apply, which is why the event is emitted at all.
    eventSummary: {
      grossAmount: input.amount, currency: input.currency, rail, beneficiaryType: 'user',
      ...(sameOwner ? { sameBeneficialOwner: true, counterpartyScreening: 'not_applicable' } : {}),
    },
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

// Held for investigation: same immutable record as any other execution, parked in `pending` with the
// risk-hold step so only the resolution path can move it forward.
async function recordRiskHold(
  db: Db, executionRef: string, input: ExecuteBankTransferInput, rail: PaymentExecutionProcedure['paymentExecutionRail'],
  screen: TransferScreeningResult, now: Date,
): Promise<void> {
  const execution: PaymentExecutionProcedure = {
    paymentExecutionInstanceReference: executionRef,
    paymentOrderInstanceReference: executionRef,
    beneficiaryType: 'user',
    initiatorPartyReference: input.initiatorPartyRef,
    ...(input.merchantAgreementReference ? { merchantAgreementReference: input.merchantAgreementReference } : {}),
    ...(input.fromAccountRef ? { sourcePayoutAccountReference: input.fromAccountRef } : {}),
    ...buildRecipientSnapshot(input.destination),
    grossAmount: input.amount, netAmount: input.amount, feeAmount: 0, currency: input.currency,
    paymentExecutionRail: rail,
    routingNote: 'Bank transfer held for investigation by the pre-initiation risk gate',
    ...(input.reference ? { paymentExecutionRemittanceInformation: input.reference } : {}),
    paymentExecutionStatus: 'pending',
    initiatedAt: now,
    resolutionLog: [{ stepName: RISK_HOLD_STEP, stepOutcome: 'fallback', stepNote: screen.indicators.join(', ') || 'risk hold', stepDateTime: now }],
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: now, recordUpdatedDateTime: now, schemaVersion: 1,
  };
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).insertOne(execution);
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
