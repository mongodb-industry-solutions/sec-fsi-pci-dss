// Display-safe source-account options for the money-movement pickers.
// Built from GET /api/v1/merchant/accounts/:partyRef (masked IBAN only; GDPR/PSD2 minimisation).
// The merchant only ever forwards the opaque payoutAccountInstanceReference, never the IBAN.

export interface AccountOption {
  ref: string;
  label: string;
  currency?: string;
  isDefault: boolean;
}

// Map a raw display-safe account row into a picker option.
export function toAccountOption(a: Record<string, any>): AccountOption {
  const name = a.payoutAccountAlias || a.payoutAccountBankName || 'Account';
  const masked = a.payoutAccountMaskedIban ? ` · ${a.payoutAccountMaskedIban}` : '';
  const currency = a.payoutAccountCurrency as string | undefined;
  const cur = currency ? ` (${currency})` : '';
  return {
    ref: a.payoutAccountInstanceReference,
    label: `${name}${masked}${cur}`,
    currency,
    isDefault: !!a.payoutAccountIsDefault,
  };
}

// Fetch the user's active payout accounts as picker options (default first).
// Returns [] on any error so pages can degrade gracefully (send/transfer stays usable
// with server-side default resolution).
export async function loadAccountOptions(): Promise<AccountOption[]> {
  const { PspClient } = await import('./PspClient');
  try {
    const c = await PspClient.fromSession();
    if (!c || !c.hasScope('read:accounts')) return [];
    const data = await c.listAccounts(1, 100);
    const opts = (data.results ?? [])
      .filter((a: any) => (a.payoutAccountStatus ?? 'active') === 'active')
      .map(toAccountOption);
    return opts.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  } catch {
    return [];
  }
}
