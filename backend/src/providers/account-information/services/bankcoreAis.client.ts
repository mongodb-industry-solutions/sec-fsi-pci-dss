import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../../config';

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

// Interim TPP credential: a bearer JWT signed with the shared platform secret, which only this service
// can mint. P3.7b swaps it for client_credentials against the bank's tppRegistration.
function tppToken(): string {
  return jwt.sign({ client_id: 'leafypay-psp', scope: 'accounts balances transactions' }, config.app.jwtSecret, {
    expiresIn: 120,
  });
}

function headers(consentReference: string, correlationId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${tppToken()}`,
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
): Promise<AisReadResult> {
  const correlationId = input.correlationId ?? uuidv4();
  const url = `${config.bankcore.baseUrl}/v1/accounts/${encodeURIComponent(input.bankAccountReference)}/balances`;

  try {
    const response = await fetchImpl(url, {
      headers: headers(input.consentReference, correlationId),
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
): Promise<DemoCreditResult> {
  const correlationId = input.endToEndIdentification ?? uuidv4();
  const url = `${config.bankcore.baseUrl}/v1/accounts/${encodeURIComponent(input.bankAccountReference)}/credits`;

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { ...headers('demo-credit', correlationId), 'Content-Type': 'application/json' },
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
