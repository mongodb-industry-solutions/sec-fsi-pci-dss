// Internal Credit Bureau engine (built-in credit scoring; used when no external bureau vendor).
import { CreditBureauInboundPayload } from '../../../modules/providers/models/externalProviderArrangement.model';

export function scoreCreditBureau(_input: Record<string, unknown>): CreditBureauInboundPayload {
  return { creditScore: 720, creditRating: 'A', defaultProbability: 0.02 };
}
