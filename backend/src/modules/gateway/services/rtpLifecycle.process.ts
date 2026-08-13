// v28 RTP lifecycle saga. Projects payment-execution settlement back onto the linked RTP request and
// runs the expiry sweeper. Subscribes to the SAME bank.transfer.settled/failed milestones that
// PayoutOrchestrationProcess consumes (both subscribers react independently). The request is the
// system of record for INTENT; the execution is the system of record for MONEY (kept separate).
import { Db } from 'mongodb';
import type { EventBus, DomainEvent } from '../../../vendors/eventbus';
import {
  PAYMENT_REQUEST_COLLECTION,
  PaymentRequestProcedure,
} from '../models/paymentRequest.model';
import { transitionRequest } from './rtpRequest.service';
import { EXPIRABLE_STATUSES } from './rtpStateMachine';
import { createNotification } from '../../notification/notifications.service';

export class RtpLifecycleProcess {
  private sweeper?: ReturnType<typeof setInterval>;

  constructor(private readonly db: Db, private readonly bus: EventBus, private readonly sweepMs = 60000) {}

  register(): void {
    this.bus.subscribe('bank.transfer.settled', (e) => this.onSettled(e));
    this.bus.subscribe('bank.transfer.failed', (e) => this.onFailed(e));
    // A held approval is moved forward by the investigation outcome, not by the payer (ADR-061).
    this.bus.subscribe('transfer.hold.released', (e) => this.onHoldReleased(e));
    this.bus.subscribe('transfer.hold.reversed', (e) => this.onFailed(e));
    // Expiry sweeper: transition lapsed requests to `expired` with an auditable event (not just TTL).
    if (this.sweepMs > 0) {
      this.sweeper = setInterval(() => { void this.sweepExpired(); }, this.sweepMs);
      if (typeof this.sweeper.unref === 'function') this.sweeper.unref();
    }
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  private async findByExecution(execRef: string): Promise<PaymentRequestProcedure | null> {
    return this.db.collection<PaymentRequestProcedure>(PAYMENT_REQUEST_COLLECTION)
      .findOne({ linkedPaymentExecutionReference: execRef });
  }

  private async onSettled(e: DomainEvent): Promise<void> {
    const p = e.payload as { paymentExecutionInstanceReference?: string };
    const execRef = p.paymentExecutionInstanceReference ?? e.correlationId;
    const req = await this.findByExecution(execRef);
    if (!req || req.status === 'payment_settled') return;
    try {
      await transitionRequest(this.db, req.paymentRequestInstanceReference, 'payment_settled', {
        action: 'rtp.payment.settled', outcome: 'settled', summary: 'Payment settled; funds credited to payee',
      });
      await createNotification(this.db, {
        recipientPartyReference: req.requesterPartyReference, notificationType: 'payment_request',
        title: 'Payment received', detail: `You received ${req.amount} ${req.currency}`,
        href: `/system/payment/history/${req.paymentRequestInstanceReference}`,
        relatedReference: req.paymentRequestInstanceReference, actionable: false,
      });
    } catch { /* transition may race; idempotent no-op */ }
  }

  // Investigation cleared a held approval: the transfer went to the rail, so the request is initiated.
  private async onHoldReleased(e: DomainEvent): Promise<void> {
    const p = e.payload as { executionRef?: string; paymentExecutionInstanceReference?: string };
    const execRef = p.paymentExecutionInstanceReference ?? p.executionRef ?? e.correlationId;
    const req = await this.findByExecution(execRef);
    if (!req || req.status !== 'accepted') return;
    try {
      await transitionRequest(this.db, req.paymentRequestInstanceReference, 'payment_initiated', {
        action: 'rtp.payment.initiated', outcome: 'submitted', summary: 'Security review cleared; payment sent to the rail',
        meta: { executionReference: execRef },
      });
    } catch { /* idempotent */ }
  }

  private async onFailed(e: DomainEvent): Promise<void> {
    const p = e.payload as { paymentExecutionInstanceReference?: string };
    const execRef = p.paymentExecutionInstanceReference ?? e.correlationId;
    const req = await this.findByExecution(execRef);
    if (!req || req.status === 'payment_failed') return;
    try {
      await transitionRequest(this.db, req.paymentRequestInstanceReference, 'payment_failed', {
        action: 'rtp.payment.failed', outcome: 'failed', summary: 'Payment failed; hold released',
      });
      await createNotification(this.db, {
        recipientPartyReference: req.requesterPartyReference, notificationType: 'payment_request',
        title: 'Payment failed', detail: `Your request for ${req.amount} ${req.currency} could not be settled`,
        href: `/system/payment/history/${req.paymentRequestInstanceReference}`,
        relatedReference: req.paymentRequestInstanceReference, actionable: false,
      });
    } catch { /* idempotent */ }
  }

  // Transition presented/delivered/viewed requests past expiresAt → expired (auditable transition).
  async sweepExpired(): Promise<number> {
    const now = new Date();
    const due = await this.db.collection<PaymentRequestProcedure>(PAYMENT_REQUEST_COLLECTION)
      .find({ status: { $in: EXPIRABLE_STATUSES }, expiresAt: { $lt: now } }).limit(200).toArray();
    let n = 0;
    for (const req of due) {
      try {
        await transitionRequest(this.db, req.paymentRequestInstanceReference, 'expired', {
          action: 'rtp.request.expired', outcome: 'rejected', summary: 'Request expired',
        });
        n++;
      } catch { /* skip on race */ }
    }
    return n;
  }
}
