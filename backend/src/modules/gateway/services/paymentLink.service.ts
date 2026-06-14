// BIAN SD-64: Payment Order - Payment Link Service
// Implements the Payment Link integration pattern.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYMENT_LINK_COLLECTION,
  PaymentLinkRecord,
  PaymentLinkStatus,
  PaymentLinkUsageType,
} from '../models/paymentLink.model';
import { createTransaction } from '../../transactions/services/cardTransaction.service';
import { authorizeCard, linkAuthToTransaction } from './cardAuthorization.service';
import { sendMerchantPaymentCallback, DECLINE_REASONS } from './checkout.service';

// 8-char alphanumeric code (URL-safe, no ambiguous chars O/0 I/l)
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function generateLinkCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export interface CreatePaymentLinkInput {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantCategoryCode: string;
  amount: number;
  currency: string;
  description: string;
  customerMessage?: string;
  usageType: PaymentLinkUsageType;
  maxUses?: number;
  expiresAt?: Date;
}

export interface PaymentLinkPublic {
  paymentLinkCode: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: string;
  paymentLinkDescription: string;
  merchantName: string;
  paymentLinkCustomerMessage?: string;
  paymentLinkStatus: PaymentLinkStatus;
  paymentLinkExpiresAt?: string;
}

export type ProcessLinkPaymentResult =
  | 'ok'
  | 'not_found'
  | 'expired'
  | 'deactivated'
  | 'completed'
  | 'declined';

export async function createPaymentLink(
  db: Db,
  input: CreatePaymentLinkInput,
  baseUrl: string
): Promise<{ paymentLinkInstanceReference: string; paymentLinkCode: string; paymentUrl: string }> {
  const linkId = uuidv4();
  const now = new Date();

  // Retry on code collision (extremely rare but correct to handle)
  let code = generateLinkCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db
      .collection<PaymentLinkRecord>(PAYMENT_LINK_COLLECTION)
      .findOne({ paymentLinkCode: code } as Partial<PaymentLinkRecord>);
    if (!existing) break;
    code = generateLinkCode();
  }

  const link: PaymentLinkRecord = {
    bianServiceDomain: 'Payment Order',
    bianControlRecordType: 'PaymentLinkRecord',
    schemaVersion: 1,
    paymentLinkInstanceReference: linkId,
    paymentLinkCode: code,
    merchantAgreementInstanceReference: input.merchantAgreementInstanceReference,
    merchantName: input.merchantName,
    paymentLinkAmount: input.amount,
    paymentLinkCurrency: input.currency,
    paymentLinkDescription: input.description,
    ...(input.customerMessage && { paymentLinkCustomerMessage: input.customerMessage }),
    paymentLinkStatus: 'active',
    paymentLinkUsageType: input.usageType,
    paymentLinkCurrentUses: 0,
    ...(input.maxUses !== undefined && { paymentLinkMaxUses: input.maxUses }),
    paymentLinkCreatedDateTime: now,
    ...(input.expiresAt && { paymentLinkExpiresAt: input.expiresAt }),
    paymentLinkTransactionReferences: [],
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
  };

  await db.collection(PAYMENT_LINK_COLLECTION).insertOne(link as object);

  return {
    paymentLinkInstanceReference: linkId,
    paymentLinkCode: code,
    paymentUrl: `${baseUrl}/gateway/pay/${code}`,
  };
}

export async function resolvePaymentLink(
  db: Db,
  code: string
): Promise<PaymentLinkPublic | null> {
  const link = await db
    .collection<PaymentLinkRecord>(PAYMENT_LINK_COLLECTION)
    .findOne({ paymentLinkCode: code } as Partial<PaymentLinkRecord>);

  if (!link) return null;

  return {
    paymentLinkCode: link.paymentLinkCode,
    paymentLinkAmount: link.paymentLinkAmount,
    paymentLinkCurrency: link.paymentLinkCurrency,
    paymentLinkDescription: link.paymentLinkDescription,
    merchantName: link.merchantName,
    paymentLinkCustomerMessage: link.paymentLinkCustomerMessage,
    paymentLinkStatus: link.paymentLinkStatus,
    paymentLinkExpiresAt: link.paymentLinkExpiresAt?.toISOString(),
  };
}

export interface ProcessLinkPaymentInput {
  linkCode: string;
  cardToken: string;
  cardholderName: string;
  cardExpiryMonth: string;
  cardExpiryYear: string;
  customerEmail?: string;
  cardAuthOutcome?: 'approved' | 'declined' | 'challenge';
}

