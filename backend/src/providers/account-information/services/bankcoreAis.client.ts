import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../config';
import { getProviderAccessToken } from '../../../modules/provider/services/providerAccessToken.service';

// The PSP as AISP, calling the bank's standard read endpoints. Every call carries the identifiers the
// standard defines, so one payment is traceable across both systems:
//   · X-Request-ID  per call, echoed back by the bank
//   · Consent-ID    the PSD2 consent that authorises the read
//
// This is a port, not a shortcut: P4.1 repoints it at `dispatchProvider` so the endpoint comes from the
// provider record and the audit trail is single sourced. Until then it is one adapter in the
// account-information provider, which is where an AIS integration belongs anyway.

export interface AisBalance {
  availableAmount: number;
  pendingAmount: number;
  reservedAmount: number;
  currency: string;
  lastUpdatedDateTime?: string;
}

interface BerlinGroupBalancesResponse {
  balances?: Array<{
    balanceAmount?: { currency?: string; amount?: string };
    balanceType?: string;
    lastChangeDateTime?: string;
  }>;
}

const TIMEOUT_MS = 4000;

// The TPP credential is the one held in the provider arrangement record, exchanged at the bank's token
// endpoint for a scoped access token. No local minting: a token the PSP signs itself is not something
// the bank has any reason to trust, and accepting one was the hole this closed.
//
// The token provider is injected for the same reason the balance reader is: a module mock leaks into
// other suites, and this one would otherwise open a database connection from a unit test.
export type TokenProvider = (scope: string) => Promise<{ accessToken?: string; error?: string }>;

const defaultTokenProvider: TokenProvider = (scope) =>
  getProviderAccessToken('account_information', { scope });

function headers(token: string, consentReference: string, correlationId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Consent-ID': consentReference,
    'X-Request-ID': correlationId,
    Accept: 'application/json',
  };
}

// ISO 20022 renders an amount as a decimal string, so it is parsed rather than assumed to be a number.
function parseAmount(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface AisReadResult {
  balance?: AisBalance;
  // Present when the read failed. The caller decides what to do; it must never invent a balance.
  error?: string;
}

/**
 * Reads one account's balances from the bank. Returns an error rather than a zero on failure: showing
 * a customer a balance of zero because a network call failed is worse than showing nothing.
 */
export async function readAccountBalance(
  input: { bankAccountReference: string; consentReference: string; correlationId?: string },
  fetchImpl: typeof fetch = fetch,
  tokenProvider: TokenProvider = defaultTokenProvider,
): Promise<AisReadResult> {
  const correlationId = input.correlationId ?? uuidv4();
  const url = `${config.bankcore.baseUrl}/v1/accounts/${encodeURIComponent(input.bankAccountReference)}/balances`;

  const { accessToken, error: tokenError } = await tokenProvider('accounts balances transactions');
  if (!accessToken) return { error: `AIS authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(url, {
      headers: headers(accessToken, input.consentReference, correlationId),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { error: `AIS balance read failed: HTTP ${response.status}` };
    }
    const body = await response.json() as BerlinGroupBalancesResponse;
    const byType = new Map(
      (body.balances ?? []).map((entry) => [entry.balanceType, entry]),
    );

    const available = byType.get('interimAvailable');
    if (!available) return { error: 'AIS balance read returned no interimAvailable balance' };

    const currency = available.balanceAmount?.currency ?? 'EUR';
    const availableAmount = parseAmount(available.balanceAmount?.amount);
    // `expected` includes what is booked but unsettled, so the pending figure is the difference.
    const expected = parseAmount(byType.get('expected')?.balanceAmount?.amount);
    const reservedAmount = parseAmount(byType.get('blocked')?.balanceAmount?.amount);

    return {
      balance: {
        availableAmount,
        pendingAmount: Math.max(0, Number((expected - availableAmount).toFixed(2))),
        reservedAmount,
        currency,
        lastUpdatedDateTime: available.lastChangeDateTime,
      },
    };
  } catch (err) {
    return { error: `AIS balance read unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface DemoCreditResult {
  applied: boolean;
  balanceAfter?: number;
  error?: string;
}

/**
 * Asks the bank to credit an account. The PSP does not mint money: it requests it from the institution
 * that holds the account, which is the defect this iteration closes.
 */
export async function requestDemoCredit(
  input: {
    bankAccountReference: string;
    amount: number;
    currency: string;
    reason?: string;
    requestedBy?: string;
    endToEndIdentification?: string;
  },
  fetchImpl: typeof fetch = fetch,
  tokenProvider: TokenProvider = defaultTokenProvider,
): Promise<DemoCreditResult> {
  const correlationId = input.endToEndIdentification ?? uuidv4();
  const url = `${config.bankcore.baseUrl}/v1/accounts/${encodeURIComponent(input.bankAccountReference)}/credits`;

  // Its own scope: creating funds is not covered by any read scope, so a read-only credential cannot
  // reach this even though it is the same client.
  const { accessToken, error: tokenError } = await tokenProvider('demo-credits');
  if (!accessToken) return { applied: false, error: `bank authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { ...headers(accessToken, 'demo-credit', correlationId), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        reason: input.reason,
        requestedBy: input.requestedBy,
        endToEndIdentification: correlationId,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({})) as {
      applied?: boolean; balanceAfter?: number;
      tppMessages?: Array<{ text?: string }>;
    };
    if (!response.ok || !body.applied) {
      return { applied: false, error: body.tppMessages?.[0]?.text ?? `bank refused the credit (HTTP ${response.status})` };
    }
    return { applied: true, balanceAfter: body.balanceAfter };
  } catch (err) {
    return { applied: false, error: `bank unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
