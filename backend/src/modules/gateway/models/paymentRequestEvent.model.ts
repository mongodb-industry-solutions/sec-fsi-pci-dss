// BIAN SD-65 / ADR-025: per-request timeseries event trail for RTP (v28).
// One row per lifecycle transition, correlated by paymentRequestInstanceReference.
// Complements (does not replace) the global businessProcessEvent/complianceProcessEvent ledger;
// gives fast per-request history for back-office search. Timeseries + TTL (365d), no QE.

export const PAYMENT_REQUEST_EVENT_COLLECTION = 'paymentRequestEvent';

export interface PaymentRequestEvent {
  eventDateTime: Date;                       // timeField
  paymentRequestInstanceReference: string;   // metaField, correlation key
  fromStatus?: string;
  toStatus: string;
  action: string;                            // e.g. 'created' | 'presented' | 'accepted' | 'settled'
  performedByPartyReference?: string;
  performedByRole?: string;
  summary?: string;
  meta?: Record<string, unknown>;
  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'PaymentRequestProcedure';
}
