// BIAN SD-64: Payment Order - Checkout Session Service
// Implements the Redirect Checkout integration pattern.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CHECKOUT_SESSION_COLLECTION,
  CheckoutSessionRecord,
  CheckoutSessionStatus,
} from '../models/checkoutSession.model';
import { createTransaction } from '../../transactions/services/cardTransaction.service';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface CreateCheckoutSessionInput {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantCategoryCode: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  merchantReference: string;
}

export interface CheckoutSessionPublic {
  checkoutSessionInstanceReference: string;
  checkoutSessionAmount: number;
  checkoutSessionCurrency: string;
  checkoutSessionDescription: string;
  merchantName: string;
  checkoutSessionStatus: CheckoutSessionStatus;
  checkoutSessionExpiresAt: string;
  checkoutSessionReturnUrl: string;
  checkoutSessionCancelUrl: string;
}

export type ProcessPaymentResult =
  | 'ok'
  | 'not_found'
  | 'expired'
  | 'already_completed'
  | 'cancelled';

export async function createCheckoutSession(
  db: Db,
  input: CreateCheckoutSessionInput,
  baseUrl: string
): Promise<{ checkoutSessionInstanceReference: string; paymentPageUrl: string; expiresAt: Date }> {
  const sessionId = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const session: CheckoutSessionRecord = {
    bianServiceDomain: 'Payment Order',
    bianControlRecordType: 'CheckoutSession',
    schemaVersion: 1,
    checkoutSessionInstanceReference: sessionId,
    merchantAgreementInstanceReference: input.merchantAgreementInstanceReference,
    merchantName: input.merchantName,
    checkoutSessionAmount: input.amount,
    checkoutSessionCurrency: input.currency,
    checkoutSessionDescription: input.description,
    checkoutSessionStatus: 'pending',
    checkoutSessionReturnUrl: input.returnUrl,
    checkoutSessionCancelUrl: input.cancelUrl,
    checkoutSessionMerchantReference: input.merchantReference,
    checkoutSessionCreatedDateTime: now,
    checkoutSessionExpiresAt: expiresAt,
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
  };

  await db.collection(CHECKOUT_SESSION_COLLECTION).insertOne(session as object);

  return {
    checkoutSessionInstanceReference: sessionId,
    paymentPageUrl: `${baseUrl}/gateway/checkout/${sessionId}`,
    expiresAt,
  };
}

export async function getCheckoutSession(
  db: Db,
  sessionId: string
): Promise<CheckoutSessionPublic | null> {
  const session = await db
    .collection<CheckoutSessionRecord>(CHECKOUT_SESSION_COLLECTION)
    .findOne({ checkoutSessionInstanceReference: sessionId } as Partial<CheckoutSessionRecord>);

  if (!session) return null;

  return {
    checkoutSessionInstanceReference: session.checkoutSessionInstanceReference,
    checkoutSessionAmount: session.checkoutSessionAmount,
    checkoutSessionCurrency: session.checkoutSessionCurrency,
    checkoutSessionDescription: session.checkoutSessionDescription,
    merchantName: session.merchantName,
    checkoutSessionStatus: session.checkoutSessionStatus,
    checkoutSessionExpiresAt: session.checkoutSessionExpiresAt.toISOString(),
    checkoutSessionReturnUrl: session.checkoutSessionReturnUrl,
    checkoutSessionCancelUrl: session.checkoutSessionCancelUrl,
  };
}

export interface ProcessCheckoutPaymentInput {
  sessionId: string;
  cardToken: string;
  cardholderName: string;
  cardExpiryMonth: string;
  cardExpiryYear: string;
  merchantCategoryCode?: string;
}

export async function processCheckoutPayment(
  db: Db,
  input: ProcessCheckoutPaymentInput
): Promise<{ result: ProcessPaymentResult; cardTransactionInstanceReference?: string; redirectUrl?: string }> {
  const session = await db
    .collection<CheckoutSessionRecord>(CHECKOUT_SESSION_COLLECTION)
    .findOne({ checkoutSessionInstanceReference: input.sessionId } as Partial<CheckoutSessionRecord>);

  if (!session) return { result: 'not_found' };
  if (session.checkoutSessionStatus === 'cancelled') return { result: 'cancelled' };
  if (session.checkoutSessionStatus === 'completed') return { result: 'already_completed' };

  const now = new Date();
  if (session.checkoutSessionExpiresAt < now) {
    await db.collection(CHECKOUT_SESSION_COLLECTION).updateOne(
      { checkoutSessionInstanceReference: input.sessionId } as Partial<CheckoutSessionRecord>,
      { $set: { checkoutSessionStatus: 'expired' as CheckoutSessionStatus, recordUpdatedDateTime: now } }
    );
    return { result: 'expired' };
  }

  // Build masked PAN from token: show last 4 chars of token as display
  const maskedPan = `****-****-****-${input.cardToken.slice(-4).padStart(4, '0')}`;

  // Create the underlying card transaction
  const txResult = await createTransaction(db, {
    cardToken: input.cardToken,
    accountReference: input.cardToken, // For checkout sessions, use token as account reference
    amount: session.checkoutSessionAmount,
    currency: session.checkoutSessionCurrency,
    cardTransactionMerchantName: session.merchantName,
    cardTransactionMerchantCategoryCode: input.merchantCategoryCode ?? '5999',
    cardTransactionChannel: 'online',
    cardTransactionMaskedPanDisplay: maskedPan,
    cardTransactionType: 'purchase',
    cardTransactionDescription: session.checkoutSessionDescription.slice(0, 22),
    cardTransactionNarrative: `Checkout session ${session.checkoutSessionMerchantReference}`,
    gatewayPayload: {
      source: 'checkout_session',
      sessionId: session.checkoutSessionInstanceReference,
      merchantReference: session.checkoutSessionMerchantReference,
    },
  });

  // Update session to completed
  await db.collection(CHECKOUT_SESSION_COLLECTION).updateOne(
    { checkoutSessionInstanceReference: input.sessionId } as Partial<CheckoutSessionRecord>,
    {
      $set: {
        checkoutSessionStatus: 'completed' as CheckoutSessionStatus,
        cardTransactionInstanceReference: txResult.cardTransactionInstanceReference,
        checkoutSessionCompletedDateTime: now,
        recordUpdatedDateTime: now,
      },
    }
  );

  const separator = session.checkoutSessionReturnUrl.includes('?') ? '&' : '?';
  const redirectUrl = `${session.checkoutSessionReturnUrl}${separator}status=success&session=${input.sessionId}`;

  return {
    result: 'ok',
    cardTransactionInstanceReference: txResult.cardTransactionInstanceReference,
    redirectUrl,
  };
}

export async function cancelCheckoutSession(
  db: Db,
  sessionId: string,
  merchantId: string
): Promise<'ok' | 'not_found' | 'wrong_merchant' | 'already_completed'> {
  const session = await db
    .collection<CheckoutSessionRecord>(CHECKOUT_SESSION_COLLECTION)
    .findOne({ checkoutSessionInstanceReference: sessionId } as Partial<CheckoutSessionRecord>);

  if (!session) return 'not_found';
  if (session.merchantAgreementInstanceReference !== merchantId) return 'wrong_merchant';
  if (session.checkoutSessionStatus === 'completed') return 'already_completed';

  await db.collection(CHECKOUT_SESSION_COLLECTION).updateOne(
    { checkoutSessionInstanceReference: sessionId } as Partial<CheckoutSessionRecord>,
    { $set: { checkoutSessionStatus: 'cancelled' as CheckoutSessionStatus, recordUpdatedDateTime: new Date() } }
  );

  return 'ok';
}
