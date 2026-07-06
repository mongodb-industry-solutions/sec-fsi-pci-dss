// Persistent, correlated record of every DomainEvent (dev.v8 D3). This is the unified audit/
// investigation backbone: query by correlationId to replay a whole business-process journey in
// order (PCI DSS Req 10). The interface is injectable so the bus can be unit-tested with a fake.
import { Db } from 'mongodb';
import { DomainEvent, BusinessProcess } from './types';

export const DOMAIN_EVENT_COLLECTION = 'domainEvent';

export interface EventStore {
  /** Append one event. Idempotent: a duplicate eventId is ignored, not an error. */
  append(event: DomainEvent): Promise<void>;
  /** All events of a journey, oldest first — the full correlated trail. */
  trail(correlationId: string): Promise<DomainEvent[]>;
  /** Events of a given business-process class (optionally a time window), newest first. */
  byProcess(businessProcess: BusinessProcess, opts?: { from?: string; to?: string; limit?: number }): Promise<DomainEvent[]>;
}

export class MongoEventStore implements EventStore {
  constructor(private readonly db: Db) {}

  async append(event: DomainEvent): Promise<void> {
    try {
      await this.db.collection(DOMAIN_EVENT_COLLECTION).insertOne(event as object);
    } catch (err) {
      // Idempotency: a repeated eventId (at-least-once delivery / retries) is a no-op.
      if ((err as { code?: number }).code === 11000) return;
      throw err;
    }
  }

  async trail(correlationId: string): Promise<DomainEvent[]> {
    return this.db.collection<DomainEvent>(DOMAIN_EVENT_COLLECTION)
      .find({ correlationId }, { projection: { _id: 0 } })
      .sort({ occurredAt: 1 })
      .toArray();
  }

  async byProcess(businessProcess: BusinessProcess, opts?: { from?: string; to?: string; limit?: number }): Promise<DomainEvent[]> {
    const query: Record<string, unknown> = { businessProcess };
    if (opts?.from || opts?.to) {
      query.occurredAt = {
        ...(opts.from ? { $gte: opts.from } : {}),
        ...(opts.to ? { $lte: opts.to } : {}),
      };
    }
    return this.db.collection<DomainEvent>(DOMAIN_EVENT_COLLECTION)
      .find(query, { projection: { _id: 0 } })
      .sort({ occurredAt: -1 })
      .limit(opts?.limit ?? 200)
      .toArray();
  }
}
