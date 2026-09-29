// Audit log of every balance credit, moved from the PSP with the ledger: it is the audit trail of a
// balance mutation, so it belongs wherever the balance does. PCI DSS and GDPR.
export const BALANCE_CREDIT_LOG_COLLECTION = 'balanceCreditLog';

export type CreditType = 'opening_deposit' | 'incoming_transfer' | 'demo_credit' | 'return';

export interface BalanceCreditLogEntry {
  balanceCreditLogInstanceReference: string;
  accountArrangementInstanceReference: string;
  creditType: CreditType;
  creditAmount: number;
  creditCurrency: string;
  creditBalanceAfter: number;
  creditReason?: string;
  // Who asked for it: an operator for a demo credit, the clearing scheme for an incoming transfer.
  creditRequestedBy?: string;
  creditCorrelationId?: string;
  bianServiceDomain: string;
  bianControlRecordType: 'BalanceCreditLog';
  recordCreatedDateTime: string;
  schemaVersion: number;
}
