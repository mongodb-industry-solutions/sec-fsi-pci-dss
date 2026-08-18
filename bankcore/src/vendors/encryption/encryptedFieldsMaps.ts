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

// `accountIban` carries an EQUALITY query type, the holder's fields do not (retrieval only).
//
// The IBAN needs it because the standard addresses accounts by IBAN in the places where the caller
// cannot know a bank's internal reference yet: Berlin Group's consent access object names IBANs, and so
// does the routing derivation for an account a user has just typed in. Without the index the driver
// rejects the lookup outright ("Can only execute encrypted equality queries with an encrypted equality
// index"), which is how this was found, and the only alternative would have been a non standard
// endpoint that takes the bank's own reference instead.
// A name or an email is only ever displayed, never searched from this side, so neither gets an index it
// would not use.
export function buildEncryptedFieldsMaps(deks: BankDeks): Record<string, { fields: unknown[] }> {
  return {
    [ACCOUNT_ARRANGEMENT_COLLECTION]: {
      fields: [
        { keyId: deks.accountIban, path: 'accountIban', bsonType: 'string', queries: { queryType: 'equality' } },
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
