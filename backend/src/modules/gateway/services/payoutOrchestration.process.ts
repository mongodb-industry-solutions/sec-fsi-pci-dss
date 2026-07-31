// BIAN SD-65/SD-66: Payout Orchestration Process (v17)
// Subscribes to card.payment.authorization.completed.
// Resolves beneficiary → validates account (AIS) → initiates transfer (PISP).
// On settlement: credits balance, marks transaction as settled.

import { Db } from 'mongodb';
import { EventBus, DomainEvent } from '../../../vendors/eventbus';
import { CARD_TRANSACTION_COLLECTION } from '../../transaction/models/cardTransaction.model';
import { PAYMENT_ORDER_COLLECTION } from '../models/paymentOrder.model';
import type { PaymentExecutionStatus } from '../models/paymentExecution.model';
import { MERCHANT_AGREEMENT_COLLECTION } from '../models/merchantAgreement.model';
import { createExecution, transitionExecution, appendResolutionStep, getExecution, resolveMerchantFee } from './paymentExecution.service';
import { getDefaultPayoutAccount } from './payoutAccount.service';
import { creditAvailable, debitPending, settleCardDebit, creditDirect, releaseCardHold, releasePendingCredit } from './payoutAccountBalance.service';
import { postCommission } from './commissionSettlement.service';
// ADR-039: AIS + PISP are reached ONLY through dispatchProvider (never a direct builtin import),
// so an external provider can replace the builtin module without changing this flow.
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitProcessEvent } from '../../provider/services/businessProcessEvent.service';
import type { BankTransferSettled, BankTransferFailed } from '../../../shared/models/events/payoutOrchestration.events';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';

