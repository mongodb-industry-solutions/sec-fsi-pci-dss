// BIAN SD-64: Payment Order - Checkout Session Service
// Implements the Redirect Checkout integration pattern.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CHECKOUT_SESSION_COLLECTION,
  CheckoutSessionRecord,
  CheckoutSessionStatus,
} from '../models/checkoutSession.model';
import { createTransaction, CardIssuerDeclinedError, resolveAccountReferenceForParty } from '../../transaction/services/cardTransaction.service';
import { getOwnAgreementId, getCardsByCustomer } from '../../customer/services/paymentCard.service';
import { authorizeCard, linkAuthToTransaction } from './cardAuthorization.service';
import { sendMerchantPaymentCallback, DECLINE_REASONS } from './merchantCallback.service';
import { emitProcessEvent } from '../../provider/services/businessProcessEvent.service';

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
  // v18 on-behalf-of attribution (optional): who the merchant app is acting for.
  actingSubjectReference?: string;
  actingPartyReference?: string;
  actingClientId?: string;
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
  // v18: display-safe signal that this session was created on behalf of a logged-in user (the merchant
  // app forwarded the payer's OAuth identity). The hosted page uses it to offer the payer's saved cards.
  // The acting party reference itself is NOT surfaced here (identity minimization); saved cards are read
  // via the session-scoped endpoint, which resolves the owner server-side.
  hasActingUser: boolean;
}

// Display-safe saved card for the hosted checkout selector. Surrogate token + masked PAN only; never
// the full PAN, never the CVV/PIN (PCI DSS Req 3.2 / 3.4). The expiry is NOT included: the payer
// re-enters it (with the CVV) to authorize.
export interface CheckoutSavedCard {
  paymentCardInstanceReference: string;
  cardToken: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardNetwork?: string;
  paymentCardAlias?: string;
  paymentCardIsPreferred?: boolean;
}

export type ProcessPaymentResult =
  | 'ok'
  | 'not_found'
  | 'expired'
  | 'already_completed'
  | 'cancelled'
  | 'declined';

function substitutePlaceholders(url: string, values: Record<string, string>): string {
  let result = url;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(`{${key}}`, value);
  }
  return result;
}

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
    bianControlRecordType: 'CheckoutSessionLog',
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
    ...(input.actingSubjectReference && { checkoutSessionActingSubjectReference: input.actingSubjectReference }),
    ...(input.actingPartyReference && { checkoutSessionActingPartyReference: input.actingPartyReference }),
    ...(input.actingClientId && { checkoutSessionActingClientId: input.actingClientId }),
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
    hasActingUser: !!session.checkoutSessionActingPartyReference,
  };
}

// v18: the acting user's saved cards for THIS session. Ownership is enforced entirely server-side:
// we only ever read the cards of the party captured on the session (never a caller-supplied id), so a
// checkout page can only see the cards of the logged-in user the session was created for. Returns
// display-safe rows only (surrogate token + masked PAN + network/alias); no full PAN, no CVV, no expiry.
export async function getCheckoutSavedCards(db: Db, sessionId: string): Promise<CheckoutSavedCard[]> {
  const session = await db
    .collection<CheckoutSessionRecord>(CHECKOUT_SESSION_COLLECTION)
    .findOne(
      { checkoutSessionInstanceReference: sessionId } as Partial<CheckoutSessionRecord>,
      { projection: { checkoutSessionActingPartyReference: 1, checkoutSessionStatus: 1 } },
    );

  if (!session?.checkoutSessionActingPartyReference) return [];
  // Do not offer saved cards on a closed session.
  if (session.checkoutSessionStatus !== 'pending') return [];

  const agreementId = await getOwnAgreementId(db, session.checkoutSessionActingPartyReference);
  if (!agreementId) return [];

  const { results } = await getCardsByCustomer(db, agreementId);
  return (results as Array<Record<string, unknown>>)
    // Only cards usable at authorization time: an active card-on-file. Suspended/expired cards would
    // just decline, so we keep them out of the payer's quick-pick selector.
    .filter((c) => c.paymentCardStatus === 'active')
    .map((c) => ({
      paymentCardInstanceReference: c.paymentCardInstanceReference as string,
      cardToken: c.paymentCardReference as string,
      paymentCardMaskedPanDisplay: c.paymentCardMaskedPanDisplay as string,
      ...(c.paymentCardNetwork ? { paymentCardNetwork: c.paymentCardNetwork as string } : {}),
      ...(c.paymentCardAlias ? { paymentCardAlias: c.paymentCardAlias as string } : {}),
      ...(c.paymentCardIsPreferred ? { paymentCardIsPreferred: true } : {}),
    }));
}

