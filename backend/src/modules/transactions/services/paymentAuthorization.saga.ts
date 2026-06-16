import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent } from '../../../vendors/eventbus';
import { completeAuthorized, declineTransaction } from './cardTransaction.service';

// Drives card-payment authorization off the event bus (dev.v8 F3): on the issuer outcome it finishes
// or declines the transaction, then publishes the terminal payment event the client/SSE waits on.
// F4 will extend this to aggregate fds + sanctions before deciding.
export class PaymentAuthorizationSaga {
  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('cardissuer.validation.completed', (e) => this.onIssuerCompleted(e));
  }

  private async onIssuerCompleted(e: DomainEvent): Promise<void> {
    const txnId = e.correlationId;
    const p = e.payload as { approved?: boolean; responseCode?: string; decisionReason?: string };
    const bian = { serviceDomain: 'SD-254 Card Transaction', controlRecord: 'CardTransactionRecord' };

    if (p.approved !== false) {
      const outcome = await completeAuthorized(this.db, txnId);
      void this.bus.publish(makeEvent({
        eventType: 'payment.authorized', correlationId: txnId, businessProcess: 'card_payment',
        causationId: e.eventId, source: 'saga.payment-authorization',
        payload: { transactionId: txnId, ...outcome }, bian,
      }));
    } else {
      await declineTransaction(this.db, txnId, p.decisionReason ?? 'card_issuer_declined', p.responseCode ?? 'declined');
      void this.bus.publish(makeEvent({
        eventType: 'payment.declined', correlationId: txnId, businessProcess: 'card_payment',
        causationId: e.eventId, source: 'saga.payment-authorization',
        payload: { transactionId: txnId, decisionReason: p.decisionReason, responseCode: p.responseCode }, bian,
      }));
    }
  }
}
