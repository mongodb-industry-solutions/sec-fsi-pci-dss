export interface TransactionSnapshot {
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionMerchantName: string;
  cardTransactionDateTime: Date;
  cardTransactionStatus: 'authorized' | 'declined' | 'pending' | 'settled' | 'disputed';
  cardTransactionMaskedPanDisplay: string;
}
