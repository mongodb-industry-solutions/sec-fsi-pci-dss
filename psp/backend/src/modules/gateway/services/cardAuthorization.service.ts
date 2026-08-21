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
    // Real provider response interpretation (simplified)
    result = dispatchResult.status === 'received' && dispatchResult.responseCode === 200 ? 'approved' : 'declined';
    responseCode = result === 'approved' ? RESPONSE_CODE_APPROVED : RESPONSE_CODE_DECLINED;
    if (result === 'approved') authCode = generateAuthCode();
  } else {
    // Stub adapter: scenario-driven or always-approve
    providerRef = provider?.externalProviderArrangementInstanceReference ?? 'stub';
    const catConfig = provider?.categoryConfig as CardAuthorizationConfig | undefined;
    const mode = catConfig?.simulatorMode ?? 'always_approve';

    const outcome = mode === 'scenario_driven' && req.cardAuthOutcome ? req.cardAuthOutcome : 'approved';

    if (outcome === 'declined') {
      result = 'declined';
      responseCode = RESPONSE_CODE_DECLINED;
    } else if (outcome === 'challenge') {
      result = 'approved';
      responseCode = RESPONSE_CODE_APPROVED;
      challengeRequired = true;
      authCode = generateAuthCode();
    } else {
      result = 'approved';
      responseCode = RESPONSE_CODE_APPROVED;
      authCode = generateAuthCode();
    }
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
