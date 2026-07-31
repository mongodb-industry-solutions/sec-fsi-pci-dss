// BIAN SD-65/SD-66: Payout Orchestration Process (v17)
// Subscribes to card.payment.authorization.completed.
// Resolves beneficiary → validates account (AIS) → initiates transfer (PISP).
// On settlement: credits balance, marks transaction as settled.

import { Db } from 'mongodb';
import { EventBus, DomainEvent } from '../../../vendors/eventbus';
import { CARD_TRANSACTION_COLLECTION } from '../../transaction/models/cardTransaction.model';
import { PAYMENT_ORDER_COLLECTION } from '../models/paymentOrder.model';
import { MERCHANT_AGREEMENT_COLLECTION } from '../models/merchantAgreement.model';
import { createExecution, transitionExecution, appendResolutionStep, getExecution, resolveMerchantFee } from './paymentExecution.service';
import { getDefaultPayoutAccount } from './payoutAccount.service';
import { creditAvailable, debitPending, settleCardDebit, creditDirect, releaseCardHold } from './payoutAccountBalance.service';
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
    let amountInAccountCcy = amount;
    if (payoutAccount.payoutAccountCurrency && payoutAccount.payoutAccountCurrency !== currency) {
      const { resolveAndConvert } = await import('../../../providers/currency-exchange/services/currencyExchange.service');
      try { amountInAccountCcy = (await resolveAndConvert(db, amount, currency, payoutAccount.payoutAccountCurrency)).amount; } catch { /* keep original on FX error */ }
    }
    await debitPending(db, payoutAccount.payoutAccountInstanceReference, amountInAccountCcy);

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
    const execRef = execution.paymentExecutionInstanceReference;

    // AIS: validate the payout account via the account_information provider (ADR-039).
    const aisDispatch = await dispatchProvider(
      db,
      'account_information',
      'provider.account_information.account.validation.requested',
      { payoutAccountInstanceReference: payoutAccount.payoutAccountInstanceReference, clientReference: execRef },
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
      await transitionExecution(db, execRef, 'exception', { routingNote: 'AIS validation failed: account not verified' });
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
      await transitionExecution(db, execRef, 'failed', { failureReason: `PISP dispatch ${pispDispatch.status}: ${pispDispatch.error ?? 'no submission'}` });
      await appendResolutionStep(db, execRef, { stepName: 'provider.payment_initiation.transfer', stepOutcome: 'failed', stepNote: `provider=${pispDispatch.provider} status=${pispDispatch.status}` });
      return;
    }

    await transitionExecution(db, execRef, 'in_flight', { initiatedAt: new Date(), paymentExecutionRail: payoutAccount.payoutAccountPreferredRail });
    await appendResolutionStep(db, execRef, {
      stepName: 'provider.payment_initiation.transfer',
      stepOutcome: 'found',
      stepNote: `provider=${pispDispatch.provider} railRef=${railRef}`,
    });

    // Link execution to card transaction
    await db.collection(CARD_TRANSACTION_COLLECTION).updateOne(
      { cardTransactionInstanceReference: txnId },
      { $set: { paymentExecutionInstanceReference: execRef, recordUpdatedDateTime: new Date() } },
    );

    emitProcessEvent(db, {
      entityType: 'execution', entityId: execRef,
      processType: 'payment_processing', processAction: 'payout.execution.initiated',
      processOutcome: 'in_flight',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { txnId, merchantRef, payoutAccountRef: payoutAccount.payoutAccountInstanceReference, amount, netAmount, feeAmount, currency, railRef },
      bianServiceDomain: 'SD-65 Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    });
  }

  private async onTransferSettled(e: DomainEvent): Promise<void> {
    const p = e.payload as unknown as BankTransferSettled;
    const execRef = p.paymentExecutionInstanceReference;
    const db = this.db;

    try {
      const execution = await getExecution(db, execRef);
      if (!execution) return;

      await transitionExecution(db, execRef, 'completed', { completedAt: new Date() });
      await appendResolutionStep(db, execRef, {
        stepName: 'bank.transfer.settled',
        stepOutcome: 'found',
        stepNote: `railRef=${p.railRef} netAmount=${p.netAmount} ${p.currency}`,
      });

      // Credit the recipient. Convert to the recipient account currency (FX). The amounts come from
      // OUR execution record, not from the rail payload, so the ledger always matches what we stored.
      if (execution.resolvedPayoutAccountReference) {
        const acct = await db.collection<{ payoutAccountCurrency?: string }>(PAYOUT_ACCOUNT_COLLECTION)
          .findOne({ payoutAccountInstanceReference: execution.resolvedPayoutAccountReference }, { projection: { payoutAccountCurrency: 1 } });
        const toAccountCcy = async (value: number) => {
          if (!acct?.payoutAccountCurrency || acct.payoutAccountCurrency === execution.currency) return value;
          const { resolveAndConvert } = await import('../../../providers/currency-exchange/services/currencyExchange.service');
          try { return (await resolveAndConvert(db, value, execution.currency, acct.payoutAccountCurrency)).amount; }
          catch { return value; /* keep original on FX error */ }
        };
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
              merchantReference: execution.fee?.feeMerchantReference ?? '',
              merchantAccountRef: execution.resolvedPayoutAccountReference,
              feeAmount: feeInAccountCcy,
              currency: acct?.payoutAccountCurrency ?? execution.currency,
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
        eventSummary: { execRef, railRef: p.railRef, grossAmount: execution.grossAmount, netAmount: execution.netAmount, feeAmount: execution.feeAmount ?? 0, currency: execution.currency },
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

      await transitionExecution(db, execRef, 'failed', { failureReason: `${p.errorCode}: ${p.errorReason}` });
      await appendResolutionStep(db, execRef, {
        stepName: 'bank.transfer.failed',
        stepOutcome: 'failed',
        stepNote: `errorCode=${p.errorCode} reason=${p.errorReason}`,
      });

      // P2P bank transfer: the rail rejected the payment — release the sender hold (pending -> available).
      if (execution.sourcePayoutAccountReference) {
        await releaseCardHold(db, execution.sourcePayoutAccountReference, execution.grossAmount ?? 0);
      }

      emitProcessEvent(db, {
        entityType: 'execution', entityId: execRef,
        processType: 'payment_processing', processAction: 'payout.execution.failed',
        processOutcome: 'failed',
        performedByPartyReference: null, performedByRole: null,
        eventSummary: { execRef, errorCode: p.errorCode, reason: p.errorReason },
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
    const account = await this.db.collection<{ payoutAccountCurrency?: string }>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ payoutAccountInstanceReference: accountRef }, { projection: { payoutAccountCurrency: 1 } });
    let heldAmount = amount;
    if (account?.payoutAccountCurrency && account.payoutAccountCurrency !== settlementCurrency) {
      const { resolveAndConvert } = await import('../../../providers/currency-exchange/services/currencyExchange.service');
      try { heldAmount = (await resolveAndConvert(this.db, amount, settlementCurrency, account.payoutAccountCurrency)).amount; }
      catch { /* keep original on FX error */ }
    }
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
