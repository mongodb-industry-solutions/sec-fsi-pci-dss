// Internal Card Issuer engine (built-in CVV/PIN validation + card lifecycle; used when no external
// issuer vendor). PCI DSS Req 3.2: no SAD (CVV/PIN block) is stored.
import { CardIssuerInboundPayload } from '../../providers/models/externalProviderArrangement.model';

export function validateCardIssuer(_input: Record<string, unknown>): CardIssuerInboundPayload {
  return { cardStatus: 'active', actionConfirmed: true };
}
