// BIAN SD-15: Card Authorization, CardAuthorizationRecord control record

export const CARD_AUTHORIZATION_COLLECTION = 'cardAuthorizationRecord';

export type CardAuthorizationResult =
  | 'approved'
  | 'declined'
  | 'challenge_completed'
  | 'error';

export interface CardAuthorizationRecord {
  cardAuthorizationInstanceReference: string;       // CAUTH-YYYYMMDD-NNNNNN
  cardTransactionInstanceReference?: string;        // FK → cardTransactionLog (null if declined)
  checkoutSessionInstanceReference: string;         // FK → checkoutSessionProcedure

  cardAuthorizationRequestDateTime: Date;
  cardAuthorizationResponseDateTime: Date;

  cardAuthorizationResult: CardAuthorizationResult;
  cardAuthorizationResponseCode: string;            // '0000', '0190', etc.
  cardAuthorizationCode?: string;                   // 6-char auth code when approved

  cardAuthorizationChallengeRequired: boolean;
  cardAuthorizationChallengeCompletedAt?: Date;

  cardAuthorizationProviderReference: string;       // Integration Hub provider ID or 'stub'
  cardAuthorizationMerchantCode: string;
  cardAuthorizationAmount: number;
  cardAuthorizationCurrency: string;
  cardAuthorizationMcc: string;

  bianServiceDomain: 'Card Authorization';
  bianControlRecordType: 'CardAuthorizationRecord';
  recordCreatedDateTime: Date;
  schemaVersion: 1;
}
