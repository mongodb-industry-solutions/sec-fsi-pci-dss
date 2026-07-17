// Shared QR capability (v28): a reusable record representing any payable intent as a QR / deep-link.
// Referenced by RTP, payment links, and redirect/checkout payments. The QR IMAGE is not stored;
// the frontend renders it from encodedPayload. Backend owns only the canonical payload + lifecycle.
// No QE (no sensitive plaintext; only a signed deep link / EMVCo / EPC string).

export const QR_REPRESENTATION_COLLECTION = 'qrPaymentRepresentation';

export type QrSubjectType = 'rtp_request' | 'payment_link' | 'checkout_session';
export type QrPayloadFormat = 'url' | 'emvco' | 'sepa_epc';

export interface QrPaymentRepresentation {
  qrRepresentationInstanceReference: string;   // UUID, PK
  subjectType: QrSubjectType;
  subjectReference: string;                    // FK to the owning record
  payloadFormat: QrPayloadFormat;
  encodedPayload: string;                      // the string encoded into the QR
  expiresAt?: Date;
  singleUse: boolean;
  consumedAt?: Date;
  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'PaymentRequestProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}
