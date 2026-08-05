// v28 Shared QR capability. A reusable record turning any payable intent (RTP request, payment link,
// checkout session) into a QR / deep-link payload. The QR IMAGE is never stored; the frontend renders
// it from encodedPayload. Backend owns only the canonical payload + lifecycle (single-use, TTL).
//
// v35 CH-1: the EPC069-12 form embeds the creditor IBAN and payee name, so it is derived on read from
// the QE-protected parents, never persisted. QE here is impossible: TTL forbids it (err 6346501).
import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../config';
import {
  QR_REPRESENTATION_COLLECTION,
  QrPaymentRepresentation,
  QrSubjectType,
  QrPayloadFormat,
} from '../models/qrRepresentation.model';
import { PAYMENT_REQUEST_COLLECTION, PaymentRequestProcedure } from '../models/paymentRequest.model';
import { PAYOUT_ACCOUNT_COLLECTION } from '../models/payoutAccount.model';

export interface IssueQrInput {
  subjectType: QrSubjectType;
  subjectReference: string;
  payloadFormat?: QrPayloadFormat;
  expiresAt?: Date;
  singleUse?: boolean;
}

function coll(db: Db) {
  return db.collection<QrPaymentRepresentation>(QR_REPRESENTATION_COLLECTION);
}

// v35 CH-2: an unsupported format must fail loudly, never degrade to a `url` deep link.
export class QrPayloadError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400) {
    super(message);
    this.name = 'QrPayloadError';
  }
}

export interface EpcSource {
  iban: string;
  payeeName?: string;
  amount?: number;
  currency?: string;
  remittance?: string;
}

// EPC069-12 SCT QR (service tag BCD, version 002, UTF-8, SCT).
export function buildEpcPayload(src: EpcSource): string {
  return [
    'BCD', '002', '1', 'SCT', '',
    (src.payeeName ?? '').slice(0, 70),
    src.iban,
    src.amount != null ? `${(src.currency ?? 'EUR')}${src.amount.toFixed(2)}` : '',
    '', '', (src.remittance ?? '').slice(0, 140),
  ].join('\n');
}

// Signed deep link into the frontend. Paths must match the real routes.
function buildDeepLink(subjectType: QrSubjectType, subjectReference: string): string {
  const base = config.server.urlFrontend.replace(/\/$/, '');
  const ref = encodeURIComponent(subjectReference);
  const path = subjectType === 'rtp_request'
    ? `/system/payment/history/${ref}`
    : subjectType === 'payment_link'
      ? `/gateway/pay/${ref}`
      : `/gateway/checkout/${ref}`;
  return `${base}${path}`;
}

function assertSupported(format: QrPayloadFormat, subjectType: QrSubjectType): void {
  if (format !== 'url' && format !== 'sepa_epc') {
    throw new QrPayloadError('unsupported_payload_format', `Unsupported QR payload format: ${String(format)}.`);
  }
  // Only an RTP request carries a creditor account we can resolve at read time.
  if (format === 'sepa_epc' && subjectType !== 'rtp_request') {
    throw new QrPayloadError('unsupported_subject_for_format', 'sepa_epc is only available for an RTP request.');
  }
}

// Resolve the creditor data for a stored sepa_epc record. Reads the QE-protected parent records.
async function deriveEpcSource(db: Db, rec: QrPaymentRepresentation): Promise<EpcSource | null> {
  const req = await db.collection<PaymentRequestProcedure>(PAYMENT_REQUEST_COLLECTION)
    .findOne({ paymentRequestInstanceReference: rec.subjectReference });
  if (!req) return null;
  const acct = await db.collection<{ payoutAccountIban?: string }>(PAYOUT_ACCOUNT_COLLECTION)
    .findOne({ payoutAccountInstanceReference: req.payeeReceivingAccountReference } as Record<string, unknown>,
      { projection: { payoutAccountIban: 1 } });
  if (!acct?.payoutAccountIban) return null;
  return {
    iban: acct.payoutAccountIban,
    payeeName: req.payeeName,
    amount: req.amount,
    currency: req.currency,
    remittance: req.structuredRemittance?.reference ?? req.purpose,
  };
}

// Fill in the transient encodedPayload. Stored records never hold the EPC form.
async function hydrate(db: Db, rec: QrPaymentRepresentation): Promise<QrPaymentRepresentation> {
  if (rec.payloadFormat !== 'sepa_epc') return rec;
  const src = await deriveEpcSource(db, rec);
  if (!src) throw new QrPayloadError('epc_source_unavailable', 'The creditor account for this QR could not be resolved.', 409);
  return { ...rec, encodedPayload: buildEpcPayload(src) };
}

// Issue (or reuse) a QR for a subject. Idempotent per (subjectType, subjectReference).
export async function issueQr(db: Db, input: IssueQrInput): Promise<QrPaymentRepresentation> {
  const payloadFormat = input.payloadFormat ?? 'url';
  assertSupported(payloadFormat, input.subjectType);

  const existing = await coll(db).findOne({ subjectType: input.subjectType, subjectReference: input.subjectReference, consumedAt: { $exists: false } });
  if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) return hydrate(db, existing);

  const now = new Date();
  const rec: QrPaymentRepresentation = {
    qrRepresentationInstanceReference: uuidv4(),
    subjectType: input.subjectType,
    subjectReference: input.subjectReference,
    payloadFormat,
    // Only the deep link is durable; the EPC form is derived on read (v35 CH-1).
    ...(payloadFormat === 'url' ? { encodedPayload: buildDeepLink(input.subjectType, input.subjectReference) } : {}),
    expiresAt: input.expiresAt,
    singleUse: input.singleUse ?? false,
    bianServiceDomain: 'Payment Order',
    bianControlRecordType: 'PaymentRequestProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
  await coll(db).insertOne(rec);
  return hydrate(db, rec);
}

export async function getQr(db: Db, ref: string): Promise<QrPaymentRepresentation | null> {
  const rec = await coll(db).findOne({ qrRepresentationInstanceReference: ref });
  return rec ? hydrate(db, rec) : null;
}

// Resolve a QR for consumption. Marks single-use QRs consumed. Returns null if missing/expired/consumed.
export async function resolveQr(db: Db, ref: string): Promise<QrPaymentRepresentation | null> {
  const rec = await coll(db).findOne({ qrRepresentationInstanceReference: ref });
  if (!rec) return null;
  if (rec.consumedAt) return null;
  if (rec.expiresAt && rec.expiresAt <= new Date()) return null;
  if (rec.singleUse) {
    await coll(db).updateOne({ qrRepresentationInstanceReference: ref }, { $set: { consumedAt: new Date(), recordUpdatedDateTime: new Date() } });
  }
  return hydrate(db, rec);
}
