// Builtin Account Information Service module (Open Banking AIS).
// Verifies a PSP-registered payout account and returns its internal ledger balance.
// Replaceable by a real PSD2 AIS provider without changing the wire contract or bus events.

import type { PayoutAccountArrangement } from '../../../modules/gateway/models/payoutAccount.model';
import type { AisValidationInbound } from '../../../shared/models/events/wire.contracts';

export interface AccountInformationConfig {
  alwaysVerifyActive: boolean;    // default: true, only 'active' accounts pass
  returnInternalBalance: boolean; // default: true, balance sourced from PSP internal ledger
  identityCheckEnabled: boolean;  // default: true
}

export const DEFAULT_ACCOUNT_INFORMATION_CONFIG: AccountInformationConfig = {
  alwaysVerifyActive: true,
  returnInternalBalance: true,
  identityCheckEnabled: true,
};

export function resolveAccountInformationConfig(
  stored: Record<string, unknown> | undefined | null,
): AccountInformationConfig {
  const c = (stored ?? {}) as Partial<AccountInformationConfig>;
  return {
    alwaysVerifyActive: typeof c.alwaysVerifyActive === 'boolean' ? c.alwaysVerifyActive : DEFAULT_ACCOUNT_INFORMATION_CONFIG.alwaysVerifyActive,
    returnInternalBalance: typeof c.returnInternalBalance === 'boolean' ? c.returnInternalBalance : DEFAULT_ACCOUNT_INFORMATION_CONFIG.returnInternalBalance,
    identityCheckEnabled: typeof c.identityCheckEnabled === 'boolean' ? c.identityCheckEnabled : DEFAULT_ACCOUNT_INFORMATION_CONFIG.identityCheckEnabled,
  };
}

export interface AisValidationInput {
  payoutAccountInstanceReference: string;
  clientReference: string;
  requestedFields?: string[];
}

export function validateAccount(
  input: AisValidationInput,
  account: PayoutAccountArrangement | null,
  config: AccountInformationConfig,
): Omit<AisValidationInbound, 'clientReference'> {
  if (!account) {
    return {
      accountVerified: false,
      accountStatus: 'unknown',
      identityMatch: 'not_checked',
    };
  }

  const isActive = account.payoutAccountStatus === 'active';

  if (config.alwaysVerifyActive && !isActive) {
    return {
      accountVerified: false,
      accountStatus: account.payoutAccountStatus === 'suspended' ? 'dormant' : 'closed',
      identityMatch: 'not_checked',
    };
  }

  const result: Omit<AisValidationInbound, 'clientReference'> = {
    accountVerified: true,
    accountStatus: 'active',
  };

  if (config.returnInternalBalance && account.payoutAccountBalance) {
    result.balancePending = account.payoutAccountBalance.pendingAmount;
    result.balanceAvailable = account.payoutAccountBalance.availableAmount;
    result.currency = account.payoutAccountBalance.currency;
  }

  if (config.identityCheckEnabled && account.partyInstanceReference) {
    result.identityMatch = 'full';
  }

  return result;
}

// v17 Funds-availability check (AIS) for the card-payment funds gate. Reuses validateAccount
// so the balance is ALWAYS sourced from the real ledger (never simulated). Pure: the atomic hold and
// the DB read live in the gate reactor; this only interprets the account into a funds verdict. The
// amount is expected already expressed in the ACCOUNT currency (FX applied upstream).
export interface FundsCheckVerdict {
  accountVerified: boolean;
  accountStatus: 'active' | 'dormant' | 'closed' | 'unknown';
  sufficient: boolean;
  available: number;
  currency?: string;
}

export function checkFunds(
  account: PayoutAccountArrangement | null,
  amountInAccountCurrency: number,
  config: AccountInformationConfig,
): FundsCheckVerdict {
  const ais = validateAccount(
    { payoutAccountInstanceReference: account?.payoutAccountInstanceReference ?? '', clientReference: 'funds-check' },
    account,
    { ...config, returnInternalBalance: true },
  );
  const available = ais.balanceAvailable ?? 0;
  return {
    accountVerified: ais.accountVerified,
    accountStatus: ais.accountStatus,
    sufficient: ais.accountVerified && available >= amountInAccountCurrency,
    available,
    currency: ais.currency,
  };
}
