// Default EventBus adapter: single-process pub/sub backed by the EventStore. Good for the demo and a
// single API instance. A multi-instance / high-throughput deployment swaps this for a broker-backed
// adapter (Kafka/RabbitMQ) implementing the same EventBus port — publishers/consumers don't change.
import { EventBus, EventHandler, Subscription } from './EventBus';
import { EventStore } from './EventStore';
import { DomainEvent } from './types';
import { sanitizeDeep } from '../../modules/providers/services/businessProcessEvent.service';

interface Registration {
  patterns: string[];
  handler: EventHandler;
}

// '*' matches any eventType; a pattern containing '*' matches across segments (e.g. 'payment.*'
// matches 'payment.authorized' and 'payment.authorization.requested'); otherwise exact match.
function matches(pattern: string, eventType: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === eventType;
  const rx = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return rx.test(eventType);
}

export class InProcessEventBus implements EventBus {
  private readonly registrations = new Set<Registration>();

  constructor(private readonly store: EventStore) {}

  async start(): Promise<void> { /* no-op for in-process */ }
  async stop(): Promise<void> { this.registrations.clear(); }

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    // CHD safety boundary (PCI DSS Req 3.2): the payload is scrubbed before it is stored or delivered.
    const safe: DomainEvent = { ...event, payload: sanitizeDeep(event.payload) as Record<string, unknown> };
    await this.store.append(safe);
    // Deliver asynchronously; isolate each handler so one failure never blocks the others or the caller.
    for (const reg of this.registrations) {
      if (reg.patterns.some(p => matches(p, safe.eventType))) {
        Promise.resolve().then(() => reg.handler(safe)).catch(() => { /* handler errors are isolated */ });
      }
    }
  }

  subscribe(pattern: string | string[], handler: EventHandler): Subscription {
    const reg: Registration = { patterns: Array.isArray(pattern) ? pattern : [pattern], handler };
    this.registrations.add(reg);
    return { unsubscribe: () => { this.registrations.delete(reg); } };
  }
}
