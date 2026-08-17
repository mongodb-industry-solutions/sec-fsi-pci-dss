import type { Binary } from 'mongodb';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../modules/aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION } from '../../modules/aspsp/models/accountHolder.model';

// Queryable Encryption map of the bank database, using the DEKs the PSP already provisioned. The key
// vault is shared, so no new key material and no rotation story is introduced.
//
// What is encrypted here is personal data under GDPR and PSD2 minimisation (IBAN, holder name and
// contact), not cardholder data: the PAN belongs to the issuer vault, which arrives in P7.
export interface BankDeks {
  accountIban: Binary;
  accountHolderName: Binary;
  accountHolderEmail: Binary;
}

// QE:none, retrieval only. Nothing queries an account by IBAN on this side: the bank looks accounts up
// by their reference, and the routing derivation uses the IBAN bank code the caller supplies.
export function buildEncryptedFieldsMaps(deks: BankDeks): Record<string, { fields: unknown[] }> {
  return {
    [ACCOUNT_ARRANGEMENT_COLLECTION]: {
      fields: [
        { keyId: deks.accountIban, path: 'accountIban', bsonType: 'string' },
      ],
    },
    [ACCOUNT_HOLDER_COLLECTION]: {
      fields: [
        { keyId: deks.accountHolderName, path: 'accountHolderName', bsonType: 'string' },
        { keyId: deks.accountHolderEmail, path: 'accountHolderEmailAddress', bsonType: 'string' },
      ],
    },
  };
}
