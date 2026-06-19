// BIAN SD-57: Card Etoken  -  Token Vault  -  prototype stub service
// Full implementation (QE:none for networkToken, DB persistence) scheduled for v5.

import { v4 as uuidv4 } from 'uuid';
import { TokenVaultStatus } from '../models/tokenVault.model';

export interface CreateTokenInput {
  customerAgreementInstanceReference: string;
  maskedPanDisplay: string;
  cardNetwork: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
  linkedPaymentCardInstanceReference?: string;
}

export async function createToken(input: CreateTokenInput) {
  const token = `tok_${uuidv4().replace(/-/g, '')}`;
  return {
    tokenVaultInstanceReference: uuidv4(),
    tokenVaultCardToken: token,
    tokenVaultMaskedPanDisplay: input.maskedPanDisplay,
    tokenVaultCardNetwork: input.cardNetwork,
    tokenVaultStatus: 'active' as TokenVaultStatus,
    tokenVaultCreatedAt: new Date().toISOString(),
    customerAgreementInstanceReference: input.customerAgreementInstanceReference,
    _stub: true,
    _note: 'v5: persisted to tokenVault collection; tokenVaultNetworkToken stored as QE:none',
  };
}

export async function getToken(token: string) {
  // Stub: return metadata without networkToken (QE:none, never exposed)
  return {
    tokenVaultCardToken: token,
    tokenVaultMaskedPanDisplay: '****-****-****-1234',
    tokenVaultCardNetwork: 'VISA' as const,
    tokenVaultStatus: 'active' as TokenVaultStatus,
    tokenVaultCreatedAt: new Date(Date.now() - 86_400_000).toISOString(),
    tokenVaultLastUsedAt: new Date().toISOString(),
    _stub: true,
  };
}
