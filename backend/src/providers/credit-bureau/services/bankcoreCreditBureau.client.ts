import { v4 as uuidv4 } from 'uuid';
import { getProviderAccessToken, getProviderBaseUrl } from '../../../modules/provider/services/providerAccessToken.service';
import { config } from '../../../config';
import { CreditBureauInboundPayload } from '../../../modules/provider/models/externalProviderArrangement.model';

// The credit assessment as a call to the bank that holds the accounts.
//
// v37 P8: a bank is the bureau for its own customers, since it holds the balances and the payment history an
// assessment is made of. The PSP holds none of that, which is why its own engine could only ever return a
// constant.
const TIMEOUT_MS = 4000;
const SCOPE = 'credit-assessments';

export interface CreditAssessmentResult extends CreditBureauInboundPayload {
  // The reasoning, passed through unchanged: a decline nobody can account for cannot be contested.
  assessmentFactors?: Array<{ assessmentFactorName: string; assessmentFactorPoints: number; assessmentFactorObservation: string }>;
  assessmentAsOfDateTime?: string;
  error?: string;
}

export async function assessAtBank(
  accountHolderReference: string,
  correlationId = uuidv4(),
  fetchImpl: typeof fetch = fetch,
): Promise<CreditAssessmentResult | { error: string }> {
  const resolved = await getProviderBaseUrl('credit_bureau')
    .then((first) => (first.baseUrl ? first : getProviderBaseUrl('account_information')));
  const host = resolved.baseUrl ?? config.bankcore.baseUrl;
  if (!host) return { error: `no bureau endpoint configured: ${resolved.error}` };

  // Same fetch as the call it authorises, so a stubbed bureau stays stubbed for its token too.
  const { accessToken, error: tokenError } = await getProviderAccessToken('account_information', { scope: SCOPE, fetchImpl });
  if (!accessToken) return { error: `bureau authorisation failed: ${tokenError}` };

  try {
    const response = await fetchImpl(`${host}/v1/credit-assessments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Request-ID': correlationId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ accountHolderReference }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status !== 200) {
      const refusal = (payload.tppMessages as Array<{ code?: string; text?: string }> | undefined)?.[0];
      return { error: `bureau refused the assessment: ${refusal?.code ?? response.status} ${refusal?.text ?? ''}`.trim() };
    }
    return {
      creditScore: Number(payload.creditScore),
      creditRating: String(payload.creditRating ?? ''),
      defaultProbability: Number(payload.defaultProbability),
      assessmentFactors: payload.assessmentFactors as CreditAssessmentResult['assessmentFactors'],
      assessmentAsOfDateTime: payload.assessmentAsOfDateTime as string | undefined,
    } as CreditAssessmentResult;
  } catch (err) {
    return { error: `bureau unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
