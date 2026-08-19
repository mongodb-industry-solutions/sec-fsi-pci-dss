import { v4 as uuidv4 } from 'uuid';
import { getProviderAccessToken, getProviderBaseUrl } from '../../../modules/provider/services/providerAccessToken.service';
import { config } from '../../../config';

// Cardholder data as a call to the issuer that holds it.
//
// v37 P7 moved the PAN vault to the bank, so the PSP is out of scope for cardholder data: it holds a
// surrogate token plus BIN and last four. Reveal, exact-PAN search and verification value derivation are
// now the issuer's, and this is the only way the PSP reaches them.
const TIMEOUT_MS = 4000;
const SCOPE = 'card-data';

interface BankResponse { status: number; payload: Record<string, unknown> }

async function issuerRequest(
  path: string,
  body: Record<string, unknown>,
  correlationId: string,
  fetchImpl: typeof fetch,
): Promise<BankResponse | { error: string }> {
  const resolved = await getProviderBaseUrl('card_issuer')
    .then((first) => (first.baseUrl ? first : getProviderBaseUrl('account_information')));
  const host = resolved.baseUrl ?? config.bankcore.baseUrl;
  if (!host) return { error: `no issuer endpoint configured: ${resolved.error}` };

  // Same fetch as the call it authorises, so a stubbed issuer stays stubbed for its token too.
  const { accessToken, error: tokenError } = await getProviderAccessToken('account_information', { scope: SCOPE, fetchImpl });
  if (!accessToken) return { error: `issuer authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(`${host}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
    return { error: `issuer unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function refusal(result: BankResponse): string {
  const message = (result.payload.tppMessages as Array<{ code?: string; text?: string }> | undefined)?.[0];
  return `${message?.code ?? result.status} ${message?.text ?? ''}`.trim();
}

export interface PanMatch {
  paymentCardInstanceReference: string;
  paymentCardReference: string;
  last4: string;
}

/** Reveals a card number, once. Ephemeral: never persist or log the value. */
export async function revealPanAtIssuer(
  cardToken: string,
  correlationId = uuidv4(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ pan?: string; error?: string }> {
  const result = await issuerRequest(`/v1/cards/${encodeURIComponent(cardToken)}/pan-reveals`, {}, correlationId, fetchImpl);
  if ('error' in result) return { error: result.error };
  if (result.status === 404) return {};
  if (result.status !== 200) return { error: `issuer refused the reveal: ${refusal(result)}` };
  const pan = typeof result.payload.cardNumber === 'string' ? result.payload.cardNumber : undefined;
  return pan ? { pan } : {};
}

/** Finds cards by exact number. The PAN travels in a body, never in a query string. */
export async function findByPanAtIssuer(
  pan: string,
  correlationId = uuidv4(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ matches: PanMatch[]; error?: string }> {
  const result = await issuerRequest('/v1/cards/searches', { cardNumber: pan }, correlationId, fetchImpl);
  if ('error' in result) return { matches: [], error: result.error };
  if (result.status !== 200) return { matches: [], error: `issuer refused the search: ${refusal(result)}` };
  const rows = Array.isArray(result.payload.matches) ? result.payload.matches as Array<Record<string, unknown>> : [];
  return {
    matches: rows.map((row) => ({
      paymentCardInstanceReference: String(row.cardReference ?? ''),
      paymentCardReference: String(row.cardToken ?? ''),
      last4: String(row.lastFour ?? ''),
    })),
  };
}

/** The verification value the issuer would accept. Only the issuer can derive it. */
export async function deriveCvvAtIssuer(
  input: { cardToken: string; expiry: string; cvvLength: number },
  correlationId = uuidv4(),
  fetchImpl: typeof fetch = fetch,
): Promise<{ cvv?: string; error?: string }> {
  const result = await issuerRequest(
    `/v1/cards/${encodeURIComponent(input.cardToken)}/verification-values`,
    { expiry: input.expiry, length: input.cvvLength },
    correlationId,
    fetchImpl,
  );
  if ('error' in result) return { error: result.error };
  if (result.status !== 200) return { error: `issuer could not derive a value: ${refusal(result)}` };
  const cvv = typeof result.payload.verificationValue === 'string' ? result.payload.verificationValue : undefined;
  return cvv ? { cvv } : { error: 'the issuer returned no value' };
}
