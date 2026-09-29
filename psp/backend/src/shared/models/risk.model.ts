export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface FraudTriggerInput {
  transactionRef: string;
  customerRef: string;
  amount: number;
  mcc: string;
  snapshot: import('./transaction.model').TransactionSnapshot;
}