export async function processLinkPayment(
  db: Db,
  input: ProcessLinkPaymentInput
): Promise<{ result: ProcessLinkPaymentResult; cardTransactionInstanceReference?: string; fraudDiagnosisInstanceReference?: string }> {
  const link = await db
    .collection<PaymentLinkRecord>(PAYMENT_LINK_COLLECTION)
    .findOne({ paymentLinkCode: input.linkCode } as Partial<PaymentLinkRecord>);

  if (!link) return { result: 'not_found' };
  if (link.paymentLinkStatus === 'deactivated') return { result: 'deactivated' };
  if (link.paymentLinkStatus === 'completed') return { result: 'completed' };

  const now = new Date();
  if (link.paymentLinkExpiresAt && link.paymentLinkExpiresAt < now) {
    await db.collection(PAYMENT_LINK_COLLECTION).updateOne(
      { paymentLinkCode: input.linkCode } as Partial<PaymentLinkRecord>,
      { $set: { paymentLinkStatus: 'expired' as PaymentLinkStatus, recordUpdatedDateTime: now } }
    );
    return { result: 'expired' };
  }

  const maskedPan = `****-****-****-${input.cardToken.slice(-4).padStart(4, '0')}`;

  // SD-15: Card Authorization — run before creating the transaction
  const authResult = await authorizeCard(db, {
    checkoutSessionInstanceReference: link.paymentLinkInstanceReference,
    cardToken: input.cardToken,
    amount: link.paymentLinkAmount,
    currency: link.paymentLinkCurrency,
    mcc: '5999',
    merchantCode: link.merchantAgreementInstanceReference,
    cardAuthOutcome: input.cardAuthOutcome,
  });

  if (authResult.result === 'declined') {
    // Notify the merchant of the decline via its own webhook + the integration audit event.
    await sendMerchantPaymentCallback(db, {
      merchantAgreementInstanceReference: link.merchantAgreementInstanceReference,
      amount: link.paymentLinkAmount,
      currency: link.paymentLinkCurrency,
      merchantReference: link.paymentLinkCode,
      contextRef: link.paymentLinkInstanceReference,
      contextType: 'payment_link',
      triggeredBy: 'payment_link.callback',
      result: 'declined',
      cardToken: input.cardToken,
      maskedPan,
      responseCode: authResult.responseCode,
      declineReason: DECLINE_REASONS[authResult.responseCode] ?? 'Authorization declined',
    });
    return { result: 'declined' };
  }

  const txResult = await createTransaction(db, {
    cardToken: input.cardToken,
    accountReference: input.customerEmail ?? input.cardToken,
    amount: link.paymentLinkAmount,
    currency: link.paymentLinkCurrency,
    cardTransactionMerchantName: link.merchantName,
    cardTransactionMerchantCategoryCode: '5999',
    cardTransactionChannel: 'online',
    cardTransactionMaskedPanDisplay: maskedPan,
    cardTransactionType: 'purchase',
    cardTransactionDescription: link.paymentLinkDescription.slice(0, 22),
    cardTransactionNarrative: `Payment link ${link.paymentLinkCode}`,
    merchantAgreementInstanceReference: link.merchantAgreementInstanceReference,
    gatewayPayload: {
      source: 'payment_link',
      linkCode: link.paymentLinkCode,
      linkInstanceReference: link.paymentLinkInstanceReference,
      cardAuthorizationInstanceReference: authResult.recordId,
      cardAuthorizationCode: authResult.authCode,
    },
  });

  // Link auth record to the transaction
  await linkAuthToTransaction(db, authResult.recordId, txResult.cardTransactionInstanceReference);

  // Notify the merchant of the successful payment (per-merchant webhook + integration audit event).
  await sendMerchantPaymentCallback(db, {
    merchantAgreementInstanceReference: link.merchantAgreementInstanceReference,
    amount: link.paymentLinkAmount,
    currency: link.paymentLinkCurrency,
    merchantReference: link.paymentLinkCode,
    contextRef: link.paymentLinkInstanceReference,
    contextType: 'payment_link',
    triggeredBy: 'payment_link.callback',
    result: 'approved',
    cardToken: input.cardToken,
    maskedPan,
    responseCode: authResult.responseCode,
    authorizationCode: authResult.authCode,
    cardTransactionInstanceReference: txResult.cardTransactionInstanceReference,
  });

  // Determine new status for single_use links
  const newStatus: PaymentLinkStatus =
    link.paymentLinkUsageType === 'single_use' ? 'completed' : 'active';

  await db.collection(PAYMENT_LINK_COLLECTION).updateOne(
    { paymentLinkCode: input.linkCode } as Partial<PaymentLinkRecord>,
    {
      $set: {
        paymentLinkStatus: newStatus,
        recordUpdatedDateTime: now,
      },
      $inc: { paymentLinkCurrentUses: 1 },
      $push: {
        paymentLinkTransactionReferences: txResult.cardTransactionInstanceReference,
      },
    } as object
  );

  return {
    result: 'ok',
    cardTransactionInstanceReference: txResult.cardTransactionInstanceReference,
    fraudDiagnosisInstanceReference: txResult.fraudDiagnosisInstanceReference,
  };
}

export async function deactivatePaymentLink(
  db: Db,
  linkId: string,
  merchantId: string
): Promise<'ok' | 'not_found' | 'wrong_merchant'> {
  const link = await db
    .collection<PaymentLinkRecord>(PAYMENT_LINK_COLLECTION)
    .findOne({ paymentLinkInstanceReference: linkId } as Partial<PaymentLinkRecord>);

  if (!link) return 'not_found';
  if (link.merchantAgreementInstanceReference !== merchantId) return 'wrong_merchant';

  await db.collection(PAYMENT_LINK_COLLECTION).updateOne(
    { paymentLinkInstanceReference: linkId } as Partial<PaymentLinkRecord>,
    { $set: { paymentLinkStatus: 'deactivated' as PaymentLinkStatus, recordUpdatedDateTime: new Date() } }
  );

  return 'ok';
}

export async function listPaymentLinks(
  db: Db,
  merchantId: string,
  page = 1,
  limit = 20
): Promise<{ results: PaymentLinkRecord[]; total: number }> {
  const filter = { merchantAgreementInstanceReference: merchantId } as Partial<PaymentLinkRecord>;
  const total = await db.collection<PaymentLinkRecord>(PAYMENT_LINK_COLLECTION).countDocuments(filter);
  const results = await db
    .collection<PaymentLinkRecord>(PAYMENT_LINK_COLLECTION)
    .find(filter)
    .sort({ recordCreatedDateTime: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return { results, total };
}
