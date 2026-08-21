import { Db } from 'mongodb';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CARD_ISSUER_VAULT_COLLECTION, ISSUED_CARD_REGISTRY_COLLECTION,
  CardIssuerVaultRecord, IssuedCardRegistryRecord,
} from '../../modules/card-issuer/models/cardIssuerVault.model';
import { DEFAULT_SERVICE_CODE } from '../encryption/cardVerificationKey.service';
import { BANK_PROFILE_COLLECTION } from '../../modules/aspsp/models/bankProfile.model';
import { seedDataDir } from './readSeedFile';

// Issues this bank's cards: the vault holding the PAN, and the registry holding everything else.
//
// The card list is read from the PSP's fixture at seed time, the mirror of the PSP reading this bank's
// declared BIN ranges, so both sides agree on which cards exist. The PAN is derived from the surrogate
// token rather than random, so a reseed reproduces it and nothing cross-referencing it breaks. The BIN
// comes from this bank's declared ranges: a card outside every range is unroutable.

const NETWORK_LENGTH: Record<string, number> = {
  VISA: 16, MASTERCARD: 16, AMEX: 15, ELO: 16,
};

interface BinRange { binRangeFrom: string; binRangeTo: string; binRangeScheme?: string }

interface PspCardFixture {
  paymentCardInstanceReference: string;
  paymentCardReference: string;
  paymentCardMaskedPanDisplay?: string;
  paymentCardLast4?: string;
  paymentCardNetwork?: string;
  paymentCardStatus?: string;
  paymentCardExpirationDate?: string;
  customerAgreementInstanceReference?: string;
  fundingPayoutAccountInstanceReference?: string;
}

// Stable digits from a token: the same input always yields the same output, which is why a reseed is safe.
function digitsFromToken(token: string, count: number): string {
  let out = '';
  let round = 0;
  while (out.length < count) {
    const hash = createHash('sha256').update(`${token}:${round}`).digest('hex');
    round += 1;
    out += BigInt(`0x${hash}`).toString().replace(/\D/g, '');
  }
  return out.slice(0, count);
}

export function buildPan(
  token: string, network: string, lastFour: string, ranges: Record<string, BinRange>,
): { pan: string; bin: string } {
  const length = NETWORK_LENGTH[network] ?? NETWORK_LENGTH.VISA;
  const range = ranges[network] ?? ranges.VISA;
  if (!range) throw new Error(`no issuer BIN range declared for ${network}; the card would be unroutable`);
  const span = Number(range.binRangeTo) - Number(range.binRangeFrom) + 1;
  const offset = Number(digitsFromToken(`${token}:bin`, 6)) % span;
  const bin = String(Number(range.binRangeFrom) + offset).padStart(range.binRangeFrom.length, '0');
  const middle = digitsFromToken(`${token}:mid`, Math.max(0, length - bin.length - 4));
  return { pan: `${bin}${middle}${lastFour}`, bin };
}

// This bank's own ranges, from what it already seeded about itself.
async function issuerBinRanges(db: Db): Promise<Record<string, BinRange>> {
  const profile = await db.collection<{ bankProfileBinRanges?: BinRange[] }>(BANK_PROFILE_COLLECTION).findOne({});
  const byScheme: Record<string, BinRange> = {};
  for (const range of profile?.bankProfileBinRanges ?? []) {
    if (range.binRangeScheme) byScheme[range.binRangeScheme.toUpperCase()] = range;
  }
  return byScheme;
}

// Absent when the bank is deployed alone, which just means no customer cards to issue.
function readPspCardFixture(): PspCardFixture[] | null {
  const candidates = [
    resolve(seedDataDir(), '../../../psp/backend/data/paymentCards.json'),
    resolve(__dirname, '../../../../../psp/backend/data/paymentCards.json'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as PspCardFixture[];
  }
  return null;
}

function expiryParts(card: PspCardFixture): { month?: string; year?: string } {
  const match = (card.paymentCardExpirationDate ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) return {};
  return { month: match[1].padStart(2, '0'), year: match[2] };
}

export async function seedCardIssuer(db: Db): Promise<number> {
  const cards = readPspCardFixture();
  if (!cards) {
    console.log(`  ${CARD_ISSUER_VAULT_COLLECTION}: no card fixture found, nothing issued`);
    return 0;
  }
  const ranges = await issuerBinRanges(db);
  const now = new Date().toISOString();
  let issued = 0;

  for (const card of cards) {
    const token = String(card.paymentCardReference ?? '');
    if (!token) continue;
    const network = String(card.paymentCardNetwork ?? 'VISA').toUpperCase();
    const lastFour = String(card.paymentCardMaskedPanDisplay ?? card.paymentCardLast4 ?? '')
      .replace(/\D/g, '').slice(-4) || digitsFromToken(`${token}:l4`, 4);
    const { pan, bin } = buildPan(token, network, lastFour, ranges);
    const status = card.paymentCardStatus === 'blocked' ? 'suspended' : 'active';
    const { month, year } = expiryParts(card);

    // PAN and service code, both encrypted, keyed by the token every later request arrives with.
    await db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION).updateOne(
      { paymentCardReference: token },
      {
        $set: {
          issuedCardInstanceReference: `iss_${card.paymentCardInstanceReference}`,
          paymentCardInstanceReference: String(card.paymentCardInstanceReference),
          paymentCardNumber: pan,
          cardServiceCode: DEFAULT_SERVICE_CODE,
          cardIssuerCvkKeyId: 'cvk-card-issuer-cvk',
          issuedCardStatus: status,
          bianServiceDomain: 'Card Administration',
          bianControlRecordType: 'CardAdministration',
          recordUpdatedDateTime: now,
          schemaVersion: 1,
        },
        $setOnInsert: { paymentCardReference: token, recordCreatedDateTime: now },
      },
      { upsert: true },
    );

    // What a display read needs, and deliberately no PAN.
    await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION).updateOne(
      { paymentCardReference: token },
      {
        $set: {
          issuedCardRegistryInstanceReference: `reg_${card.paymentCardInstanceReference}`,
          paymentCardNetwork: network,
          paymentCardBin: bin,
          paymentCardLastFour: lastFour,
          paymentCardMaskedDisplay: `****-****-****-${lastFour}`,
          ...(month && year ? { paymentCardExpiryMonth: month, paymentCardExpiryYear: year } : {}),
          issuedCardStatus: status,
          bianServiceDomain: 'Payment Card',
          bianControlRecordType: 'IssuedCardRegistry',
          recordUpdatedDateTime: now,
          schemaVersion: 1,
        },
        $setOnInsert: { paymentCardReference: token, recordCreatedDateTime: now },
      },
      { upsert: true },
    );
    issued += 1;
  }

  console.log(`  ${CARD_ISSUER_VAULT_COLLECTION}: ${issued} PAN(s) vaulted (QE), registry populated with BIN and last four`);
  return issued;
}
