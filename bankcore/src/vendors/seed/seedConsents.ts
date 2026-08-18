import { Db } from 'mongodb';
import {
  BANK_CONSENT_AGREEMENT_COLLECTION, BankConsentAgreementControlRecord, ConsentAccessScope,
} from '../../modules/consent/models/bankConsent.model';
import { readSeedFile } from './readSeedFile';
import { config } from '../../config';

// The seeded consents, one per account holder, landing **valid** whatever the consent mode is.
//
// That is a seed-time fact, not a runtime shortcut: the demo has to be operational the moment it is
// seeded, without anyone walking a linking flow, while `PSP_BANKCORE_CONSENT_MODE` still governs what
// happens to a consent CREATED at runtime. The protocol is not skipped, the human ceremony is.
interface ConsentSeedRecord {
  bankConsentAgreementInstanceReference: string;
  bankConsentAccountHolderInstanceReference: string;
  bankConsentAccess: ConsentAccessScope;
  bankConsentRecurringIndicator: boolean;
  bankConsentFrequencyPerDay: number;
  bankConsentValidUntil: string;
  recordCreatedDateTime: string;
}

export async function seedConsents(db: Db): Promise<number> {
  const records = readSeedFile<ConsentSeedRecord[]>('consents.json');
  const collection = db.collection<BankConsentAgreementControlRecord>(BANK_CONSENT_AGREEMENT_COLLECTION);

  for (const record of records) {
    const now = new Date().toISOString();
    await collection.updateOne(
      { bankConsentAgreementInstanceReference: record.bankConsentAgreementInstanceReference },
      {
        $set: {
          ...record,
          // The TPP is a seed-time input, like its credential: the fixture names no client.
          bankConsentTppClientId: config.bank.tppSeedClientId,
          bankConsentStatus: 'valid',
          bankConsentStatusReason: 'tpp_registered',
          bankConsentStatusChangedDateTime: record.recordCreatedDateTime,
          bankConsentLastActionDate: record.recordCreatedDateTime,
          bianServiceDomain: 'Customer Agreement',
          bianControlRecordType: 'CustomerAccessConsent',
          recordUpdatedDateTime: now,
          schemaVersion: 1,
        },
      },
      { upsert: true },
    );
  }
  console.log(`  ${BANK_CONSENT_AGREEMENT_COLLECTION}: ${records.length} consent(s) upserted, valid`);
  return records.length;
}
