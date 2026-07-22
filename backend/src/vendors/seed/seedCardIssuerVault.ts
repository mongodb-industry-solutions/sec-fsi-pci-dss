import { Db } from 'mongodb';
import { createHash } from 'node:crypto';
import { PAYMENT_CARD_COLLECTION } from '../../modules/customer/models/paymentCard.model';
import { upsertVaultRecord } from '../../providers/card-issuer/services/cardIssuerVault.service';
import { DEFAULT_SERVICE_CODE } from '../../providers/card-issuer/services/cardVerificationKey.service';
import { CARD_ISSUER_VAULT_COLLECTION } from '../../providers/card-issuer/models/cardIssuerVault.model';

// Deterministic issuer data derived from the STABLE surrogate token (never random), so the seed is
// idempotent (R6) and cross-references stay intact. Network-correct BIN + length; the display last4
// is preserved from the existing masked PAN.
const NETWORK_BIN: Record<string, { prefix: string; length: number }> = {
  VISA:       { prefix: '4',  length: 16 },
  MASTERCARD: { prefix: '52', length: 16 },
  AMEX:       { prefix: '34', length: 15 },
  ELO:        { prefix: '50', length: 16 },
};

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

// Build a deterministic full PAN: network BIN + deterministic middle digits + the display last4.
function buildPan(token: string, network: string, last4: string): { pan: string; bin: string } {
  const spec = NETWORK_BIN[network] ?? NETWORK_BIN.VISA;
  const bin = (spec.prefix + digitsFromToken(token, 6 - spec.prefix.length)).slice(0, 6);
  const middleLen = spec.length - bin.length - 4;
  const middle = digitsFromToken(`${token}:mid`, Math.max(0, middleLen));
  return { pan: `${bin}${middle}${last4}`, bin };
}

// Seed the issuer PAN vault (module-owned CDE) + populate core BIN/last4 from the deterministic PAN.
// The full PAN NEVER lands in the core; the core keeps token + BIN + last4 only (descoped).
export async function seedCardIssuerVault(db: Db) {
  const cards = await db.collection(PAYMENT_CARD_COLLECTION).find({}).toArray();
  let vaulted = 0;
  for (const card of cards) {
    const token = String(card.paymentCardReference ?? '');
    const network = String(card.paymentCardNetwork ?? 'VISA').toUpperCase();
    const last4 = String(card.paymentCardMaskedPanDisplay ?? card.paymentCardLast4 ?? '').replace(/\D/g, '').slice(-4)
      || digitsFromToken(`${token}:l4`, 4);
    const { pan, bin } = buildPan(token, network, last4);

    // Core stays descoped: set BIN/last4 (non-CHD), drop any persisted masked (now derived).
    await db.collection(PAYMENT_CARD_COLLECTION).updateOne(
      { paymentCardInstanceReference: card.paymentCardInstanceReference },
      { $set: { paymentCardBin: bin, paymentCardLast4: last4 }, $unset: { paymentCardMaskedPanDisplay: '' } },
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
