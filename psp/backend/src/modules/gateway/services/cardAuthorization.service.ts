// Card Authorization: PSP-local pre-check, then a deliberate deferral.
//
// When no 'card_authorization' provider is registered, falls back to stub (always approve). When a
// real institution IS registered, this no longer dispatches to it: see
// RESPONSE_CODE_DEFERRED_TO_FUNDS_GATE for why, and the funds gate (providerGroups.ts, onFunds) for
// where the one real bank call now lives.

import { Db } from 'mongodb';
import {
  CARD_AUTHORIZATION_COLLECTION,
  CardAuthorizationRecord,
  CardAuthorizationResult,
} from '../models/cardAuthorization.model';
import { getActiveProviderForType } from '../../provider/services/integrationRegistry.service';
import { CardAuthorizationConfig } from '../../provider/models/externalProviderArrangement.model';
import { getCardByToken } from '../../customer/services/paymentCard.service';

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
/**
 * Approved here without asking anyone, because asking is about to happen anyway, once, somewhere else.
 *
 * For a card whose funding account is held at a bank, "does the issuer authorise this" and "does the
 * funding account have the money" are the SAME question at THAT bank, answered by the SAME hold call
 * (bankcore has exactly one endpoint for it: an authorisation, in this model, IS a hold). The funds gate
 * (`funds.check.requested`, resolved once the underlying transaction is created) already makes that one
 * call correctly, with the account resolved and the request shaped the way the bank actually requires.
 *
 * This gate used to also dispatch here, with a request shaped for a different, no-longer-real contract.
 * Fixing the shape without removing this second call would have meant asking the same bank to hold the
 * same amount twice for one purchase, which is a real, distinct movement at the bank, not a retry of the
 * same one. So this gate defers instead: a distinct code, so an investigation can tell "we deferred to
 * the funds gate" apart from "the issuer said yes", without inventing a second place that holds funds.
 */
const RESPONSE_CODE_DEFERRED_TO_FUNDS_GATE = '0002';

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
    // A real institution is registered, so there IS someone to ask, and this gate defers to the funds
    // gate to do the asking (see RESPONSE_CODE_DEFERRED_TO_FUNDS_GATE above for why: one bank call per
    // purchase, not two). The funds gate covers every outcome this branch used to try to read from a
    // dispatch: no institution behind the account approves locally, a refusal or an unreachable bank
    // declines, and only a genuine hold counts as approved. Nothing here loses coverage, it moves.
    providerRef = provider.externalProviderArrangementInstanceReference;
    result = 'approved';
    responseCode = RESPONSE_CODE_DEFERRED_TO_FUNDS_GATE;
    authCode = generateAuthCode();
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
