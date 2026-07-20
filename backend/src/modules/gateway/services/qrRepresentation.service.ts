// v28 Shared QR capability. A reusable record turning any payable intent (RTP request, payment link,
// checkout session) into a QR / deep-link payload. The QR IMAGE is never stored; the frontend renders
// it from encodedPayload. Backend owns only the canonical payload + lifecycle (single-use, TTL).
// No PII beyond a signed deep link / EPC string (GDPR minimization).
import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../config';
import {
  QR_REPRESENTATION_COLLECTION,
  QrPaymentRepresentation,
  QrSubjectType,
  QrPayloadFormat,
} from '../models/qrRepresentation.model';

export interface IssueQrInput {
  subjectType: QrSubjectType;
  subjectReference: string;
  payloadFormat?: QrPayloadFormat;
  amount?: number;
  currency?: string;
  payeeName?: string;
  iban?: string;                 // for sepa_epc format
  remittance?: string;
  expiresAt?: Date;
  singleUse?: boolean;
}

function coll(db: Db) {
  return db.collection<QrPaymentRepresentation>(QR_REPRESENTATION_COLLECTION);
}

// Build the string encoded into the QR. `url` = a signed deep link into the app; `sepa_epc` = the
// EPC069-12 "BCD" payload used by SEPA credit-transfer QR codes; `emvco` reserved for future card use.
function buildPayload(input: IssueQrInput): { payloadFormat: QrPayloadFormat; encodedPayload: string } {
  const format = input.payloadFormat ?? 'url';
  if (format === 'sepa_epc' && input.iban) {
    // EPC069-12 SCT QR (service tag BCD, version 002, UTF-8, SCT).
    const lines = [
      'BCD', '002', '1', 'SCT', '',
      (input.payeeName ?? '').slice(0, 70),
      input.iban,
      input.amount != null ? `${(input.currency ?? 'EUR')}${input.amount.toFixed(2)}` : '',
      '', '', (input.remittance ?? '').slice(0, 140),
    ];
    return { payloadFormat: 'sepa_epc', encodedPayload: lines.join('\n') };
  }
  // Generic signed deep link into the frontend (resolves to the subject page).
  const base = config.server.urlFrontend.replace(/\/$/, '');
  // Paths must match the real frontend routes: payment links at /gateway/pay/:code and checkout
  // sessions at /gateway/checkout/:sessionId (RTP resolves to the in-app request detail).
  const path = input.subjectType === 'rtp_request'
    ? `/system/payment/history/${encodeURIComponent(input.subjectReference)}`
    : input.subjectType === 'payment_link'
      ? `/gateway/pay/${encodeURIComponent(input.subjectReference)}`
      : `/gateway/checkout/${encodeURIComponent(input.subjectReference)}`;
  return { payloadFormat: 'url', encodedPayload: `${base}${path}` };
}

// Issue (or reuse) a QR for a subject. Idempotent per (subjectType, subjectReference): returns the
// existing live QR if present, otherwise creates one.
export async function issueQr(db: Db, input: IssueQrInput): Promise<QrPaymentRepresentation> {
  const existing = await coll(db).findOne({ subjectType: input.subjectType, subjectReference: input.subjectReference, consumedAt: { $exists: false } });
  if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) return existing;

  const now = new Date();
  const { payloadFormat, encodedPayload } = buildPayload(input);
  const rec: QrPaymentRepresentation = {
    qrRepresentationInstanceReference: uuidv4(),
    subjectType: input.subjectType,
    subjectReference: input.subjectReference,
    payloadFormat,
    encodedPayload,
    expiresAt: input.expiresAt,
    singleUse: input.singleUse ?? false,
    bianServiceDomain: 'Payment Order',
    bianControlRecordType: 'PaymentRequestProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
  await coll(db).insertOne(rec);
  return rec;
}

export async function getQr(db: Db, ref: string): Promise<QrPaymentRepresentation | null> {
  return coll(db).findOne({ qrRepresentationInstanceReference: ref });
}

// Resolve a QR for consumption. Marks single-use QRs consumed. Returns null if missing/expired/consumed.
export async function resolveQr(db: Db, ref: string): Promise<QrPaymentRepresentation | null> {
  const rec = await getQr(db, ref);
  if (!rec) return null;
  if (rec.consumedAt) return null;
  if (rec.expiresAt && rec.expiresAt <= new Date()) return null;
  if (rec.singleUse) {
    await coll(db).updateOne({ qrRepresentationInstanceReference: ref }, { $set: { consumedAt: new Date(), recordUpdatedDateTime: new Date() } });
  }
  return rec;
}
