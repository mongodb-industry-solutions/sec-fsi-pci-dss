import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../config';
import { getProviderAccessToken, getProviderBaseUrl } from '../../../modules/provider/services/providerAccessToken.service';

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

// Where the bank is, from the provider record. `config.bankcore.baseUrl` remains only as the bootstrap
// value for the health probe and for a first run before the records are seeded: once they are, the record
// is the answer, so repointing at another bank is a re-seed rather than a redeploy.
export type EndpointProvider = () => Promise<{ baseUrl?: string; error?: string }>;

const defaultEndpointProvider: EndpointProvider = () => getProviderBaseUrl('account_information');

async function resolveBaseUrl(provider: EndpointProvider): Promise<{ baseUrl?: string; error?: string }> {
  const resolved = await provider();
  if (resolved.baseUrl) return resolved;
  // No record yet is not a reason to fail differently from the bank being unreachable: the caller gets an
  // error either way and never a fabricated balance.
  return config.bankcore.baseUrl
    ? { baseUrl: config.bankcore.baseUrl }
    : { error: resolved.error ?? 'no bankcore endpoint configured' };
}

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
  endpointProvider: EndpointProvider = defaultEndpointProvider,
): Promise<AisReadResult> {
  const correlationId = input.correlationId ?? uuidv4();
  const { baseUrl, error: endpointError } = await resolveBaseUrl(endpointProvider);
  if (!baseUrl) return { error: `AIS endpoint unresolved: ${endpointError}` };
  const url = `${baseUrl}/v1/accounts/${encodeURIComponent(input.bankAccountReference)}/balances`;

  const { accessToken, error: tokenError } = await tokenProvider('accounts balances transactions');
  if (!accessToken) return { error: `AIS authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(url, {
      headers: headers(accessToken, input.consentReference, correlationId),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // The bank answers a standard error body, so carry ITS reason rather than only the status code:
      // "the consent is revokedByPsu" and "the bank is broken" are the same 401 otherwise.
      const refusal = await response.json().catch(() => ({})) as {
        tppMessages?: Array<{ code?: string; text?: string }>;
      };
      const message = refusal.tppMessages?.[0];
      return {
        error: message?.code
          ? `AIS balance read refused: ${message.code} (${message.text ?? `HTTP ${response.status}`})`
          : `AIS balance read failed: HTTP ${response.status}`,
      };
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
  endpointProvider: EndpointProvider = defaultEndpointProvider,
): Promise<DemoCreditResult> {
  const correlationId = input.endToEndIdentification ?? uuidv4();
  const { baseUrl, error: endpointError } = await resolveBaseUrl(endpointProvider);
  if (!baseUrl) return { applied: false, error: `bank endpoint unresolved: ${endpointError}` };
  const url = `${baseUrl}/v1/accounts/${encodeURIComponent(input.bankAccountReference)}/credits`;

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

// ── Consent acquisition (P4.4) ───────────────────────────────────────────────────────────────────
//
// The PSP creates the consent; the bank decides when it becomes usable. Those are different facts and the
// code keeps them apart: a created consent is not an authorised one, and treating them as the same is the
// optimistic shortcut that would break against a bank requiring SCA.

export interface CreatedConsent {
  consentReference?: string;
  // Berlin Group's enumeration, as the bank reported it. `valid` is the only usable value.
  consentStatus?: string;
  error?: string;
}

/**
 * Creates an account access consent at the bank for the given IBANs.
 *
 * The status comes back from the bank and is stored as reported: in `automatic` mode it is `valid`
 * immediately, in `manual` mode it is `received` and stays that way until an operator decides. The caller
 * must not assume the first case, which is the whole point of returning the status rather than a boolean.
 */
export async function createBankConsent(
  input: { accountIbans: string[]; correlationId?: string },
  fetchImpl: typeof fetch = fetch,
  tokenProvider: TokenProvider = defaultTokenProvider,
  endpointProvider: EndpointProvider = defaultEndpointProvider,
): Promise<CreatedConsent> {
  const correlationId = input.correlationId ?? uuidv4();
  const { baseUrl, error: endpointError } = await resolveBaseUrl(endpointProvider);
  if (!baseUrl) return { error: `consent endpoint unresolved: ${endpointError}` };

  const { accessToken, error: tokenError } = await tokenProvider('accounts');
  if (!accessToken) return { error: `consent authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(`${baseUrl}/v1/consents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Request-ID': correlationId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      // The standard's access object. Balance and transaction access default to the same accounts at the
      // bank, so they are not sent: asking for less than is needed would be a narrower consent than the
      // platform actually uses, and asking by listing them twice adds nothing.
      body: JSON.stringify({ access: { accounts: input.accountIbans.map((iban) => ({ iban })) } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({})) as {
      consentId?: string; consentStatus?: string; tppMessages?: Array<{ code?: string; text?: string }>;
    };
    if (!response.ok || !body.consentId) {
      const refusal = body.tppMessages?.[0];
      return { error: `consent refused: ${refusal?.code ?? `HTTP ${response.status}`} ${refusal?.text ?? ''}`.trim() };
    }
    return { consentReference: body.consentId, consentStatus: body.consentStatus };
  } catch (err) {
    return { error: `consent creation unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Reads a consent's status. This is the specification's own fallback for a missed notification, which is
 * why it exists as its own call: polling is how the PSP recovers, never how it normally learns.
 */
export async function readBankConsentStatus(
  input: { consentReference: string; correlationId?: string },
  fetchImpl: typeof fetch = fetch,
  tokenProvider: TokenProvider = defaultTokenProvider,
  endpointProvider: EndpointProvider = defaultEndpointProvider,
): Promise<{ consentStatus?: string; error?: string }> {
  const { baseUrl, error: endpointError } = await resolveBaseUrl(endpointProvider);
  if (!baseUrl) return { error: `consent endpoint unresolved: ${endpointError}` };

  const { accessToken, error: tokenError } = await tokenProvider('accounts');
  if (!accessToken) return { error: `consent authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(
      `${baseUrl}/v1/consents/${encodeURIComponent(input.consentReference)}/status`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-ID': input.correlationId ?? uuidv4(),
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!response.ok) return { error: `consent status read failed: HTTP ${response.status}` };
    const body = await response.json() as { consentStatus?: string };
    return { consentStatus: body.consentStatus };
  } catch (err) {
    return { error: `consent status unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
