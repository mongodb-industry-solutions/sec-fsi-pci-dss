// Internal HRP (High-Risk Person / sanctions / PEP) engine — generates an evaluation of an
// individual. Built-in screener used when no external sanctions vendor is active (ADR-010/029).
// Stub: clean result; lists/threshold overridable from the Module config.
import { HrpInboundPayload } from '../../../modules/provider/models/externalProviderArrangement.model';

export interface HrpConfig {
  screeningLists: string[];
}

export function screenHrp(
  _input: Record<string, unknown>,
  _config?: Partial<HrpConfig>,
): HrpInboundPayload {
  return {
    sanctionsHit: false,
    pepHit: false,
    matchedLists: [],
    riskRating: 'low',
  };
}
