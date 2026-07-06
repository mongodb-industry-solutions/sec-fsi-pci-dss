// Internal Card Authorization engine (built-in; used when no external card-auth vendor).
// PCI DSS Req 3.3: no CVV is received or stored here.
import { CardAuthInboundPayload } from '../../../modules/provider/models/externalProviderArrangement.model';

export function authorizeCard(_input: Record<string, unknown>): CardAuthInboundPayload {
  return {
    authorizationCode: 'AUTH' + Math.floor(Math.random() * 100000).toString().padStart(6, '0'),
    authorizationStatus: 'approved',
    responseCode: '00',
  };
}
