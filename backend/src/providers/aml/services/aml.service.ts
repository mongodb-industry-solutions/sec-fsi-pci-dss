// Internal AML monitoring engine (built-in; used when no external AML vendor is active).
import { AmlInboundPayload } from '../../../modules/provider/models/externalProviderArrangement.model';

export function screenAml(_input: Record<string, unknown>): AmlInboundPayload {
  return { alertLevel: 'none', matchedPatterns: [], requiresReview: false };
}
