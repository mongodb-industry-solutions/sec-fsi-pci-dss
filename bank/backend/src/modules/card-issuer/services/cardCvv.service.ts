import { getCardIssuerCvk, derivePerCardCvv, DEFAULT_SERVICE_CODE } from '../../../vendors/encryption/cardVerificationKey.service';
import { getQEClient } from '../../../vendors/encryption/qeClient';

// Bridges the pure validation rules to the issuer's key material: the rules decide, this resolves what
// they compare against. It never throws, because a key vault problem must not read as every card on the
// platform declining at once.
export async function deriveCvvForCard(
  args: { cardToken?: string; expiry?: string; serviceCode?: string; cvvLength: number },
  log?: { warn: (message: string) => void },
): Promise<string | undefined> {
  if (!args.cardToken || !args.expiry) return undefined;
  try {
    const cvk = await getCardIssuerCvk(await getQEClient());
    return derivePerCardCvv(cvk, {
      cardToken: args.cardToken,
      expiryMMYY: args.expiry,
      serviceCode: args.serviceCode ?? DEFAULT_SERVICE_CODE,
      cvvLength: args.cvvLength,
    });
  } catch (error) {
    log?.warn(`card verification key unavailable, per-card value not derived: ${(error as Error).message}`);
    return undefined;
  }
}
