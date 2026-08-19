import { getCardIssuerCvk, derivePerCardCvv, DEFAULT_SERVICE_CODE } from '../../../vendors/encryption/cardVerificationKey.service';
import { getQEClient } from '../../../vendors/encryption/qeClient';

// Bridges the pure validation rules to the issuer's key material: the rules decide, this resolves the
// value they compare against.
//
// It NEVER throws. An unresolvable key means the per-card value is simply unavailable, and the rules then
// fall back to whatever else the configured mode allows. Throwing here would turn a key vault problem into
// a blanket decline that looks like every card on the platform failing at once.
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
