// BIAN SD-66 / SD-65 / SD-15: unified account ledger entry (read-only derived view)
// No separate collection — movements are aggregated at query time from:
//   paymentExecutionProcedure (outgoing disbursements)
//   cardTransactionLog        (card debits / refunds — via card.fundingPayoutAccountInstanceReference)

export type MovementType = 'card_debit' | 'card_refund' | 'payout_disbursement' | 'balance_credit' | 'p2p_sent' | 'p2p_received';
export type MovementDirection = 'debit' | 'credit';

export interface AccountMovement {
  movementId: string;             // source document ID
  movementType: MovementType;
  direction: MovementDirection;
  amount: number;                 // in minor units (cents)
  currency: string;               // ISO 4217
  description: string;
  counterpartyName?: string;      // merchant name (card_debit) or bank name (payout)
  counterpartyRef?: string;       // merchant ref or destination account ref
  status: string;                 // original status from source document
  occurredAt: string;             // ISO 8601
  sourceCollection: string;       // for audit trail
  sourceRef: string;              // original document _id or reference
}
