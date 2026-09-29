// Credit bureau capability: the PSP asks the bank, because the bank has the evidence.
//
// v37 P8 moved the assessment to the institution that holds the accounts, the balances and the payment
// history. What was here before returned 720/A/0.02 for every subject, which made the capability a
// placeholder: nothing about the customer changed the answer, so the answer meant nothing.
import { CreditBureauInboundPayload } from '../../../modules/provider/models/externalProviderArrangement.model';
import { assessAtBank } from './bankcoreCreditBureau.client';

// Partial, because a refusal carries no score. The caller checks `error` before it reads a number, and a
// type that promised one would let it skip that check.
export interface CreditBureauResult extends Partial<CreditBureauInboundPayload> {
  assessmentFactors?: Array<{ assessmentFactorName: string; assessmentFactorPoints: number; assessmentFactorObservation: string }>;
  assessmentAsOfDateTime?: string;
  // Set when the bureau could not answer. NEVER filled with a default score: a made-up assessment is worse
  // than an absent one, because a decision would be taken on it as if it were real.
  error?: string;
}

/** Resolves the subject the caller named, however the router labelled it. */
export function subjectOf(input: Record<string, unknown>): string | undefined {
  for (const key of ['accountHolderReference', 'partyReference', 'subjectReference', 'customerAgreementReference']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export async function scoreCreditBureau(
  input: Record<string, unknown>,
  correlationId?: string,
  fetchImpl?: typeof fetch,
): Promise<CreditBureauResult> {
  const subject = subjectOf(input);
  if (!subject) return { error: 'no subject reference in the request, so there is nobody to assess' };
  const result = await assessAtBank(subject, correlationId, fetchImpl);
  if ('error' in result && result.error) return { error: result.error };
  return result as CreditBureauResult;
}
