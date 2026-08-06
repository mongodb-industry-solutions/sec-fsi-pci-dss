// Bus payload contracts for the funds-availability gate of the `card_payment` process (v17).
// Reference-led: no CHD, no IBAN, only the PSP-internal card token and journey correlationId.
// correlationId = transactionId, matching the other card_payment gates (cardPayment.events.ts).
//
// BIAN: Account Information (AIS). The gate is provider-indifferent: the built-in
// account-information module reads the PSP internal ledger; an external PSD2 AIS provider
// substitutes it via dispatchProvider without changing these contracts.

/**
 * @event    funds.check.requested
 * @producer psp.core  @consumer Account Information (AIS) provider group / built-in module
 * @note     Only debit card-transaction types trigger a real check (purchase | cash_advance | fee).
 *           Refunds are credits and do not require a funds hold.
 */
export interface FundsCheckRequested {
  cardToken: string;                        // tokenized card-on-file reference, resolves funding account
  amount: number;                           // transaction amount in the TRANSACTION currency
  currency: string;                         // ISO-4217, transaction currency
  cardTransactionType: 'purchase' | 'cash_advance' | 'fee' | 'refund' | 'balance_transfer' | 'adjustment';
}

/**
 * @event    funds.check.completed
 * @producer callback.funds  @consumer PaymentAuthorizationSaga
 * @note     `held` = the amount atomically moved available -> pending, in the ACCOUNT currency.
 *           On decline (insufficient funds) nothing is held. FX fields are set only when the
 *           transaction currency differs from the funding-account currency.
 */
export interface FundsCheckCompleted {
  transactionId: string;
  outcome: 'approved' | 'declined';
  responseCode?: string;                    // ISO-8583: '00' approved, '51' insufficient funds
  decisionReason?: string;                  // e.g. "insufficient_funds" | "account_not_found"
  available?: number;                        // available balance at check time, in account currency
  held?: number;                             // amount held (account currency) when approved
  currency?: string;                         // funding-account currency (ISO-4217)
  fundingPayoutAccountReference?: string;    // for the saga's compensation (release on later decline)
  converted?: boolean;                       // true when an FX conversion was applied
  fxRate?: number;                           // transaction-ccy -> account-ccy rate (when converted)
}
