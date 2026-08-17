// Explicit ledger movements. At the PSP these were derived from payment executions; the bank keeps
// them as records, because a ledger that cannot enumerate its own movements cannot be reconciled.
export const ACCOUNT_MOVEMENT_COLLECTION = 'accountMovement';

export type MovementKind =
  | 'book_transfer_debit'
  | 'book_transfer_credit'
  | 'credit_transfer_debit'
  | 'credit_transfer_credit'
  | 'card_authorisation_hold'
  | 'card_authorisation_release'
  | 'card_settlement'
  | 'return'
  | 'demo_credit';

export type MovementDirection = 'debit' | 'credit';

export interface AccountMovementRecord {
  accountMovementInstanceReference: string;
  accountArrangementInstanceReference: string;
  movementKind: MovementKind;
  movementDirection: MovementDirection;
  movementAmount: number;
  movementCurrency: string;
  // Balance after this movement, so a statement never needs to replay the whole ledger.
  movementBalanceAfter: number;
  // Ties the movement to whatever caused it: a payment, a card authorisation, a return.
  movementCorrelationId: string;
  movementRemittanceInformation?: string;
  movementValueDateTime: string;
  bianServiceDomain: string;
  bianControlRecordType: 'AccountMovement';
  recordCreatedDateTime: string;
  schemaVersion: number;
}
