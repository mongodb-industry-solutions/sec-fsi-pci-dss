// The bank's own record of its account holder. NOT a copy of the PSP's party: the user belongs to the
// PSP, the account belongs to the bank, and the two are linked by consent and account reference
// rather than by shared identity. That is what keeps the PSP id_token `sub` untouched.
export const ACCOUNT_HOLDER_COLLECTION = 'accountHolder';

export interface AccountHolderControlRecord {
  accountHolderInstanceReference: string;
  // QE. GDPR: the holder's name and contact are personal data held by the bank.
  accountHolderName: string;
  accountHolderEmailAddress?: string;
  accountHolderCountryCode: string;
  accountHolderStatus: 'active' | 'dormant' | 'closed';
  bianServiceDomain: string;
  bianControlRecordType: 'AccountHolder';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}
