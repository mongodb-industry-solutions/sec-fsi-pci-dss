import { Db } from 'mongodb';
import { BANK_PROFILE_COLLECTION } from '../../modules/aspsp/models/bankProfile.model';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../modules/aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION } from '../../modules/aspsp/models/accountHolder.model';
import { ACCOUNT_MOVEMENT_COLLECTION } from '../../modules/aspsp/models/accountMovement.model';
import { BALANCE_CREDIT_LOG_COLLECTION } from '../../modules/aspsp/models/balanceCreditLog.model';
import { TPP_REGISTRATION_COLLECTION } from '../../modules/tpp-trust/models/tppRegistration.model';
import { buildEncryptedFieldsMaps, BankDeks } from '../encryption/encryptedFieldsMaps';
import { DOMAIN_EVENT_COLLECTION } from '@leafypay/eventbus';

// Infrastructure of the bank database. Each later phase adds its own collections here rather than
// declaring them early: setup SKIPS a collection that already exists, so a collection created now
// with the wrong encryptedFields would need a drop to fix.
export const COUNTERS_COLLECTION = 'counters';
export const IDEMPOTENCY_COLLECTION = 'idempotencyKey';

interface PlainCollection {
  name: string;
  purpose: string;
}

// Collections with no Queryable Encryption. QE-bearing ones arrive with the phase that owns them.
const PLAIN_COLLECTIONS: PlainCollection[] = [
  { name: BANK_PROFILE_COLLECTION, purpose: 'bank identity and routing keys (BIC, IBAN bank codes, BIN ranges)' },
  { name: ACCOUNT_MOVEMENT_COLLECTION, purpose: 'explicit ledger movements, so the ledger is reconcilable' },
  { name: BALANCE_CREDIT_LOG_COLLECTION, purpose: 'audit trail of every balance credit' },
  { name: DOMAIN_EVENT_COLLECTION, purpose: "bankcore's own domain event store" },
  { name: TPP_REGISTRATION_COLLECTION, purpose: 'registered third parties: client id, secret hash, scopes, roles' },
  { name: COUNTERS_COLLECTION, purpose: 'sequence counters, own instance' },
  { name: IDEMPOTENCY_COLLECTION, purpose: 'idempotency keys, own instance' },
];

// Collections carrying Queryable Encryption. Created WITH their encryptedFields, because setup skips
// an existing collection: changing the map later needs a drop or --reset.
const QE_COLLECTIONS: Record<string, string> = {
  [ACCOUNT_ARRANGEMENT_COLLECTION]: 'the real account and its balance (IBAN encrypted)',
  [ACCOUNT_HOLDER_COLLECTION]: "the bank's own account holder (name and contact encrypted)",
};

export async function createCollections(db: Db, deks: BankDeks, reset = false): Promise<void> {
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  const existingNames = new Set(existing.map((c) => c.name));
  const maps = buildEncryptedFieldsMaps(deks);

  for (const [name, purpose] of Object.entries(QE_COLLECTIONS)) {
    if (existingNames.has(name) && !reset) {
      console.log(`  skip:    ${name} (already exists; encryptedFields changes need --reset)`);
      continue;
    }
    if (existingNames.has(name)) {
      await db.collection(name).drop();
      console.log(`  dropped: ${name}`);
    }
    await db.createCollection(name, { encryptedFields: maps[name] as never });
    console.log(`  created: ${name} (QE) (${purpose})`);
  }

  for (const { name, purpose } of PLAIN_COLLECTIONS) {
    if (existingNames.has(name) && !reset) {
      console.log(`  skip:    ${name} (already exists)`);
      continue;
    }
    if (existingNames.has(name)) {
      await db.collection(name).drop();
      console.log(`  dropped: ${name}`);
    }
    await db.createCollection(name);
    console.log(`  created: ${name} (${purpose})`);
  }
}
