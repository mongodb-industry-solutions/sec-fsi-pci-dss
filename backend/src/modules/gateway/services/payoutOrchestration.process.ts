// BIAN SD-65/SD-66: Payout Orchestration Process (v17)
// Subscribes to card.payment.authorization.completed.
// Resolves beneficiary → validates account (AIS) → initiates transfer (PISP).
// On settlement: credits balance, marks transaction as settled.

import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent } from '../../../vendors/eventbus';
import { CARD_TRANSACTION_COLLECTION } from '../../transaction/models/cardTransaction.model';
import { PAYMENT_ORDER_COLLECTION } from '../models/paymentOrder.model';
import { MERCHANT_AGREEMENT_COLLECTION } from '../models/merchantAgreement.model';
import { createExecution, transitionExecution, appendResolutionStep, getExecution } from './paymentExecution.service';
import { getDefaultPayoutAccount } from './payoutAccount.service';
import { creditAvailable, debitPending, settleCardDebit } from './payoutAccountBalance.service';
import { validateAccount } from '../../../providers/account-information/services/accountInformation.service';
import { resolveAccountInformationConfig } from '../../../providers/account-information/services/accountInformation.service';
import { initiateTransfer, resolvePaymentInitiationConfig } from '../../../providers/payment-initiation/services/paymentInitiation.service';
import { getCapabilityModuleConfig } from '../../provider/services/capabilityModuleConfig.service';
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

    // Debit pending balance (funds held until settlement confirmed)
    await debitPending(db, payoutAccount.payoutAccountInstanceReference, amount);

    // Create execution record in 'routing' state
    const execution = await createExecution(db, {
      paymentOrderInstanceReference: txnId,
      cardTransactionInstanceReference: txnId,
      beneficiaryType: 'merchant',
      resolvedPayoutAccountReference: payoutAccount.payoutAccountInstanceReference,
      grossAmount: amount,
      netAmount: amount,
      feeAmount: 0,
      currency,
      paymentExecutionRail: payoutAccount.payoutAccountPreferredRail,
    });
    const execRef = execution.paymentExecutionInstanceReference;

    // AIS: validate the payout account
    const aisStoredConfig = await getCapabilityModuleConfig(db, 'account-information');
    const aisConfig = resolveAccountInformationConfig(aisStoredConfig?.moduleConfig as Record<string, unknown> | undefined);
    const aisResult = validateAccount(
      { payoutAccountInstanceReference: payoutAccount.payoutAccountInstanceReference, clientReference: execRef },
      payoutAccount,
      aisConfig,
    );

    await appendResolutionStep(db, execRef, {
      stepName: 'ais.account.validation',
      stepOutcome: aisResult.accountVerified ? 'found' : 'failed',
      stepNote: `status=${aisResult.accountStatus} verified=${aisResult.accountVerified}`,
    });

    if (!aisResult.accountVerified) {
      await transitionExecution(db, execRef, 'exception', { routingNote: 'AIS validation failed: account not verified' });
      return;
    }

    // Determine settlement schedule from merchant config
    const settlementSchedule: 'T+0' | 'T+1' | 'T+2' | 'T+3' =
      (await this.getMerchantSettlementSchedule(merchantRef)) ?? 'T+2';

    await transitionExecution(db, execRef, 'scheduled', { scheduledAt: new Date() });

    // PISP: initiate the bank transfer
    const pispStoredConfig = await getCapabilityModuleConfig(db, 'payment-initiation');
    const pispConfig = resolvePaymentInitiationConfig(pispStoredConfig?.moduleConfig as Record<string, unknown> | undefined);
    const pispResult = initiateTransfer(
      { clientReference: execRef, paymentExecutionInstanceReference: execRef, amount, currency, settlementSchedule },
      pispConfig,
    );

    await transitionExecution(db, execRef, 'in_flight', { initiatedAt: new Date(), paymentExecutionRail: payoutAccount.payoutAccountPreferredRail });
    await appendResolutionStep(db, execRef, {
      stepName: 'pisp.transfer.initiated',
      stepOutcome: 'found',
      stepNote: `railRef=${pispResult.railRef} delay=${pispResult.settlementDelayMs}ms`,
    });

    // Link execution to card transaction
    await db.collection(CARD_TRANSACTION_COLLECTION).updateOne(
      { cardTransactionInstanceReference: txnId },
      { $set: { paymentExecutionInstanceReference: execRef, recordUpdatedDateTime: new Date() } },
    );

    // Schedule the simulated settlement callback (mirrors payment-initiation controller logic)
    if (pispResult.settlementDelayMs >= 0) {
      const bus = this.bus;
      const corrId = execRef;
      setTimeout(() => {
        try {
          if (pispResult.willSucceed) {
            const settled: BankTransferSettled = {
              paymentExecutionInstanceReference: execRef,
              railRef: pispResult.railRef,
              completedAt: new Date().toISOString(),
              netAmount: amount,
              currency,
            };
            void bus.publish(makeEvent({
              eventType: 'bank.transfer.settled',
              businessProcess: 'payment_processing',
              correlationId: corrId,
              causationId: corrId,
              payload: settled,
            }));
          } else {
            const failed: BankTransferFailed = {
              paymentExecutionInstanceReference: execRef,
              errorCode: 'RAIL_FAILURE',
              errorReason: 'Simulated rail failure (alwaysSucceed=false)',
            };
            void bus.publish(makeEvent({
              eventType: 'bank.transfer.failed',
              businessProcess: 'payment_processing',
              correlationId: corrId,
              causationId: corrId,
              payload: failed,
            }));
          }
        } catch { /* bus may be stopping */ }
      }, pispResult.settlementDelayMs);
    }

    emitProcessEvent(db, {
      entityType: 'execution', entityId: execRef,
      processType: 'payment_processing', processAction: 'payout.execution.initiated',
      processOutcome: 'in_flight',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { txnId, merchantRef, payoutAccountRef: payoutAccount.payoutAccountInstanceReference, amount, currency, railRef: pispResult.railRef },
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

      // Credit available balance (move from pending to available)
      if (execution.resolvedPayoutAccountReference) {
        await creditAvailable(db, execution.resolvedPayoutAccountReference, p.netAmount);
      }

      // Mark card transaction as settled + clear cardholder pending hold (BIAN SD-66, PCI DSS Req 10)
      if (execution.cardTransactionInstanceReference) {
        await db.collection(CARD_TRANSACTION_COLLECTION).updateOne(
          { cardTransactionInstanceReference: execution.cardTransactionInstanceReference },
          { $set: { cardTransactionStatus: 'settled', recordUpdatedDateTime: new Date() } },
        );
        // Clear the pending hold on the cardholder's funding account now that settlement is confirmed
        void this.clearCardholderPendingHold(execution.cardTransactionInstanceReference, p.netAmount);
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
        eventSummary: { execRef, railRef: p.railRef, netAmount: p.netAmount, currency: p.currency },
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
  // At authorization, holdCardFunds moved amount from available → pending. Settlement finalizes the debit.
  private async clearCardholderPendingHold(txnId: string, amount: number): Promise<void> {
    const { PAYMENT_CARD_COLLECTION } = await import('../../customer/models/paymentCard.model');
    const txn = await this.db.collection<{ paymentCardInstanceReference?: string }>(CARD_TRANSACTION_COLLECTION)
      .findOne({ cardTransactionInstanceReference: txnId }, { projection: { paymentCardInstanceReference: 1 } });
    if (!txn?.paymentCardInstanceReference) return;
    const card = await this.db.collection<{ fundingPayoutAccountInstanceReference?: string }>(PAYMENT_CARD_COLLECTION)
      .findOne({ paymentCardInstanceReference: txn.paymentCardInstanceReference }, { projection: { fundingPayoutAccountInstanceReference: 1 } });
    if (!card?.fundingPayoutAccountInstanceReference) return;
    await settleCardDebit(this.db, card.fundingPayoutAccountInstanceReference, amount);
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
