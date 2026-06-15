/**
 * Unit tests: internal capability Module engines (ADR-029, dev.v7 Fase 4).
 * Pure functions — no DB. Validates the engines that back /api/v1/modules/<cap>/{score|screen}.
 */
import { describe, it, expect } from 'vitest';
import { scoreFds } from '../../../../backend/src/modules/fds/services/fds.service';
import { screenHrp } from '../../../../backend/src/modules/hrp/services/hrp.service';
import { screenAml } from '../../../../backend/src/modules/aml/services/aml.service';
import { verifyKyc } from '../../../../backend/src/modules/kyc/services/kyc.service';
import { verifyKyb } from '../../../../backend/src/modules/kyb/services/kyb.service';
import { scoreCreditBureau } from '../../../../backend/src/modules/credit-bureau/services/creditBureau.service';
import { authorizeCard } from '../../../../backend/src/modules/card-authorization/services/cardAuthorization.service';
import { validateCardIssuer } from '../../../../backend/src/modules/card-issuer/services/cardIssuer.service';

describe('capability module engines (ADR-029)', () => {
  it('fds: approves low value, flags high value, threshold configurable', () => {
    expect(scoreFds({ transactionAmount: 100 }).recommendation).toBe('approve');
    expect(scoreFds({ transactionAmount: 5000 }).fraudFlag).toBe(true);
    // Module config can override the review threshold (capabilityModuleConfiguration.moduleConfig)
    expect(scoreFds({ transactionAmount: 600 }, { reviewAmount: 500 }).fraudFlag).toBe(true);
    expect(scoreFds({ transactionAmount: 600 }, { reviewAmount: 500 }).recommendation).toBe('review');
  });

  it('hrp: clean evaluation of an individual by default', () => {
    const r = screenHrp({});
    expect(r.sanctionsHit).toBe(false);
    expect(r.pepHit).toBe(false);
    expect(r.riskRating).toBe('low');
  });

  it('aml/kyc/kyb/credit-bureau/card engines return well-formed payloads', () => {
    expect(screenAml({}).requiresReview).toBe(false);
    expect(verifyKyc({}).verificationStatus).toBe('pass');
    expect(verifyKyb({}).sanctionsMatch).toBe(false);
    expect(scoreCreditBureau({}).creditScore).toBeGreaterThan(0);
    expect(authorizeCard({}).authorizationStatus).toBe('approved');
    expect(validateCardIssuer({}).actionConfirmed).toBe(true);
  });
});
