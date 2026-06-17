// §7.7 wire->bus bridge: the short-lived pending-correlation registry. At dispatch a Provider Group
// records the journey envelope keyed by the wire reference (clientReference = correlationId, or the
// vendor's own ack ref); when the async callback lands, the inbound handler restores the full envelope
// (correlationId + causationId + businessProcess) from this entry and clears it. In-memory to match
// the in-process bus (like the saga's journeys map); a broker deployment swaps the store, not the API.
import type { PendingCorrelation } from '../../../shared/models/events/wire.contracts';

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min — abandoned entries are swept (saga times out, fail-open)
const registry = new Map<string, PendingCorrelation>();

/** Record a pending correlation at dispatch, indexed by its wire reference. */
export function recordPendingCorrelation(
  entry: Omit<PendingCorrelation, 'expiresAt'> & { expiresAt?: string },
): void {
  registry.set(entry.ref, { ...entry, expiresAt: entry.expiresAt ?? new Date(Date.now() + DEFAULT_TTL_MS).toISOString() });
}

/** Resolve the journey envelope for an echoed wire reference (does not clear it). */
export function resolvePendingCorrelation(ref: string): PendingCorrelation | undefined {
  return registry.get(ref);
}

/** Clear an entry once its callback has been handled. */
export function clearPendingCorrelation(ref: string): void {
  registry.delete(ref);
}

/** Periodic safety sweep: drop entries past expiry. Returns how many were removed. */
export function sweepExpiredCorrelations(now: number = Date.now()): number {
  let removed = 0;
  for (const [ref, entry] of registry) {
    if (Date.parse(entry.expiresAt) <= now) { registry.delete(ref); removed++; }
  }
  return removed;
}

/** Test-only: current entry count. */
export function pendingCorrelationSize(): number {
  return registry.size;
}
