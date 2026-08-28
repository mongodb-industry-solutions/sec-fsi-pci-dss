// Card Authorization, Stub adapter + Integration Hub routing
//
// When no 'card_authorization' provider is registered, falls back to stub (always approve).
// When a real provider is configured, delegates to integrationDispatch.service.ts.

import { Db } from 'mongodb';
import {
  CARD_AUTHORIZATION_COLLECTION,
  CardAuthorizationRecord,
  CardAuthorizationResult,
} from '../models/cardAuthorization.model';
import { getActiveProviderForType } from '../../provider/services/integrationRegistry.service';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { CardAuthorizationConfig } from '../../provider/models/externalProviderArrangement.model';
import { getCardByToken } from '../../customer/services/paymentCard.service';

const RESPONSE_CODE_APPROVED = '0000';
const RESPONSE_CODE_DECLINED = '0190';
// PSP-level decline: the card-on-file is deactivated/removed (not an issuer decision).
const RESPONSE_CODE_CARD_INACTIVE = '0540';
/**
 * The issuer could not be asked, or answered without a verdict.
 *
 * Echoes the card rail's `91` in this file's own four-digit vocabulary, because that is what
 * `cardAuthorizationResponseCode` is documented to hold and what its consumers parse. The issuer's OWN code
 * is deliberately not written into that field: mixing two code vocabularies in one column would make it
 * unparseable. It is recorded on the dispatch instead, where an investigation can read it.
 *
 * It is distinct from a decline on purpose. "Could not ask" is an integration failure and "was refused" is a
 * customer outcome, and a single code for both hides the first inside the second.
 */
const RESPONSE_CODE_ISSUER_UNAVAILABLE = '0910';

export interface CardAuthRequest {
  checkoutSessionInstanceReference: string;
  cardToken: string;
  amount: number;
  currency: string;
  mcc: string;
  merchantCode: string;
  cardAuthOutcome?: 'approved' | 'declined' | 'challenge';
}

export interface CardAuthResponse {
  result: CardAuthorizationResult;
  responseCode: string;
  authCode?: string;
  challengeRequired: boolean;
  recordId: string;
}

function generateAuthRef(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `CAUTH-${datePart}-${rand}`;
}

function generateAuthCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function authorizeCard(
  db: Db,
  req: CardAuthRequest
): Promise<CardAuthResponse> {
  const requestAt = new Date();

  // PSP-level control (precedes the issuer): if the token belongs to a card-on-file the customer
  // has DEACTIVATED (suspended) or REMOVED (revoked), decline immediately, even a valid card the
  // issuer would approve is rejected here. New/unsaved tokens have no card-on-file and pass through.
  const onFile = await getCardByToken(db, req.cardToken);
  if (onFile && onFile.paymentCardStatus !== 'active') {
    const responseAt = new Date();
    const recordId = generateAuthRef();
    const record: CardAuthorizationRecord = {
      cardAuthorizationInstanceReference: recordId,
      checkoutSessionInstanceReference: req.checkoutSessionInstanceReference,
      cardAuthorizationRequestDateTime: requestAt,
      cardAuthorizationResponseDateTime: responseAt,
      cardAuthorizationResult: 'declined',
      cardAuthorizationResponseCode: RESPONSE_CODE_CARD_INACTIVE,
      cardAuthorizationChallengeRequired: false,
      cardAuthorizationProviderReference: 'psp-policy',
      cardAuthorizationMerchantCode: req.merchantCode || 'MC-STUB',
      cardAuthorizationAmount: req.amount,
      cardAuthorizationCurrency: req.currency,
      cardAuthorizationMcc: req.mcc,
      bianServiceDomain: 'Card Authorization',
      bianControlRecordType: 'CardAuthorizationRecord',
      recordCreatedDateTime: requestAt,
      schemaVersion: 1,
    };
    await db.collection(CARD_AUTHORIZATION_COLLECTION).insertOne(record as object);
    return { result: 'declined', responseCode: RESPONSE_CODE_CARD_INACTIVE, challengeRequired: false, recordId };
  }

  const provider = await getActiveProviderForType(db, 'card_authorization');

  let result: CardAuthorizationResult;
  let responseCode: string;
  let authCode: string | undefined;
  let challengeRequired = false;
  let providerRef = 'stub';

  if (provider && !provider.externalProviderIsInternal) {
    // Real external provider: delegate via Integration Hub
    providerRef = provider.externalProviderArrangementInstanceReference;
    const dispatchResult = await dispatchProvider(db, 'card_authorization', 'card.authorization.requested', {
      cardToken: req.cardToken,
      amount: req.amount,
      currency: req.currency,
      mcc: req.mcc,
      merchantCode: req.merchantCode,
    }, { entityType: 'transaction', entityId: req.checkoutSessionInstanceReference, processType: 'card_authorization' });
    // The issuer's own answer, read from the BODY. A 200 means the request was understood, not that the
    // authorisation was granted: the card rails answer a decline successfully, and so does the bank, with
    // `{ approved: false, responseCode: '51' }`. Judging on the transport status alone turned every decline
    // it issued into an approval.
    const answer = (dispatchResult.responseBody ?? {}) as { approved?: unknown; responseCode?: unknown };
    const transportOk = dispatchResult.status === 'received' && dispatchResult.responseCode === 200;

    if (!transportOk) {
      // Could not ask. Distinct from being declined, and it is not an approval either.
      result = 'declined';
      responseCode = RESPONSE_CODE_ISSUER_UNAVAILABLE;
    } else if (typeof answer.approved !== 'boolean') {
      // Answered without a verdict, which means the contract or the mapping is wrong. Reading the silence as
      // consent is the failure this whole branch exists to avoid.
      result = 'declined';
      responseCode = RESPONSE_CODE_ISSUER_UNAVAILABLE;
    } else {
      result = answer.approved ? 'approved' : 'declined';
      responseCode = result === 'approved' ? RESPONSE_CODE_APPROVED : RESPONSE_CODE_DECLINED;
    }
    if (result === 'approved') authCode = generateAuthCode();
  } else {
    // No institution resolved for this card, so there is nobody who can authorise it (v37 P12).
    //
    // This branch used to BE the issuer: a simulator that approved by default, or followed whatever outcome
    // the caller asked for. That is the provider deciding whether an account releases money, which is exactly
    // what the separation removes. It fails closed instead, with the code that says "could not ask" rather
    // than one that says "was refused", so an unrouted card reads as an integration problem and not as a
    // customer's card being declined.
    providerRef = provider?.externalProviderArrangementInstanceReference ?? 'unrouted';
    result = 'declined';
    responseCode = RESPONSE_CODE_ISSUER_UNAVAILABLE;
  }

  const responseAt = new Date();
  const recordId = generateAuthRef();
  const merchantCode = provider ? (provider.categoryConfig as CardAuthorizationConfig | undefined)?.merchantCode ?? 'MC-STUB' : 'MC-STUB';

  const record: CardAuthorizationRecord = {
    cardAuthorizationInstanceReference: recordId,
    checkoutSessionInstanceReference: req.checkoutSessionInstanceReference,
    cardAuthorizationRequestDateTime: requestAt,
    cardAuthorizationResponseDateTime: responseAt,
    cardAuthorizationResult: result,
    cardAuthorizationResponseCode: responseCode,
    cardAuthorizationCode: authCode,
    cardAuthorizationChallengeRequired: challengeRequired,
    cardAuthorizationProviderReference: providerRef,
    cardAuthorizationMerchantCode: merchantCode,
    cardAuthorizationAmount: req.amount,
    cardAuthorizationCurrency: req.currency,
    cardAuthorizationMcc: req.mcc,
    bianServiceDomain: 'Card Authorization',
    bianControlRecordType: 'CardAuthorizationRecord',
    recordCreatedDateTime: requestAt,
    schemaVersion: 1,
  };

  await db.collection(CARD_AUTHORIZATION_COLLECTION).insertOne(record as object);

  return { result, responseCode, authCode, challengeRequired, recordId };
}

export async function linkAuthToTransaction(
  db: Db,
  recordId: string,
  cardTransactionInstanceReference: string
): Promise<void> {
  await db.collection(CARD_AUTHORIZATION_COLLECTION).updateOne(
    { cardAuthorizationInstanceReference: recordId },
    { $set: { cardTransactionInstanceReference } }
  );
}
