// RTP lifecycle state machine (v28). Monotonic, validated transitions (spec §"Functional lifecycle").
// The service is the only writer; every transition goes through assertTransition so the request
// record can never move backwards or skip a mandatory gate.
import { PaymentRequestStatus } from '../models/paymentRequest.model';

const ALLOWED: Record<PaymentRequestStatus, PaymentRequestStatus[]> = {
  draft: ['created', 'cancelled'],
  created: ['validated', 'presented', 'cancelled', 'expired'],
  validated: ['presented', 'cancelled', 'expired'],
  presented: ['delivered', 'viewed', 'accepted', 'rejected', 'cancelled', 'expired'],
  delivered: ['viewed', 'accepted', 'rejected', 'cancelled', 'expired'],
  viewed: ['accepted', 'rejected', 'cancelled', 'expired'],
  accepted: ['payment_initiated'],
  payment_initiated: ['payment_processing', 'payment_settled', 'payment_failed'],
  payment_processing: ['payment_settled', 'payment_failed'],
  payment_settled: ['reversed', 'disputed'],
  payment_failed: [],
  rejected: [],
  cancelled: [],
  expired: [],
  reversed: [],
  disputed: [],
};

export function canTransition(from: PaymentRequestStatus, to: PaymentRequestStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export class RtpTransitionError extends Error {
  constructor(public from: PaymentRequestStatus, public to: PaymentRequestStatus) {
    super(`Invalid RTP transition: ${from} → ${to}`);
    this.name = 'RtpTransitionError';
  }
}

export function assertTransition(from: PaymentRequestStatus, to: PaymentRequestStatus): void {
  if (!canTransition(from, to)) throw new RtpTransitionError(from, to);
}

// Statuses that can still be swept to `expired` when past expiresAt.
export const EXPIRABLE_STATUSES: PaymentRequestStatus[] = ['created', 'validated', 'presented', 'delivered', 'viewed'];
