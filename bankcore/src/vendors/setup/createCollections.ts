import { Db } from 'mongodb';
import { BANK_PROFILE_COLLECTION } from '../../modules/aspsp/models/bankProfile.model';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../modules/aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION } from '../../modules/aspsp/models/accountHolder.model';
import { ACCOUNT_MOVEMENT_COLLECTION } from '../../modules/aspsp/models/accountMovement.model';
import { BALANCE_CREDIT_LOG_COLLECTION } from '../../modules/aspsp/models/balanceCreditLog.model';
import { TPP_REGISTRATION_COLLECTION } from '../../modules/tpp-trust/models/tppRegistration.model';
import { BANK_CONSENT_AGREEMENT_COLLECTION, BANK_CONSENT_ACCESS_LOG_COLLECTION } from '../../modules/consent/models/bankConsent.model';
import { PAYMENT_INITIATION_COLLECTION } from '../../modules/pisp/models/paymentInitiation.model';
import { BANK_MODULE_CONFIGURATION_COLLECTION } from '../../modules/admin/models/bankModuleConfiguration.model';
import {
  TPP_EVENT_SUBSCRIPTION_COLLECTION, TPP_WEBHOOK_DELIVERY_LOG_COLLECTION,
} from '../../modules/tpp-trust/models/tppEventSubscription.model';
import {
  COUNTERPARTY_BANK_COLLECTION, INTERBANK_MESSAGE_LOG_COLLECTION,
} from '../../modules/payment-hub/models/counterpartyBank.model';
import {
  CARD_ISSUER_VAULT_COLLECTION, ISSUED_CARD_REGISTRY_COLLECTION,
} from '../../modules/card-issuer/models/cardIssuerVault.model';
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
  // No encrypted fields on either: the consent stores account REFERENCES, not IBANs, so the personal
  // datum stays in the one encrypted place that already holds it.
  { name: BANK_CONSENT_AGREEMENT_COLLECTION, purpose: 'account access consent per third party and account set' },
  { name: BANK_CONSENT_ACCESS_LOG_COLLECTION, purpose: 'evidence of every consent-checked access, granted and refused' },
  // The bank's own payment record. It holds the creditor IBAN a caller supplied, which is third party
  // personal data the bank has no basis to make searchable, so it is stored as sent and never queried by.
  { name: PAYMENT_INITIATION_COLLECTION, purpose: 'payments initiated by a third party, through their lifecycle' },
  { name: BANK_MODULE_CONFIGURATION_COLLECTION, purpose: "configuration of the bank's own engines, edited over its admin API" },
  { name: TPP_EVENT_SUBSCRIPTION_COLLECTION, purpose: 'where the bank delivers notifications, and how it signs them' },
  { name: TPP_WEBHOOK_DELIVERY_LOG_COLLECTION, purpose: 'one row per delivery attempt, so a silent failure is visible' },
  { name: COUNTERPARTY_BANK_COLLECTION, purpose: 'reachable institutions: BIC, schemes, correspondent, cut-off' },
  { name: INTERBANK_MESSAGE_LOG_COLLECTION, purpose: 'pacs.008 sent, pacs.002 and pacs.004 received, for reconciliation' },
  // The issuer's registry. No PAN by design, which is why it is here and not among the QE collections:
  // a display lookup must not open the collection that holds cardholder data.
  { name: ISSUED_CARD_REGISTRY_COLLECTION, purpose: 'cards this bank issued: network, BIN, last four, lifecycle' },
  { name: COUNTERS_COLLECTION, purpose: 'sequence counters, own instance' },
  { name: IDEMPOTENCY_COLLECTION, purpose: 'idempotency keys, own instance' },
];

// Collections carrying Queryable Encryption. Created WITH their encryptedFields, because setup skips
// an existing collection: changing the map later needs a drop or --reset.
const QE_COLLECTIONS: Record<string, string> = {
  [ACCOUNT_ARRANGEMENT_COLLECTION]: 'the real account and its balance (IBAN encrypted)',
  [ACCOUNT_HOLDER_COLLECTION]: "the bank's own account holder (name and contact encrypted)",
  [CARD_ISSUER_VAULT_COLLECTION]: 'the issuer CDE: the only full PAN on this platform (PAN and service code encrypted)',
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
