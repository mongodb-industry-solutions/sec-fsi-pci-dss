// Stub High-Risk-Party (HRP) screening engine. Feeds the KYC verdict fields on
// customerAgreementProcedure.customerAgreementKycCheck (SD-13 party screening producing an SD-53
// Customer Agreement outcome). Deterministic and offline: a stable reference always maps to the
// same verdict, so seeded data and provider-produced data agree and demos are reproducible. There
// is no real external call (internal Module engine, ADR-029).

export type HrpRiskRating = 'low' | 'medium' | 'high';
export type HrpSanctionsResult = 'clear' | 'hit' | 'pending';

export interface HrpScreeningVerdict {
  riskScore: number;                 // 0-100 (QE:range on persist)
  riskRating: HrpRiskRating;         // derived from score (<40 low, <70 medium, else high)
  pepStatus: boolean;                // politically-exposed-person flag
  sanctionsResult: HrpSanctionsResult;
  screeningProviderRef: string;      // e.g. HRP-1a2b3c
}

const SANCTIONS: readonly HrpSanctionsResult[] = ['clear', 'hit', 'pending'];

// djb2 hash. Single source of truth for the deterministic seed (reused by the seeder).
export function screeningHash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

// Produce a deterministic HRP screening verdict for a party/agreement reference.
export function screenParty(reference: string): HrpScreeningVerdict {
  const seed = screeningHash(reference);
  const riskScore = seed % 101;                          // spread 0-100 across the range boundaries
  const riskRating: HrpRiskRating = riskScore < 40 ? 'low' : riskScore < 70 ? 'medium' : 'high';
  const pepStatus = seed % 7 === 0;                      // both true/false present, deterministic
  const sanctionsResult = seed % 11 === 0 ? SANCTIONS[1] : seed % 13 === 0 ? SANCTIONS[2] : SANCTIONS[0];
  const screeningProviderRef = `HRP-${(seed >>> 0).toString(16)}`;
  return { riskScore, riskRating, pepStatus, sanctionsResult, screeningProviderRef };
}
