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
import {
  ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord,
} from '../../modules/aspsp/models/accountArrangement.model';
import { seedDataDir } from './readSeedFile';

// Issues this bank's cards: the vault holding the PAN, and the registry holding everything else.
//
// The card list is read from the PSP's fixture at seed time, the mirror of the PSP reading this bank's
// declared BIN ranges, so both sides agree on which cards exist. The PAN is derived from the surrogate
// token rather than random, so a reseed reproduces it and nothing cross-referencing it breaks. The BIN
// comes from this bank's declared ranges: a card outside every range is unroutable.
//
// Every card is also LINKED to the account it draws on and the party who owns it, and that is not decoration.
// A debit card is a claim on a balance: an authorisation is a hold against a specific account, so a card with
// no funding account is a card no authorisation can be judged against. The registry carried both fields and
// nothing filled them, which left every card looking ownerless on screen and left the authorisation engine
// with nothing to hold against.
//
// The link is resolved through the PSP's payout account, which is where it exists: the card names a payout
// account, the payout account names an account AT THIS BANK, and the bank's own account record names its
// holder. The holder is taken from the bank's record rather than the PSP's fixture on purpose, because the
// banking relationship is the bank's to know.

const NETWORK_LENGTH: Record<string, number> = {
  VISA: 16, MASTERCARD: 16, AMEX: 15, ELO: 16,
};

interface BinRange { binRangeFrom: string; binRangeTo: string; binRangeScheme?: string }

interface PspPayoutAccountFixture {
  payoutAccountInstanceReference: string;
  payoutAccountBankAccountReference?: string;
}

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
function readPspFixture<T>(name: string): T[] | null {
  const candidates = [
    resolve(seedDataDir(), `../../../psp/backend/data/${name}`),
    resolve(__dirname, `../../../../../psp/backend/data/${name}`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as T[];
  }
  return null;
}

/**
 * Where each card's money comes from: the account at THIS bank that funds it, and the party that owns it.
 *
 * Two hops, because that is how the link is actually recorded. The card names a payout account at the
 * provider; that payout account names an account arrangement here; this bank's own account record names the
 * holder. Reading the holder from the bank's record rather than the provider's fixture matters: the provider
 * knows who its user is, and the bank knows whose account it holds, and those are different facts.
 */
async function fundingIndex(db: Db): Promise<Map<string, { account: string; holder?: string }>> {
  const payoutAccounts = readPspFixture<PspPayoutAccountFixture>('payoutAccounts.json') ?? [];
  const bankAccounts = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .find({}, { projection: { _id: 0, accountArrangementInstanceReference: 1, accountHolderInstanceReference: 1 } })
    .toArray();
  const holderByAccount = new Map(
    bankAccounts.map((account) => [
      account.accountArrangementInstanceReference, account.accountHolderInstanceReference,
    ]),
  );

  const index = new Map<string, { account: string; holder?: string }>();
  for (const payout of payoutAccounts) {
    const account = payout.payoutAccountBankAccountReference;
    // A payout account that names no account here is one held at another institution. Skipped rather than
    // linked to nothing: a card pointing at an account this bank does not hold would be worse than a card
    // pointing at none.
    if (!account || !holderByAccount.has(account)) continue;
    index.set(payout.payoutAccountInstanceReference, { account, holder: holderByAccount.get(account) });
  }
  return index;
}

/**
 * Every card gets an expiry, and it has to.
 *
 * A card with no expiry is not a card: the date is embossed on it, a terminal sends it in the authorisation,
 * and the verification value is DERIVED from it. Without one, the issuer can produce no verification value at
 * all, so an operator asking to see it gets an explanation instead of a value and the reveal is decorative.
 * The provider's fixture carries no expiry for any of its cards, which is exactly what that looked like.
 *
 * So it is derived from the token when the fixture has none, deterministically, the same way the number is: a
 * reseed reproduces the same date, and anything that cross-references it keeps working. Two to five years out,
 * which is the range a real issuer uses.
 */
function expiryParts(card: PspCardFixture): { month: string; year: string } {
  const declared = (card.paymentCardExpirationDate ?? '').trim()
    .match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (declared) return { month: declared[1].padStart(2, '0'), year: declared[2] };

  const token = card.paymentCardReference;
  const month = String((Number(digitsFromToken(`${token}:exp-month`, 4)) % 12) + 1).padStart(2, '0');
  const year = String(new Date().getFullYear() + 2 + (Number(digitsFromToken(`${token}:exp-year`, 4)) % 4));
  return { month, year };
}

export async function seedCardIssuer(db: Db): Promise<number> {
  const cards = readPspFixture<PspCardFixture>('paymentCards.json');
  if (!cards) {
    console.log(`  ${CARD_ISSUER_VAULT_COLLECTION}: no card fixture found, nothing issued`);
    return 0;
  }
  const ranges = await issuerBinRanges(db);
  const funding = await fundingIndex(db);
  const now = new Date().toISOString();
  let issued = 0;
  let unfunded = 0;

  for (const card of cards) {
    const token = String(card.paymentCardReference ?? '');
    if (!token) continue;
    const network = String(card.paymentCardNetwork ?? 'VISA').toUpperCase();
    const lastFour = String(card.paymentCardMaskedPanDisplay ?? card.paymentCardLast4 ?? '')
      .replace(/\D/g, '').slice(-4) || digitsFromToken(`${token}:l4`, 4);
    const { pan, bin } = buildPan(token, network, lastFour, ranges);
    const status = card.paymentCardStatus === 'blocked' ? 'suspended' : 'active';
    const { month, year } = expiryParts(card);
    const linked = funding.get(String(card.fundingPayoutAccountInstanceReference ?? ''));
    if (!linked) unfunded += 1;

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
          ...(linked ? {
            accountArrangementInstanceReference: linked.account,
            ...(linked.holder ? { accountHolderInstanceReference: linked.holder } : {}),
          } : {}),
          paymentCardNetwork: network,
          // Debit, stated rather than assumed. Every card this bank issues today draws on the account above,
          // which is what makes an authorisation a hold rather than a line of credit.
          paymentCardKind: 'debit',
          paymentCardBin: bin,
          paymentCardLastFour: lastFour,
          paymentCardMaskedDisplay: `****-****-****-${lastFour}`,
          paymentCardExpiryMonth: month,
          paymentCardExpiryYear: year,
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
  // Said out loud rather than left to be noticed on a screen: a card with no funding account is one no
  // authorisation can be held against, so a non-zero count here is a broken demonstration, not a detail.
  if (unfunded > 0) {
    console.log(`  ${ISSUED_CARD_REGISTRY_COLLECTION}: ${unfunded} card(s) have no funding account at this bank`);
  }
  return issued;
}