export interface ProcessCheckoutPaymentInput {
  sessionId: string;
  cardToken: string;
  cardholderName: string;
  cardExpiryMonth: string;
  cardExpiryYear: string;
  merchantCategoryCode?: string;
  customerEmail?: string;
  saveCard?: boolean;
  cardAuthOutcome?: 'approved' | 'declined' | 'challenge';
  // The CVV the buyer entered on the checkout form. Forwarded to the issuer for verification ONLY
  // (P13.1); never persisted/logged (PCI DSS Req 3.2). A wrong/missing CVV declines (D1).
  cardCvv?: string;
}

export async function processCheckoutPayment(
  db: Db,
  input: ProcessCheckoutPaymentInput
): Promise<{ result: ProcessPaymentResult; cardTransactionInstanceReference?: string; fraudDiagnosisInstanceReference?: string; redirectUrl?: string; responseCode?: string; declineReason?: string }> {
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

  // v18 on-behalf-of: if the merchant app created this session while acting for a logged-in user, stamp
  // the resulting card transaction with THAT payer's canonical account reference so the purchase lands
  // in their payment history — even when no email is typed on the hosted page. Identity ref only, no PII.
  const actingAccountReference = session.checkoutSessionActingPartyReference
    ? await resolveAccountReferenceForParty(db, session.checkoutSessionActingPartyReference)
    : undefined;

  // SD-15: Card Authorization — run before creating the transaction
  const mcc = input.merchantCategoryCode ?? '5999';
  const authResult = await authorizeCard(db, {
    checkoutSessionInstanceReference: input.sessionId,
    cardToken: input.cardToken,
    amount: session.checkoutSessionAmount,
    currency: session.checkoutSessionCurrency,
    mcc,
    merchantCode: session.merchantAgreementInstanceReference,
    cardAuthOutcome: input.cardAuthOutcome,
  });

  if (authResult.result === 'declined') {
    // Notify the merchant of the decline via the integration callback (token + reason, no CHD),
    // and still return a redirect so the buyer/merchant return page is reached.
    const declineReason = DECLINE_REASONS[authResult.responseCode] ?? 'Authorization declined';
    await sendMerchantPaymentCallback(db, {
      merchantAgreementInstanceReference: session.merchantAgreementInstanceReference,
      amount: session.checkoutSessionAmount,
      currency: session.checkoutSessionCurrency,
      merchantReference: session.checkoutSessionMerchantReference,
      contextRef: session.checkoutSessionInstanceReference,
      contextType: 'checkout_session',
      triggeredBy: 'gateway.checkout.callback',
      result: 'declined',
      cardToken: input.cardToken,
      maskedPan,
      responseCode: authResult.responseCode,
      declineReason,
    });
    const redirectUrl = substitutePlaceholders(session.checkoutSessionReturnUrl, {
      session_id: input.sessionId, txn_id: '', case_id: '',
      card_token: input.cardToken, result: 'declined', response_code: authResult.responseCode,
      auth_code: '', reason: declineReason,
    });
    return { result: 'declined', redirectUrl, responseCode: authResult.responseCode, declineReason };
  }

  // Create the underlying card transaction. An issuer decline (e.g. a wrong CVV) is a normal business
  // outcome, not a server error: surface it as a declined payment (merchant callback + redirect back
  // to the merchant), the same as the pre-auth decline above — never a 500.
  let txResult: Awaited<ReturnType<typeof createTransaction>>;
  try {
    txResult = await createTransaction(db, {
      cardToken: input.cardToken,
      accountReference: input.customerEmail ?? actingAccountReference ?? input.cardToken,
      amount: session.checkoutSessionAmount,
      currency: session.checkoutSessionCurrency,
      cardTransactionMerchantName: session.merchantName,
      cardTransactionMerchantCategoryCode: mcc,
      cardTransactionChannel: 'online',
      cardTransactionMaskedPanDisplay: maskedPan,
      cardTransactionType: 'purchase',
      cardTransactionDescription: session.checkoutSessionDescription.slice(0, 22),
      cardTransactionNarrative: `Checkout session ${session.checkoutSessionMerchantReference}`,
      merchantAgreementInstanceReference: session.merchantAgreementInstanceReference,
      // Pass the expiry through so the card-on-file (auto-registered in createTransaction) carries
      // it. The card is saved for the payer regardless of any "save card" choice (SD-88).
      ...(input.cardExpiryMonth && input.cardExpiryYear
        ? { paymentCardExpirationDate: `${input.cardExpiryMonth}/${input.cardExpiryYear.slice(-2)}` }
        : {}),
      // P13.1: forward the entered CVV to the issuer for verification (rides only the encrypted `chd`
      // envelope, never persisted/logged). requireCardVerification marks this as a CVV-bearing channel
      // so a missing CVV declines (D1).
      requireCardVerification: true,
      cardVerification: {
        ...(input.cardCvv ? { cvv: input.cardCvv } : {}),
        ...(input.cardExpiryMonth && input.cardExpiryYear ? { expiry: `${input.cardExpiryMonth}/${input.cardExpiryYear.slice(-2)}` } : {}),
      },
      gatewayPayload: {
        source: 'checkout_session',
        sessionId: session.checkoutSessionInstanceReference,
        merchantReference: session.checkoutSessionMerchantReference,
        cardAuthorizationInstanceReference: authResult.recordId,
        cardAuthorizationCode: authResult.authCode,
      },
    });
  } catch (err) {
    if (err instanceof CardIssuerDeclinedError) {
      const declineReason = DECLINE_REASONS[err.responseCode] ?? err.reason ?? 'Authorization declined';
      await sendMerchantPaymentCallback(db, {
        merchantAgreementInstanceReference: session.merchantAgreementInstanceReference,
        amount: session.checkoutSessionAmount,
        currency: session.checkoutSessionCurrency,
        merchantReference: session.checkoutSessionMerchantReference,
        contextRef: session.checkoutSessionInstanceReference,
        contextType: 'checkout_session',
        triggeredBy: 'gateway.checkout.callback',
        result: 'declined',
        cardToken: input.cardToken,
        maskedPan,
        responseCode: err.responseCode,
        declineReason,
        ...(err.cardTransactionInstanceReference ? { cardTransactionInstanceReference: err.cardTransactionInstanceReference } : {}),
      });
      const redirectUrl = substitutePlaceholders(session.checkoutSessionReturnUrl, {
        session_id: input.sessionId, txn_id: err.cardTransactionInstanceReference ?? '', case_id: '',
        card_token: input.cardToken, result: 'declined', response_code: err.responseCode, auth_code: '', reason: declineReason,
      });
      return { result: 'declined', redirectUrl, responseCode: err.responseCode, declineReason, cardTransactionInstanceReference: err.cardTransactionInstanceReference };
    }
    throw err;
  }

  // Link auth record to the transaction. The card-on-file is auto-registered inside
  // createTransaction for every payment, so no separate opt-in save is needed here.
  await linkAuthToTransaction(db, authResult.recordId, txResult.cardTransactionInstanceReference);

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

  // v18 (B-02): attribute the completed purchase to the acting merchant app + user, so it appears in the
  // connected-apps operations view (`/system/applications/{consentId}/operations`, self-scoped by the
  // OAuth subject). Display-safe: no CHD (the bus strips it), masked PAN only. `actingPartyReference` is
  // the OAuth SUBJECT (SD-91 login id) so it lines up with the operations query, which matches on `sub`.
  if (session.checkoutSessionActingSubjectReference || session.checkoutSessionActingClientId) {
    emitProcessEvent(db, {
      entityType: 'transaction', entityId: txResult.cardTransactionInstanceReference,
      processType: 'payment_processing', processAction: 'merchant.payment.checkout', processOutcome: 'approved',
      performedByPartyReference: session.checkoutSessionActingPartyReference ?? null, performedByRole: 'customer',
      eventSummary: {
        amount: session.checkoutSessionAmount, currency: session.checkoutSessionCurrency,
        merchantName: session.merchantName, maskedPan,
        cardTransactionInstanceReference: txResult.cardTransactionInstanceReference,
        checkoutSessionInstanceReference: session.checkoutSessionInstanceReference,
        merchantAgreementInstanceReference: session.merchantAgreementInstanceReference,
      },
      bianServiceDomain: 'Payment Order', bianControlRecordType: 'CheckoutSessionLog',
      attribution: {
        clientId: session.checkoutSessionActingClientId,
        merchantAgreementReference: session.merchantAgreementInstanceReference,
        actingPartyReference: session.checkoutSessionActingSubjectReference,
        actingChannel: 'oauth_merchant',
      },
    });
  }

  // The APPROVED merchant callback is fired centrally inside createTransaction (covers all flows).
  // Here we only build the redirect; the decline callback (above) is handled per-flow because a
  // decline never reaches createTransaction.

  const redirectUrl = substitutePlaceholders(session.checkoutSessionReturnUrl, {
    session_id: input.sessionId,
    txn_id: txResult.cardTransactionInstanceReference,
    case_id: txResult.fraudDiagnosisInstanceReference ?? '',
    card_token: input.cardToken,
    result: 'approved',
    response_code: authResult.responseCode,
    auth_code: authResult.authCode ?? '',
    reason: '',
  });

  return {
    result: 'ok',
    cardTransactionInstanceReference: txResult.cardTransactionInstanceReference,
    fraudDiagnosisInstanceReference: txResult.fraudDiagnosisInstanceReference,
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
