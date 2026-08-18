import { v4 as uuidv4 } from 'uuid';
import { getProviderAccessToken, getProviderBaseUrl } from '../../../modules/provider/services/providerAccessToken.service';
import { PayoutAccountArrangement } from '../../../modules/gateway/models/payoutAccount.model';
import { config } from '../../../config';

// The PSP as PISP: it initiates the credit transfer at the DEBTOR's bank and that bank executes it.
//
// The PSP never reaches the creditor's institution. It is not a clearing participant, so it has neither the
// relationship nor a way to get there; presenting the operation to a scheme is the debtor bank's job. This is
// also why the PSP must stop crediting recipients: the credit belongs to whoever holds the creditor account.
const TIMEOUT_MS = 4000;

// The Berlin Group payment product is part of the endpoint path, so choosing it is legitimate TPP work. It
// is derived from the destination and the currency, never from a bank-specific branch.
export type PaymentProduct =
  | 'sepa-credit-transfers'
  | 'instant-sepa-credit-transfers'
  | 'cross-border-credit-transfers';

/**
 * Selects the payment product.
 *
 * This is the PSP's own derivation and it is deliberately about the CORRIDOR, not about which bank holds the
 * destination: a SEPA country and a euro amount is a SEPA transfer whoever the beneficiary banks with.
 */
export function selectPaymentProduct(input: {
  currency: string;
  creditorCountryCode?: string;
  instant?: boolean;
}): PaymentProduct {
  const sepaCurrency = input.currency.toUpperCase() === 'EUR';
  if (!sepaCurrency) return 'cross-border-credit-transfers';
  return input.instant ? 'instant-sepa-credit-transfers' : 'sepa-credit-transfers';
}

export interface InitiatedPayment {
  // The bank's own payment id, kept on the PSP's instruction so the two records resolve to each other.
  bankPaymentReference?: string;
  // ISO 20022 transaction status as the bank reported it. `ACTC` means accepted, not settled.
  transactionStatus?: string;
  error?: string;
}

/**
 * Initiates the transfer at the bank holding the debtor account.
 *
 * Returns the bank's reference and status rather than a boolean: "accepted" and "settled" are different
 * facts, and collapsing them is what would let the PSP report a completed transfer before the money moved.
 */
export async function initiatePaymentAtBank(
  input: {
    debtorAccount: PayoutAccountArrangement;
    creditorIban: string;
    creditorName: string;
    creditorAgentBic?: string;
    amount: number;
    currency: string;
    remittanceInformation?: string;
    // The PSP's own execution reference, carried as the end to end id so one query correlates both sides.
    endToEndIdentification: string;
    product: PaymentProduct;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<InitiatedPayment> {
  const { baseUrl, error: endpointError } = await getProviderBaseUrl('payment_initiation')
    .then((resolved) => (resolved.baseUrl ? resolved : getProviderBaseUrl('account_information')));
  const host = baseUrl ?? config.bankcore.baseUrl;
  if (!host) return { error: `no bank endpoint configured: ${endpointError}` };

  const { accessToken, error: tokenError } = await getProviderAccessToken('account_information', {
    scope: 'payments',
  });
  if (!accessToken) return { error: `payment authorisation failed: ${tokenError}` };

  const consentReference = input.debtorAccount.payoutAccountConsentReference;
  if (!consentReference) {
    // Without a consent the bank will refuse, and saying so here names the actual cause instead of
    // surfacing a 401 from a call that never had a chance.
    return { error: 'the debtor account has no account access consent' };
  }

  try {
    const response = await fetchImpl(`${host}/v1/payments/${input.product}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Consent-ID': consentReference,
        // The idempotency key at the bank, so a retried initiation cannot become two payments.
        'X-Request-ID': input.endToEndIdentification,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        instructedAmount: { currency: input.currency, amount: input.amount.toFixed(2) },
        debtorAccount: { iban: input.debtorAccount.payoutAccountIban },
        creditorAccount: { iban: input.creditorIban },
        creditorName: input.creditorName,
        creditorAgent: input.creditorAgentBic,
        endToEndIdentification: input.endToEndIdentification,
        remittanceInformationUnstructured: input.remittanceInformation,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({})) as {
      paymentId?: string; transactionStatus?: string; tppMessages?: Array<{ code?: string; text?: string }>;
    };
    if (!response.ok || !body.paymentId) {
      const refusal = body.tppMessages?.[0];
      return { error: `the bank refused the payment: ${refusal?.code ?? `HTTP ${response.status}`} ${refusal?.text ?? ''}`.trim() };
    }
    return { bankPaymentReference: body.paymentId, transactionStatus: body.transactionStatus };
  } catch (err) {
    return { error: `payment initiation unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Polls a payment's status. The fallback for a missed settlement notification, not the normal path. */
export async function readPaymentStatusAtBank(
  input: { bankPaymentReference: string; product: PaymentProduct; correlationId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ transactionStatus?: string; error?: string }> {
  const { baseUrl } = await getProviderBaseUrl('payment_initiation')
    .then((resolved) => (resolved.baseUrl ? resolved : getProviderBaseUrl('account_information')));
  const host = baseUrl ?? config.bankcore.baseUrl;
  if (!host) return { error: 'no bank endpoint configured' };

  const { accessToken, error: tokenError } = await getProviderAccessToken('account_information', {
    scope: 'payments',
  });
  if (!accessToken) return { error: `payment authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(
      `${host}/v1/payments/${input.product}/${encodeURIComponent(input.bankPaymentReference)}/status`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-ID': input.correlationId ?? uuidv4(),
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!response.ok) return { error: `payment status read failed: HTTP ${response.status}` };
    const body = await response.json() as { transactionStatus?: string };
    return { transactionStatus: body.transactionStatus };
  } catch (err) {
    return { error: `payment status unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
