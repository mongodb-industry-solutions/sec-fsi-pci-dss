// §8 / §7.8 CHD retention: the encrypted `chd` rides ONLY on card.issuer.validation.requested and is
// kept temporarily + encrypted. When the journey reaches its terminal card.payment.authorization.
// completed, the carrier's `chd` is purged in place ($unset) so SAD/CVV is never retained after
// authorization (PCI Req 3.2); a periodic safety sweep purges abandoned carriers. This is a FIELD
// $unset, never a document delete — the trail record is kept (CHD-free).
import { Db } from 'mongodb';
import { EventBus, DomainEvent, DOMAIN_EVENT_COLLECTION } from '../../../vendors/eventbus';

const CHD_CARRIER_EVENT = 'card.issuer.validation.requested';
const DEFAULT_SWEEP_MAX_AGE_MS = 15 * 60 * 1000; // abandoned-journey bound (§8)

/** Purge `chd` from a completed journey's carrier event(s). Returns how many were purged. */
export async function purgeChd(db: Db, correlationId: string): Promise<number> {
  const res = await db.collection(DOMAIN_EVENT_COLLECTION).updateMany(
    { eventType: CHD_CARRIER_EVENT, correlationId, 'payload.chd': { $exists: true } },
    { $unset: { 'payload.chd': '' } },
  );
  return res.modifiedCount ?? 0;
}

/** Safety sweep: purge `chd` from carrier events older than maxAge that never reached a terminal. */
export async function sweepAbandonedChd(db: Db, maxAgeMs: number = DEFAULT_SWEEP_MAX_AGE_MS, now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - maxAgeMs).toISOString();
  const res = await db.collection(DOMAIN_EVENT_COLLECTION).updateMany(
    { eventType: CHD_CARRIER_EVENT, occurredAt: { $lt: cutoff }, 'payload.chd': { $exists: true } },
    { $unset: { 'payload.chd': '' } },
  );
  return res.modifiedCount ?? 0;
}

// Bus subscriber: purge the carrier `chd` when the payment journey closes (§8 purge hook).
export class ChdRetention {
  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('card.payment.authorization.completed', (e: DomainEvent) => {
      void purgeChd(this.db, e.correlationId);
    });
  }
}
