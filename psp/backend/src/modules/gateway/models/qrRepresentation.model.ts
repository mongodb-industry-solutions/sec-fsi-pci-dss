// Shared QR capability (v28): a reusable record representing any payable intent as a QR / deep-link.
// Referenced by RTP, payment links, and redirect/checkout payments. The QR IMAGE is not stored;
// the frontend renders it from encodedPayload. Backend owns only the canonical payload + lifecycle.
// Account/alias based, so NOT PCI scope (no PAN/CHD).

export const QR_REPRESENTATION_COLLECTION = 'qrPaymentRepresentation';

export type QrSubjectType = 'rtp_request' | 'payment_link' | 'checkout_session';
// v35 CH-2: 'emvco' removed (never implemented; a card-proxy QR would pull CHD into PCI scope, ADR-058).
export type QrPayloadFormat = 'url' | 'sepa_epc';

export interface QrPaymentRepresentation {
  qrRepresentationInstanceReference: string;   // UUID, PK
  subjectType: QrSubjectType;
  subjectReference: string;                    // FK to the owning record
  payloadFormat: QrPayloadFormat;
  // Durable only for 'url'; the 'sepa_epc' form is derived on read (v35 CH-1), never stored.
  encodedPayload?: string;
  expiresAt?: Date;
  singleUse: boolean;
  consumedAt?: Date;
  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'PaymentRequestProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}
