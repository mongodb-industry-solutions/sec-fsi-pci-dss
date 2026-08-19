import { v4 as uuidv4 } from 'uuid';
import { getProviderAccessToken, getProviderBaseUrl } from '../../../modules/provider/services/providerAccessToken.service';
import { PayoutAccountArrangement } from '../../../modules/gateway/models/payoutAccount.model';
import { config } from '../../../config';

// The funds gate as a call to the institution that holds the money.
//
// Why this had to exist before the kill switch can flip: once the ledger is at the bank, the PSP's stored
// balance is a PROJECTION. A local atomic hold would mutate a figure that is no longer authoritative and
// decide on stale data, so it would look correct and be wrong. A funds confirmation is not a substitute
// either: a yes/no is not a hold, and two concurrent authorisations would both pass it.
//
// ISO 8583 response codes come back unchanged, because that is what the card flow already speaks: the
// existing decline reasons and the existing audit fields keep working.
const TIMEOUT_MS = 4000;

export interface CardHoldResult {
  approved: boolean;
  // The ISO 8583 code, when the bank answered at all.
  responseCode?: string;
  // The reference to quote when releasing or settling the hold.
  authorisationReference?: string;
  // Present when the bank could not be asked. NEVER treated as an approval: a funds gate that fails open
  // authorises a payment nobody checked.
  error?: string;
}

/** A linked account is one the bank holds. Only those are the bank's to authorise. */
export function isBankLinked(account: Pick<PayoutAccountArrangement, 'payoutAccountBankAccountReference' | 'payoutAccountAspspReference' | 'payoutAccountConsentReference'>): boolean {
  return Boolean(
    account.payoutAccountBankAccountReference
    && account.payoutAccountAspspReference
    && account.payoutAccountConsentReference,
  );
}

async function bankRequest(
  path: string,
  method: 'POST' | 'DELETE',
  body: Record<string, unknown>,
  consentReference: string,
  correlationId: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; payload: Record<string, unknown> } | { error: string }> {
  const { baseUrl, error: endpointError } = await getProviderBaseUrl('card_authorization')
    .then((resolved) => (resolved.baseUrl ? resolved : getProviderBaseUrl('account_information')));
  const host = baseUrl ?? config.bankcore.baseUrl;
  if (!host) return { error: `no bank endpoint configured: ${endpointError}` };

  // Same fetch as the call it authorises, so a stubbed bank stays stubbed for its token too.
  const { accessToken, error: tokenError } = await getProviderAccessToken('account_information', {
    scope: 'card-authorisations', fetchImpl,
  });
  if (!accessToken) return { error: `card authorisation authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(`${host}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Consent-ID': consentReference,
        'X-Request-ID': correlationId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, payload };
  } catch (err) {
    return { error: `bank unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Places the authorisation hold at the bank. The reference to release or settle it is the correlation id,
 * so the caller keeps no second identifier in step with the bank's.
 */
export async function holdFundsAtBank(
  input: {
    account: PayoutAccountArrangement;
    amount: number;
    currency: string;
    cardToken?: string;
    transactionType?: string;
    clientReference: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<CardHoldResult> {
  const correlationId = input.clientReference || uuidv4();
  const result = await bankRequest(
    '/v1/cards/authorisations',
    'POST',
    {
      fundingAccount: { resourceId: input.account.payoutAccountBankAccountReference },
      instructedAmount: { currency: input.currency, amount: input.amount.toFixed(2) },
      cardToken: input.cardToken,
      transactionType: input.transactionType,
      clientReference: correlationId,
    },
    input.account.payoutAccountConsentReference ?? '',
    correlationId,
    fetchImpl,
  );
  if ('error' in result) return { approved: false, error: result.error };

  const responseCode = typeof result.payload.responseCode === 'string' ? result.payload.responseCode : undefined;
  if (result.status !== 200) {
    // A refusal to even consider it (no consent, wrong scope) is not a decline: it is our configuration.
    const refusal = (result.payload.tppMessages as Array<{ code?: string; text?: string }> | undefined)?.[0];
    return { approved: false, error: `bank refused the authorisation: ${refusal?.code ?? result.status} ${refusal?.text ?? ''}`.trim() };
  }
  return {
    approved: result.payload.approved === true,
    responseCode,
    authorisationReference: typeof result.payload.authorisationReference === 'string'
      ? result.payload.authorisationReference
      : correlationId,
  };
}

/**
 * Releases or settles a hold. `release` returns the funds, `settle` turns the reservation into a debit.
 * A hold that is neither would strand the customer's money, which is why the compensating call is here
 * rather than left to whoever remembers.
 */
export async function disposeHoldAtBank(
  input: {
    account: PayoutAccountArrangement;
    amount: number;
    currency: string;
    authorisationReference: string;
    disposition: 'release' | 'settle';
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ applied: boolean; error?: string }> {
  const result = await bankRequest(
    `/v1/cards/authorisations/${encodeURIComponent(input.authorisationReference)}`,
    'DELETE',
    {
      fundingAccount: { resourceId: input.account.payoutAccountBankAccountReference },
      instructedAmount: { currency: input.currency, amount: input.amount.toFixed(2) },
      disposition: input.disposition,
    },
    input.account.payoutAccountConsentReference ?? '',
    input.authorisationReference,
    fetchImpl,
  );
  if ('error' in result) return { applied: false, error: result.error };
  return { applied: result.payload.applied === true, error: result.payload.reason as string | undefined };
}
