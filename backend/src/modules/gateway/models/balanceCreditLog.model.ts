// BIAN SD-66: Payout Account Credit Log, immutable ledger of inbound balance credits.
// Captures initial deposits, bank-in transfers, refund reversals, and admin adjustments.
// PCI DSS Req 10: every fund credit is an auditable record.

export const BALANCE_CREDIT_LOG_COLLECTION = 'balanceCreditLog';

export type CreditType =
  | 'initial_deposit'   // account opening / seed balance
  | 'bank_deposit'      // incoming bank transfer from external institution
  | 'admin_credit'      // PSP admin / operational credit
  | 'return'            // returned / reversed debit
  | 'commission'        // merchant commission (SD-89) collected into the PSP revenue account
  | 'interest';         // earned interest (future)

export interface BalanceCreditLogEntry {
  creditId: string;                          // UUID, primary key
  payoutAccountInstanceReference: string;    // FK → payoutAccountArrangement (SD-66)
  partyInstanceReference?: string;           // FK → party (denormalized for filtering)
  amount: number;                            // minor units (e.g. cents)
  currency: string;                          // ISO 4217
  creditType: CreditType;
  description: string;
  creditedAt: Date;
  performedByPartyReference?: string | null;
  referenceId?: string;                      // external rail ref or bank transfer ref
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime: Date;
  schemaVersion: number;
}
