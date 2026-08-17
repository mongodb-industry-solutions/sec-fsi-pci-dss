import { Db } from 'mongodb';
import { BANK_PROFILE_COLLECTION } from '../../modules/aspsp/models/bankProfile.model';
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
  { name: DOMAIN_EVENT_COLLECTION, purpose: "bankcore's own domain event store" },
  { name: COUNTERS_COLLECTION, purpose: 'sequence counters, own instance' },
  { name: IDEMPOTENCY_COLLECTION, purpose: 'idempotency keys, own instance' },
];

export async function createCollections(db: Db, reset = false): Promise<void> {
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  const existingNames = new Set(existing.map((c) => c.name));

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
