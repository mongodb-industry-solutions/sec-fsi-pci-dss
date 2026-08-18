import { Db } from 'mongodb';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAYMENT_CARD_COLLECTION } from '../../modules/customer/models/paymentCard.model';
import { upsertVaultRecord } from '../../providers/card-issuer/services/cardIssuerVault.service';
import { DEFAULT_SERVICE_CODE } from '../../providers/card-issuer/services/cardVerificationKey.service';
import { CARD_ISSUER_VAULT_COLLECTION } from '../../providers/card-issuer/models/cardIssuerVault.model';

// Deterministic issuer data derived from the STABLE surrogate token (never random), so the seed is
// idempotent (R6) and cross-references stay intact. Network-correct length; the display last4 is
// preserved from the existing masked PAN.
//
// v37: the BIN is the ISSUER's, read from the registered bank's declared ranges, not a bare network
// prefix. A card whose BIN falls outside every registered range is unroutable: nothing can decide
// which issuer owns it, and the router refuses it rather than picking a default.
const NETWORK_LENGTH: Record<string, number> = {
  VISA: 16,
  MASTERCARD: 16,
  AMEX: 15,
  ELO: 16,
};

interface BinRange { binRangeFrom: string; binRangeTo: string; binRangeScheme?: string }

// The bank's own ranges. Read from the bank fixture so the two sides cannot drift: bankcore is the
// issuer of record from P7 onward, and its bankProfile is where its BIN ranges live.
function issuerBinRanges(): Record<string, BinRange> {
  const fixture = join(__dirname, '../../../../bankcore/data/bankProfile.json');
  const profiles = JSON.parse(readFileSync(fixture, 'utf8')) as Array<{ bankProfileBinRanges: BinRange[] }>;
  const bySchemeName: Record<string, BinRange> = {};
  for (const range of profiles[0]?.bankProfileBinRanges ?? []) {
    if (range.binRangeScheme) bySchemeName[range.binRangeScheme.toUpperCase()] = range;
  }
  return bySchemeName;
}

function digitsFromToken(token: string, n: number): string {
  // Stable pseudo-random digits from the token hash.
  let out = '';
  let i = 0;
  while (out.length < n) {
    const h = createHash('sha256').update(`${token}:${i++}`).digest('hex');
    out += BigInt(`0x${h}`).toString().replace(/\D/g, '');
  }
  return out.slice(0, n);
}

// Build a deterministic full PAN: issuer BIN inside the declared range + middle digits + last4.
function buildPan(token: string, network: string, last4: string, ranges: Record<string, BinRange>): { pan: string; bin: string } {
  const length = NETWORK_LENGTH[network] ?? NETWORK_LENGTH.VISA;
  const range = ranges[network] ?? ranges.VISA;
  if (!range) throw new Error(`no issuer BIN range declared for ${network}; the card would be unroutable`);
  // Spread deterministically INSIDE the range, so every seeded card is routable to this issuer.
  const span = Number(range.binRangeTo) - Number(range.binRangeFrom) + 1;
  const offset = Number(digitsFromToken(`${token}:bin`, 6)) % span;
  const bin = String(Number(range.binRangeFrom) + offset).padStart(range.binRangeFrom.length, '0');
  const middle = digitsFromToken(`${token}:mid`, Math.max(0, length - bin.length - 4));
  return { pan: `${bin}${middle}${last4}`, bin };
}

// Seed the issuer PAN vault (module-owned CDE) + populate core BIN/last4 from the deterministic PAN.
// The full PAN NEVER lands in the core; the core keeps token + BIN + last4 only (descoped).
export async function seedCardIssuerVault(db: Db) {
  const cards = await db.collection(PAYMENT_CARD_COLLECTION).find({}).toArray();
  const ranges = issuerBinRanges();
  let vaulted = 0;
  for (const card of cards) {
    const token = String(card.paymentCardReference ?? '');
    const network = String(card.paymentCardNetwork ?? 'VISA').toUpperCase();
    const last4 = String(card.paymentCardMaskedPanDisplay ?? card.paymentCardLast4 ?? '').replace(/\D/g, '').slice(-4)
      || digitsFromToken(`${token}:l4`, 4);
    const { pan, bin } = buildPan(token, network, last4, ranges);

    // Core stays descoped: set BIN/last4 (non-CHD) and a derived masked display (last4 only). Several
    // read paths return paymentCardMaskedPanDisplay directly, so keep it populated (never blank) rather
    // than unsetting it. The value exposes only the last 4 (PCI DSS-permitted display).
    await db.collection(PAYMENT_CARD_COLLECTION).updateOne(
      { paymentCardInstanceReference: card.paymentCardInstanceReference },
      { $set: { paymentCardBin: bin, paymentCardLast4: last4, paymentCardMaskedPanDisplay: `****-****-****-${last4}` } },
    );

    // Issuer vault: full PAN (QE) + service code (QE) + CVK reference. Keyed by the core PK.
    await upsertVaultRecord(db, {
      issuedCardInstanceReference: `iss_${String(card.paymentCardInstanceReference)}`,
      paymentCardReference: token,
      paymentCardInstanceReference: String(card.paymentCardInstanceReference),
      paymentCardNumber: pan,
      cardServiceCode: DEFAULT_SERVICE_CODE,
      cardIssuerCvkKeyId: 'cvk-card-issuer-cvk',
      issuedCardStatus: 'active',
    });
    vaulted++;
  }
  console.log(`  ${CARD_ISSUER_VAULT_COLLECTION}: ${vaulted} PANs vaulted (QE); core BIN/last4 populated, masked derived`);
}