export class PayoutOrchestrationProcess {
  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('card.payment.authorization.completed', (e) => this.onAuthorized(e));
    this.bus.subscribe('bank.transfer.settled', (e) => this.onTransferSettled(e));
    this.bus.subscribe('bank.transfer.failed', (e) => this.onTransferFailed(e));
  }

  private async onAuthorized(e: DomainEvent): Promise<void> {
    const p = e.payload as { outcome?: string };
    if (p.outcome === 'declined') return;

    const txnId = e.correlationId;

    try {
      await this.triggerPayout(txnId);
    } catch (err) {
      // Payout failure never rolls back the authorized payment
      console.error(`[payout-orch] Failed to trigger payout for txn ${txnId}:`, err);
    }
  }

  private async accountCurrency(payoutAccountRef: string): Promise<string | undefined> {
    const acct = await this.db.collection<{ payoutAccountCurrency?: string }>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ payoutAccountInstanceReference: payoutAccountRef }, { projection: { payoutAccountCurrency: 1 } });
    return acct?.payoutAccountCurrency;
  }

  // Single FX entry point for this process: the ledger is only ever mutated in the account currency,
  // so every balance movement converts through here. A missing rate keeps the original amount.
  private async convert(value: number, from: string, to?: string): Promise<number> {
    if (!to || to === from) return value;
    const { resolveAndConvert } = await import('../../../providers/currency-exchange/services/currencyExchange.service');
    try { return (await resolveAndConvert(this.db, value, from, to)).amount; }
    catch { return value; /* keep original on FX error */ }
  }

  // Compensating action of the payout saga (EDA): a payout that will never settle must not leave the
  // beneficiary holding an expected credit. Moves the SD-65 control record to its terminal state, then
  // releases the reservation taken at authorization and records both in the resolution log and on the
  // event stream (PCI DSS Req 10).
  //
  // Provider-indifferent by construction: it is driven by the OUTCOME of a dispatch, never by which
  // provider produced it, so replacing the builtin AIS/PISP module with an external service (ADR-039)
  // cannot leave the ledger inconsistent. A refusal, a transport error and a timeout all land here.
  //
  // Idempotent: the state transition is the gate. `transitionExecution` reports whether THIS call
  // performed the change, so a replay or a retry can never release the same reservation twice.
  private async abortPayout(input: {
    execRef: string;
    status: Extract<PaymentExecutionStatus, 'exception' | 'failed'>;
    reason: string;
    payoutAccountRef?: string;
    heldAmount?: number;
    merchantRef?: string;
    txnId?: string;
  }): Promise<void> {
    const db = this.db;
    const patch = input.status === 'exception' ? { routingNote: input.reason } : { failureReason: input.reason };
    const transitioned = await transitionExecution(db, input.execRef, input.status, patch);
    if (!transitioned) return; // already terminal — a previous run already compensated
    if (!input.payoutAccountRef || !(input.heldAmount && input.heldAmount > 0)) return;

    const released = await releasePendingCredit(db, input.payoutAccountRef, input.heldAmount);
    await appendResolutionStep(db, input.execRef, {
      stepName: 'payout.hold.released',
      stepOutcome: released ? 'found' : 'failed',
      stepNote: `pendingAmount -= ${input.heldAmount} on ${input.payoutAccountRef} (${input.reason})`,
    });
    emitProcessEvent(db, {
      entityType: 'execution', entityId: input.execRef,
      processType: 'payment_processing', processAction: 'payout.hold.released',
      // The BIAN control-record state ('exception' / 'failed') is not an event outcome: an unusable
      // beneficiary is a rejection. The state itself is carried in the summary below.
      processOutcome: input.status === 'exception' ? 'rejected' : 'failed',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: {
        execRef: input.execRef, txnId: input.txnId, merchantRef: input.merchantRef,
        payoutAccountRef: input.payoutAccountRef, releasedAmount: input.heldAmount,
        executionStatus: input.status, reason: input.reason, released,
      },
      bianServiceDomain: 'SD-66 Payout Account Arrangement', bianControlRecordType: 'PayoutAccountBalance',
    });
  }

  private async triggerPayout(txnId: string): Promise<void> {
    const db = this.db;

    // Look up transaction to get merchant reference and amount
    const txn = await db.collection<{
      cardTransactionInstanceReference: string;
      merchantAgreementInstanceReference?: string;
      cardTransactionAmount?: { amount: number; currency: string };
      cardTransactionStatus?: string;
    }>(CARD_TRANSACTION_COLLECTION).findOne(
      { cardTransactionInstanceReference: txnId },
      { projection: { _id: 0, cardTransactionInstanceReference: 1, merchantAgreementInstanceReference: 1, cardTransactionAmount: 1, cardTransactionStatus: 1 } },
    );
    if (!txn) return;

    const merchantRef = txn.merchantAgreementInstanceReference;
    if (!merchantRef) return;

    const amount = txn.cardTransactionAmount?.amount ?? 0;
    const currency = txn.cardTransactionAmount?.currency ?? 'USD';

    // Find merchant's default payout account (PSP internal ledger)
    const merchant = await db.collection<{
      merchantAgreementInstanceReference: string;
      merchantOwnerPartyReference?: string;
      merchantDefaultPayoutAccountReference?: string;
    }>(MERCHANT_AGREEMENT_COLLECTION).findOne(
      { merchantAgreementInstanceReference: merchantRef },
      { projection: { _id: 0, merchantOwnerPartyReference: 1, merchantDefaultPayoutAccountReference: 1 } },
    );
    if (!merchant) return;

    let payoutAccount: PayoutAccountArrangement | null = null;

    // Prefer the explicit default payout account reference on the merchant record
    if (merchant.merchantDefaultPayoutAccountReference) {
      payoutAccount = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
        .findOne({ payoutAccountInstanceReference: merchant.merchantDefaultPayoutAccountReference });
    }

    // Fall back to looking up by party reference
    if (!payoutAccount && merchant.merchantOwnerPartyReference) {
      payoutAccount = await getDefaultPayoutAccount(db, merchant.merchantOwnerPartyReference);
    }

    if (!payoutAccount) {
      // No payout account configured — create exception execution
      await this.createExceptionExecution(txnId, merchantRef, amount, currency, 'no_payout_account');
      return;
    }

    // Debit pending balance (funds held until settlement confirmed). Convert to the merchant account
    // currency (FX) so the merchant ledger is always mutated in its own currency.
    const amountInAccountCcy = await this.convert(amount, currency, payoutAccount.payoutAccountCurrency);
    await debitPending(db, payoutAccount.payoutAccountInstanceReference, amountInAccountCcy);

    // Everything past the reservation is wrapped: an unexpected failure (a provider throwing, a
    // timeout, a database error) must never leave the merchant holding an amount that will not
    // settle. `execRef` is declared here so the compensation can reach the control record.
    let execRef: string | undefined;
    // Once the rail has accepted the transfer, the reservation is no longer ours to release: the rail
    // will report settled or failed, and those handlers own the outcome. Releasing it here as well
    // would double-reverse and drive pendingAmount negative on a later settlement.
    let handedToRail = false;
    try {
      // Merchant commission (SD-89): the buyer paid the gross, so the fee is WITHHELD here, not added.
      // The PSP remits netAmount to the merchant and keeps feeAmount (posted to its revenue account at
      // settlement). No rate configured yields feeAmount 0 and netAmount == grossAmount.
      const { feeAmount, netAmount, fee } = await resolveMerchantFee(db, merchantRef, amount, currency);

      // Create execution record in 'routing' state
      const execution = await createExecution(db, {
        paymentOrderInstanceReference: txnId,
        cardTransactionInstanceReference: txnId,
        beneficiaryType: 'merchant',
        resolvedPayoutAccountReference: payoutAccount.payoutAccountInstanceReference,
        grossAmount: amount,
        netAmount,
        feeAmount,
        fee,
        currency,
        paymentExecutionRail: payoutAccount.payoutAccountPreferredRail,
      });
      execRef = execution.paymentExecutionInstanceReference;

      // Link the execution to the card transaction NOW, not after the rail accepts: the payout may end
      // in exception or failed, and the audit trail must still be reachable from the transaction id.
      await db.collection(CARD_TRANSACTION_COLLECTION).updateOne(
        { cardTransactionInstanceReference: txnId },
        { $set: { paymentExecutionInstanceReference: execRef, recordUpdatedDateTime: new Date() } },
      );

      // AIS: validate the payout account via the account_information provider (ADR-039).
      // cardTransactionInstanceReference travels in the payload as the end-to-end reference, so the
      // sanitized wire log is findable by transaction id whichever provider served the call.
      const aisDispatch = await dispatchProvider(
        db,
        'account_information',
        'provider.account_information.account.validation.requested',
        {
          payoutAccountInstanceReference: payoutAccount.payoutAccountInstanceReference,
          clientReference: execRef,
          cardTransactionInstanceReference: txnId,
        },
        { entityType: 'execution', entityId: execRef, processType: 'payment_processing' },
      );
      const aisBody = (aisDispatch.responseBody ?? {}) as { accountVerified?: boolean; accountStatus?: string };
      const accountVerified = aisBody.accountVerified === true;

      await appendResolutionStep(db, execRef, {
        stepName: 'provider.account_information.validation',
        stepOutcome: accountVerified ? 'found' : 'failed',
        stepNote: `provider=${aisDispatch.provider} status=${aisBody.accountStatus ?? aisDispatch.status} verified=${accountVerified}`,
      });

      if (!accountVerified) {
        // The beneficiary account is not usable, so the reservation taken above must go back: the
        // merchant would otherwise keep an incoming credit that can never settle.
        await this.abortPayout({
          execRef, status: 'exception',
          reason: `AIS validation failed: account not verified (provider=${aisDispatch.provider} status=${aisBody.accountStatus ?? aisDispatch.status})`,
          payoutAccountRef: payoutAccount.payoutAccountInstanceReference,
          heldAmount: amountInAccountCcy, merchantRef, txnId,
        });
        return;
      }

      // Determine settlement schedule from merchant config
      const settlementSchedule: 'T+0' | 'T+1' | 'T+2' | 'T+3' =
        (await this.getMerchantSettlementSchedule(merchantRef)) ?? 'T+2';

      await transitionExecution(db, execRef, 'scheduled', { scheduledAt: new Date() });

      // PISP: initiate the bank transfer via the payment_initiation provider (ADR-039). The builtin
      // module (or an external PISP) emits bank.transfer.settled/failed on the bus after T+N; this
      // process consumes those below. No settlement timer lives here anymore.
      const pispDispatch = await dispatchProvider(
        db,
        'payment_initiation',
        'provider.payment_initiation.transfer.requested',
        {
          clientReference: execRef,
          paymentExecutionInstanceReference: execRef,
          // End-to-end reference (ISO 20022 EndToEndId in a real rail): keeps the PISP wire log
          // correlated to the originating acquiring transaction.
          cardTransactionInstanceReference: txnId,
          railType: payoutAccount.payoutAccountPreferredRail,
          // The rail moves what the merchant is owed, i.e. the net. The commission never leaves the PSP.
          amount: netAmount,
          currency,
          settlementSchedule,
          paymentReference: `Merchant settlement ${merchantRef}`,
        },
        { entityType: 'execution', entityId: execRef, processType: 'payment_processing' },
      );
      const railRef = (pispDispatch.responseBody as { railRef?: string } | undefined)?.railRef ?? '';
      const submitted = pispDispatch.status === 'sent' || pispDispatch.status === 'received';

      if (!submitted) {
        // Nothing was handed to the rail (refusal, transport error or timeout, whichever provider is
        // wired), so the reservation is released too.
        await appendResolutionStep(db, execRef, { stepName: 'provider.payment_initiation.transfer', stepOutcome: 'failed', stepNote: `provider=${pispDispatch.provider} status=${pispDispatch.status}` });
        await this.abortPayout({
          execRef, status: 'failed',
          reason: `PISP dispatch ${pispDispatch.status}: ${pispDispatch.error ?? 'no submission'}`,
          payoutAccountRef: payoutAccount.payoutAccountInstanceReference,
          heldAmount: amountInAccountCcy, merchantRef, txnId,
        });
        return;
      }

      handedToRail = true;
      await transitionExecution(db, execRef, 'in_flight', { initiatedAt: new Date(), paymentExecutionRail: payoutAccount.payoutAccountPreferredRail });
      await appendResolutionStep(db, execRef, {
        stepName: 'provider.payment_initiation.transfer',
        stepOutcome: 'found',
        stepNote: `provider=${pispDispatch.provider} railRef=${railRef}`,
      });

      emitProcessEvent(db, {
        entityType: 'execution', entityId: execRef,
        processType: 'payment_processing', processAction: 'payout.execution.initiated',
        processOutcome: 'in_flight',
        performedByPartyReference: null, performedByRole: null,
        eventSummary: { txnId, merchantRef, payoutAccountRef: payoutAccount.payoutAccountInstanceReference, amount, netAmount, feeAmount, currency, railRef },
        bianServiceDomain: 'SD-65 Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
      });
    } catch (err) {
      // Compensate, then rethrow: onAuthorized logs it and the authorized payment is never rolled back.
      const reason = `payout pipeline error: ${(err as Error).message}`;
      if (handedToRail) {
        // In flight: the transfer is with the rail, so only the record is annotated. The reservation
        // stays until bank.transfer.settled/failed decides its fate.
        if (execRef) {
          await appendResolutionStep(db, execRef, {
            stepName: 'payout.pipeline.error', stepOutcome: 'failed',
            stepNote: `${reason} (in flight: reservation kept, awaiting rail outcome)`,
          });
        }
        throw err;
      }
      if (execRef) {
        await this.abortPayout({
          execRef, status: 'exception', reason,
          payoutAccountRef: payoutAccount.payoutAccountInstanceReference,
          heldAmount: amountInAccountCcy, merchantRef, txnId,
        });
      } else {
        // The failure happened before the control record existed: release the reservation directly.
        await releasePendingCredit(db, payoutAccount.payoutAccountInstanceReference, amountInAccountCcy);
      }
      throw err;
    }
  }

  private async onTransferSettled(e: DomainEvent): Promise<void> {
    const p = e.payload as unknown as BankTransferSettled;
    const execRef = p.paymentExecutionInstanceReference;
    const db = this.db;

    try {
      const execution = await getExecution(db, execRef);
      if (!execution) return;

      // The state transition is the idempotency gate for every balance movement below: a redelivered
      // bank.transfer.settled must not credit the same settlement twice.
      const transitioned = await transitionExecution(db, execRef, 'completed', { completedAt: new Date() });
      await appendResolutionStep(db, execRef, {
        stepName: 'bank.transfer.settled',
        stepOutcome: 'found',
        stepNote: `railRef=${p.railRef} netAmount=${p.netAmount} ${p.currency}`,
      });
      if (!transitioned) return;

      // Credit the recipient. Convert to the recipient account currency (FX). The amounts come from
      // OUR execution record, not from the rail payload, so the ledger always matches what we stored.
      if (execution.resolvedPayoutAccountReference) {
        const accountCcy = await this.accountCurrency(execution.resolvedPayoutAccountReference);
        const toAccountCcy = (value: number) => this.convert(value, execution.currency, accountCcy);
        const creditAmount = await toAccountCcy(execution.netAmount);
        if (execution.sourcePayoutAccountReference) {
          // P2P bank transfer: clear the sender's hold (pending -= gross) then credit the recipient.
          await settleCardDebit(db, execution.sourcePayoutAccountReference, execution.grossAmount ?? execution.netAmount);
          await creditDirect(db, execution.resolvedPayoutAccountReference, creditAmount);
        } else {
          // Merchant settlement: pending was debited at authorization — move pending -> available.
          await creditAvailable(db, execution.resolvedPayoutAccountReference, creditAmount);
          // Second leg of the commission: withhold the fee from the same hold and credit the PSP.
          // Derived as grossConverted − netConverted (not converted on its own) so the pending hold,
          // which was taken on the gross, clears to exactly zero whatever the FX rounding.
          if ((execution.feeAmount ?? 0) > 0) {
            const feeInAccountCcy = Math.round(((await toAccountCcy(execution.grossAmount)) - creditAmount) * 100) / 100;
            const { outcome } = await postCommission(db, {
              executionRef: execRef,
              cardTransactionRef: execution.cardTransactionInstanceReference,
              merchantReference: execution.fee?.feeMerchantReference ?? '',
              merchantAccountRef: execution.resolvedPayoutAccountReference,
              feeAmount: feeInAccountCcy,
              currency: accountCcy ?? execution.currency,
              feeRateApplied: execution.fee?.feeRateApplied,
            });
            // The commission could not be collected (revenue ledger not provisioned). The hold was
            // taken on the gross, so leaving it there would strand the fee in pendingAmount forever.
            // Release it to the merchant instead: the PSP forgoes the fee rather than holding money
            // that belongs to nobody. 'already_collected' needs nothing — an earlier run withheld it.
            if (outcome === 'no_revenue_account') {
              await creditAvailable(db, execution.resolvedPayoutAccountReference, feeInAccountCcy);
            }
          }
        }
      }

      // Mark card transaction as settled + clear cardholder pending hold (BIAN SD-66, PCI DSS Req 10)
      if (execution.cardTransactionInstanceReference) {
        await db.collection(CARD_TRANSACTION_COLLECTION).updateOne(
          { cardTransactionInstanceReference: execution.cardTransactionInstanceReference },
          { $set: { cardTransactionStatus: 'settled', recordUpdatedDateTime: new Date() } },
        );
        // Clear the pending hold on the cardholder's funding account now that settlement is confirmed.
        // The buyer was held the GROSS amount, so the commission must not shrink what is released.
        void this.clearCardholderPendingHold(execution.cardTransactionInstanceReference, execution.grossAmount, execution.currency);
      }

      // Mark the linked payment order as settled (if any)
      await db.collection(PAYMENT_ORDER_COLLECTION).updateOne(
        { $or: [
          { paymentOrderExecutionReference: execRef },
          { linkedCardTransactionReference: execution.cardTransactionInstanceReference },
        ]},
        { $set: { paymentOrderStatus: 'settled', paymentOrderSettledDateTime: new Date(), recordUpdatedDateTime: new Date() } },
      );

      emitProcessEvent(db, {
        entityType: 'execution', entityId: execRef,
        processType: 'payment_processing', processAction: 'payout.execution.completed',
        processOutcome: 'settled',
        performedByPartyReference: null, performedByRole: null,
        // txnId in the summary: the audit trail's deep reference match finds this event by the
        // originating transaction id, not only by the execution reference.
        eventSummary: { execRef, txnId: execution.cardTransactionInstanceReference, railRef: p.railRef, grossAmount: execution.grossAmount, netAmount: execution.netAmount, feeAmount: execution.feeAmount ?? 0, currency: execution.currency },
        bianServiceDomain: 'SD-65 Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
      });
    } catch (err) {
      console.error(`[payout-orch] Error processing bank.transfer.settled for exec ${execRef}:`, err);
    }
  }

  private async onTransferFailed(e: DomainEvent): Promise<void> {
    const p = e.payload as unknown as BankTransferFailed;
    const execRef = p.paymentExecutionInstanceReference;
    const db = this.db;

    try {
      const execution = await getExecution(db, execRef);
      if (!execution) return;

      // The state transition is the idempotency gate for the reversal below: a redelivered
      // bank.transfer.failed must not reverse the same reservation twice.
      const transitioned = await transitionExecution(db, execRef, 'failed', { failureReason: `${p.errorCode}: ${p.errorReason}` });
      await appendResolutionStep(db, execRef, {
        stepName: 'bank.transfer.failed',
        stepOutcome: 'failed',
        stepNote: `errorCode=${p.errorCode} reason=${p.errorReason}`,
      });
      if (!transitioned) return;

      // The rail rejected the payment. Which reversal applies depends on whose funds were reserved:
      // a P2P sender gets its OWN money back (pending -> available), whereas a merchant beneficiary
      // was only promised an incoming credit that now will not arrive (pending -> nothing). Crediting
      // the merchant here would invent money the rail never moved.
      if (execution.sourcePayoutAccountReference) {
        await releaseCardHold(db, execution.sourcePayoutAccountReference, execution.grossAmount ?? 0);
      } else if (execution.resolvedPayoutAccountReference) {
        const heldAmount = await this.convert(
          execution.grossAmount ?? 0, execution.currency,
          await this.accountCurrency(execution.resolvedPayoutAccountReference),
        );
        const released = await releasePendingCredit(db, execution.resolvedPayoutAccountReference, heldAmount);
        await appendResolutionStep(db, execRef, {
          stepName: 'payout.hold.released',
          stepOutcome: released ? 'found' : 'failed',
          stepNote: `pendingAmount -= ${heldAmount} on ${execution.resolvedPayoutAccountReference} (rail rejected: ${p.errorCode})`,
        });
      }

      emitProcessEvent(db, {
        entityType: 'execution', entityId: execRef,
        processType: 'payment_processing', processAction: 'payout.execution.failed',
        processOutcome: 'failed',
        performedByPartyReference: null, performedByRole: null,
        eventSummary: { execRef, txnId: execution.cardTransactionInstanceReference, errorCode: p.errorCode, reason: p.errorReason },
        bianServiceDomain: 'SD-65 Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
      });
    } catch (err) {
      console.error(`[payout-orch] Error processing bank.transfer.failed for exec ${execRef}:`, err);
    }
  }

  private async createExceptionExecution(
    txnId: string,
    merchantRef: string,
    amount: number,
    currency: string,
    reason: string,
  ): Promise<void> {
    const execution = await createExecution(this.db, {
      paymentOrderInstanceReference: txnId,
      cardTransactionInstanceReference: txnId,
      beneficiaryType: 'merchant',
      grossAmount: amount,
      netAmount: amount,
      feeAmount: 0,
      currency,
    });
    await transitionExecution(this.db, execution.paymentExecutionInstanceReference, 'exception', {
      routingNote: reason,
    });
    await appendResolutionStep(this.db, execution.paymentExecutionInstanceReference, {
      stepName: 'beneficiary.resolution',
      stepOutcome: 'not_found',
      stepNote: `No eligible payout account for merchant ${merchantRef}: ${reason}`,
    });
    // No reservation was taken on this path (no account to reserve against), but the outcome still has
    // to be reachable from the transaction: link the record and put the exception on the event stream.
    await this.db.collection(CARD_TRANSACTION_COLLECTION).updateOne(
      { cardTransactionInstanceReference: txnId },
      { $set: { paymentExecutionInstanceReference: execution.paymentExecutionInstanceReference, recordUpdatedDateTime: new Date() } },
    );
    emitProcessEvent(this.db, {
      entityType: 'execution', entityId: execution.paymentExecutionInstanceReference,
      processType: 'payment_processing', processAction: 'payout.execution.exception',
      processOutcome: 'rejected',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { execRef: execution.paymentExecutionInstanceReference, txnId, merchantRef, amount, currency, reason },
      bianServiceDomain: 'SD-65 Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    });
  }

  // On settlement, clear the pending hold on the cardholder's funding payout account.
  // At authorization, the funds gate (holdCardFunds) moved amount available → pending IN THE ACCOUNT
  // CURRENCY. Settlement finalizes that same debit, so we convert the settlement amount back to the
  // funding-account currency (FX) before clearing pending — otherwise a mismatched-currency hold would
  // never fully clear. Same static rate table → the cleared amount matches the held amount exactly.
  private async clearCardholderPendingHold(txnId: string, amount: number, settlementCurrency: string): Promise<void> {
    const { PAYMENT_CARD_COLLECTION } = await import('../../customer/models/paymentCard.model');
    const txn = await this.db.collection<{ paymentCardInstanceReference?: string }>(CARD_TRANSACTION_COLLECTION)
      .findOne({ cardTransactionInstanceReference: txnId }, { projection: { paymentCardInstanceReference: 1 } });
    if (!txn?.paymentCardInstanceReference) return;
    const card = await this.db.collection<{ fundingPayoutAccountInstanceReference?: string }>(PAYMENT_CARD_COLLECTION)
      .findOne({ paymentCardInstanceReference: txn.paymentCardInstanceReference }, { projection: { fundingPayoutAccountInstanceReference: 1 } });
    if (!card?.fundingPayoutAccountInstanceReference) return;
    const accountRef = card.fundingPayoutAccountInstanceReference;
    const heldAmount = await this.convert(amount, settlementCurrency, await this.accountCurrency(accountRef));
    await settleCardDebit(this.db, accountRef, heldAmount);
  }

  private async getMerchantSettlementSchedule(merchantRef: string): Promise<'T+0' | 'T+1' | 'T+2' | 'T+3'> {
    const merchant = await this.db.collection<{
      merchantSettlementSchedule?: string;
    }>(MERCHANT_AGREEMENT_COLLECTION).findOne(
      { merchantAgreementInstanceReference: merchantRef },
      { projection: { _id: 0, merchantSettlementSchedule: 1 } },
    );
    const sched = merchant?.merchantSettlementSchedule;
    if (sched === 'T+0' || sched === 'T+1' || sched === 'T+2' || sched === 'T+3') return sched;
    return 'T+2';
  }
}
