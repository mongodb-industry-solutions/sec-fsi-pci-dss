import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../modules/customer/models/customerAgreement.model';
import { screenParty, screeningHash } from '../../providers/kyc/services/hrpScreening.service';

// v2: customerAgreements.json contains merged sensitive fields (address, govId, riskNotes).
// The QE client encrypts them with DEK-sensitive tier on write - no separate *Sensitive file.
//
// v27: deterministic KYC enrichment mirroring seedParties. Every new field (structured
// government ID, TIN, occupation, source of funds, purpose, and provider KYC verdicts) is
// populated so all 5 QE search types return demoable results. Values derive from the instance
// reference so they are stable across reseeds. Enrichment is idempotent: only absent fields are
// filled, so JSON-provided values always win.

// Stable non-negative hash (djb2). Reuses the screening engine's hash (single source of truth).
const hash = screeningHash;

const GOV_ID_TYPES = ['passport', 'national_id', 'driver_license'];
const COUNTRIES = ['ES', 'GB', 'US', 'FR', 'DE'];
const OCCUPATIONS = ['engineer', 'teacher', 'doctor', 'lawyer', 'analyst', 'nurse', 'plumber'];
const SOURCES_OF_FUNDS = ['salary', 'savings', 'investment', 'inheritance', 'business'];
const PURPOSES = ['personal_banking', 'business_banking', 'savings', 'payments'];

interface KycCheckSeed {
  customerAgreementKycCheckStatus?: string;
  customerAgreementKycCheckRiskScore?: number;
  customerAgreementKycCheckRiskRating?: 'low' | 'medium' | 'high';
  customerAgreementKycCheckPepStatus?: boolean;
  customerAgreementKycCheckSanctionsResult?: 'clear' | 'hit' | 'pending';
  customerAgreementKycCheckScreeningProviderRef?: string;
  [key: string]: unknown;
}

interface GovernmentIdSeed {
  type?: string;
  number?: string;
  issuingCountry?: string;
  expiryDate?: Date | string;
  [key: string]: unknown;
}

export interface CustomerAgreementSeed {
  customerAgreementInstanceReference: string;
  customerAgreementGovernmentID?: GovernmentIdSeed;
  customerAgreementTaxIDNumber?: string;
  customerAgreementOccupation?: string;
  customerAgreementSourceOfFunds?: string;
  customerAgreementPurposeOfRelationship?: string;
  customerAgreementKycCheck?: KycCheckSeed;
  [key: string]: unknown;
}

export function enrichKyc(record: CustomerAgreementSeed): void {
  const seed = hash(record.customerAgreementInstanceReference);
  const country = COUNTRIES[seed % COUNTRIES.length];

  // governmentIdentificationReference is deprecated since v27 and is never written (ADR-050).
  delete (record as { governmentIdentificationReference?: unknown }).governmentIdentificationReference;

  // Structured government ID (QE:equality type/issuingCountry, QE:suffix number, QE:range expiry).
  const gov: GovernmentIdSeed = record.customerAgreementGovernmentID ?? {};
  if (!gov.type) gov.type = GOV_ID_TYPES[(seed >>> 2) % GOV_ID_TYPES.length];
  if (!gov.issuingCountry) gov.issuingCountry = country;
  if (!gov.number) {
    // Some numbers end in 4821 (suffix demo); the rest vary deterministically.
    const suffix = seed % 4 === 0 ? '4821' : String(1000 + (seed % 9000));
    const body = String(10000 + ((seed >>> 4) % 90000));
    gov.number = `${gov.issuingCountry}${body}${suffix}`;
  }
  if (!gov.expiryDate) {
    // Spread expiries; ~1 in 5 falls within the next 90 days for the range demo.
    const soon = seed % 5 === 0;
    const base = Date.now();
    const offsetDays = soon ? (seed % 90) : (365 + (seed % 2000));
    gov.expiryDate = new Date(base + offsetDays * 86400000);
  } else if (typeof gov.expiryDate === 'string') {
    gov.expiryDate = new Date(gov.expiryDate);
  }
  record.customerAgreementGovernmentID = gov;

  // TIN (QE:prefix). Some start with 'ES' for the prefix demo.
  if (!record.customerAgreementTaxIDNumber) {
    const prefix = seed % 3 === 0 ? 'ES' : country;
    record.customerAgreementTaxIDNumber = `${prefix}${String(10000000 + ((seed >>> 5) % 89999999))}`;
  }

  if (!record.customerAgreementOccupation) {
    record.customerAgreementOccupation = OCCUPATIONS[(seed >>> 6) % OCCUPATIONS.length];
  }
  if (!record.customerAgreementSourceOfFunds) {
    record.customerAgreementSourceOfFunds = SOURCES_OF_FUNDS[(seed >>> 7) % SOURCES_OF_FUNDS.length];
  }
  if (!record.customerAgreementPurposeOfRelationship) {
    record.customerAgreementPurposeOfRelationship = PURPOSES[(seed >>> 8) % PURPOSES.length];
  }

  // Provider (HRP) verdicts on the KYC check sub-doc. Ensure the sub-doc exists first.
  // The verdict comes from the same deterministic screening engine the provider uses at runtime
  // (single source of truth), so seeded and provider-produced data agree.
  const kyc: KycCheckSeed = record.customerAgreementKycCheck ?? {};
  if (!kyc.customerAgreementKycCheckStatus) kyc.customerAgreementKycCheckStatus = 'verified';
  const verdict = screenParty(record.customerAgreementInstanceReference);
  if (kyc.customerAgreementKycCheckRiskScore === undefined) {
    kyc.customerAgreementKycCheckRiskScore = verdict.riskScore;
  }
  if (!kyc.customerAgreementKycCheckRiskRating) {
    // Derive from the effective score so a custom-seeded score keeps a consistent rating.
    const s = kyc.customerAgreementKycCheckRiskScore ?? 0;
    kyc.customerAgreementKycCheckRiskRating = s < 40 ? 'low' : s < 70 ? 'medium' : 'high';
  }
  if (kyc.customerAgreementKycCheckPepStatus === undefined) {
    kyc.customerAgreementKycCheckPepStatus = verdict.pepStatus;
  }
  if (!kyc.customerAgreementKycCheckSanctionsResult) {
    kyc.customerAgreementKycCheckSanctionsResult = verdict.sanctionsResult;
  }
  if (!kyc.customerAgreementKycCheckScreeningProviderRef) {
    kyc.customerAgreementKycCheckScreeningProviderRef = verdict.screeningProviderRef;
  }
  record.customerAgreementKycCheck = kyc;
}

export async function seedCustomers(db: Db) {
  const agreements: CustomerAgreementSeed[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../data/customerAgreements.json'), 'utf-8')
  );

  for (const record of agreements) {
    enrichKyc(record);
    await db.collection(CUSTOMER_AGREEMENT_COLLECTION).updateOne(
      { customerAgreementInstanceReference: record.customerAgreementInstanceReference },
      {
        $set: record,
        // $set cannot remove a field: unset the deprecated one on databases seeded before v32.
        $unset: { governmentIdentificationReference: '' },
      },
      { upsert: true }
    );
  }
  console.log(`  ${CUSTOMER_AGREEMENT_COLLECTION}: ${agreements.length} upserted (KYC enriched)`);
}
