import { Db } from 'mongodb';
import * as path from 'path';
import * as fs from 'fs';
import { PARTY_COLLECTION, PartyPostalAddress } from '../../modules/identity/models/party.model';
import { phoneDigest } from '../encryption/digest';

// Deterministic KYC/demographic backfill (BIAN SD-13 Party Reference Data). Applies uniformly to
// every party (customer + employee), so staff profiles are as realistic as customers' — KYC-typical
// data (DOB, nationality, postal address) belongs to the Party record, not the customer agreement.
// Values are derived from partyInstanceReference so they are stable across reseeds (no ID churn).

// Phone country prefix → ISO 3166-1 alpha-2 (used to infer nationality when absent).
const PHONE_PREFIX_COUNTRY: Array<[string, string]> = [
  ['+34', 'ES'], ['+44', 'GB'], ['+1', 'US'], ['+33', 'FR'], ['+39', 'IT'],
  ['+49', 'DE'], ['+48', 'PL'], ['+52', 'MX'], ['+234', 'NG'], ['+351', 'PT'],
];

// Realistic address pools per country (street + city + postal format).
const ADDRESS_POOLS: Record<string, PartyPostalAddress[]> = {
  ES: [
    { line1: 'Calle de Alcalá 128', city: 'Madrid', postalCode: '28009', countryCode: 'ES' },
    { line1: 'Carrer de Balmes 45', city: 'Barcelona', postalCode: '08007', countryCode: 'ES' },
    { line1: 'Avenida de la Constitución 12', city: 'Sevilla', postalCode: '41004', countryCode: 'ES' },
  ],
  GB: [
    { line1: '221B Baker Street', city: 'London', postalCode: 'NW1 6XE', countryCode: 'GB' },
    { line1: '14 King Street', city: 'Manchester', postalCode: 'M2 6AG', countryCode: 'GB' },
  ],
  US: [
    { line1: '350 Fifth Avenue', line2: 'Apt 21', city: 'New York', postalCode: '10118', countryCode: 'US' },
    { line1: '1600 Market Street', city: 'San Francisco', postalCode: '94102', countryCode: 'US' },
  ],
  FR: [{ line1: '18 Rue de Rivoli', city: 'Paris', postalCode: '75004', countryCode: 'FR' }],
  IT: [{ line1: 'Via del Corso 200', city: 'Roma', postalCode: '00186', countryCode: 'IT' }],
  DE: [{ line1: 'Friedrichstraße 43', city: 'Berlin', postalCode: '10117', countryCode: 'DE' }],
  PL: [{ line1: 'ul. Nowy Świat 22', city: 'Warszawa', postalCode: '00-029', countryCode: 'PL' }],
  MX: [{ line1: 'Av. Paseo de la Reforma 222', city: 'Ciudad de México', postalCode: '06600', countryCode: 'MX' }],
  NG: [{ line1: '15 Adeola Odeku Street', city: 'Lagos', postalCode: '101241', countryCode: 'NG' }],
  PT: [{ line1: 'Rua Augusta 100', city: 'Lisboa', postalCode: '1100-053', countryCode: 'PT' }],
};

// Stable non-negative hash of a string (djb2) → used to pick deterministic values.
function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

function inferCountry(phone: string | undefined): string {
  if (phone) {
    const normalized = phone.replace(/\s/g, '');
    for (const [prefix, country] of PHONE_PREFIX_COUNTRY) {
      if (normalized.startsWith(prefix)) return country;
    }
  }
  return 'ES'; // .es digital bank — default residence
}

interface PartySeedRecord {
  partyInstanceReference: string;
  partyMobilePhoneNumber?: string;
  partyMobilePhoneNumberDigest?: string;
  partyDateOfBirth?: string;
  partyNationality?: string;
  partyPostalAddress?: PartyPostalAddress;
  [key: string]: unknown;
}

function enrichDemographics(record: PartySeedRecord): void {
  const seed = hash(record.partyInstanceReference);
  const country = record.partyNationality ?? inferCountry(record.partyMobilePhoneNumber);

  if (!record.partyNationality) record.partyNationality = country;

  if (!record.partyDateOfBirth) {
    // Deterministic DOB in the 1965–1999 range (age ~27–61 at 2026).
    const year = 1965 + (seed % 35);
    const month = (seed >> 3) % 12 + 1;
    const day = (seed >> 6) % 28 + 1;
    record.partyDateOfBirth = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (!record.partyPostalAddress) {
    const pool = ADDRESS_POOLS[country] ?? ADDRESS_POOLS.ES;
    record.partyPostalAddress = pool[seed % pool.length];
  }
}

export async function seedParties(db: Db) {
  const filePath = path.join(__dirname, '../../../data/parties.json');
  const records: PartySeedRecord[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  let upserted = 0;
  for (const record of records) {
    // Derive the blind-index digest so the unique index on partyMobilePhoneNumberDigest
    // is populated (partyMobilePhoneNumber itself is QE-encrypted and cannot be unique).
    if (record.partyMobilePhoneNumber) {
      record.partyMobilePhoneNumberDigest = phoneDigest(record.partyMobilePhoneNumber);
    }
    // Backfill KYC-typical demographics (SD-13) so every party — staff included — is realistic.
    enrichDemographics(record);

    await db.collection(PARTY_COLLECTION).updateOne(
      { partyInstanceReference: record.partyInstanceReference },
      { $set: record },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`  ${PARTY_COLLECTION}: ${upserted} upserted (KYC demographics backfilled)`);
}
