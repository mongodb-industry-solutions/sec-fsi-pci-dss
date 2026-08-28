/**
 * Unit tests: internal capability Module engines (ADR-029, dev.v7 Fase 4).
 * Pure functions, no DB. Validates the engines that back /api/v1/modules/<cap>/{score|screen}.
 */
import { describe, it, expect, vi } from 'vitest';

// The credit bureau asks the bank, and resolving the bank reads the provider arrangement record. Stubbed,
// so this file stays what its header claims: engines, no DB.
vi.mock('../../../../../psp/backend/src/modules/provider/services/providerAccessToken.service', async () => {
  const { stubProviderResolution } = await import('../support/providerResolution');
  return stubProviderResolution();
});

import { scoreFds } from '../../../../../psp/backend/src/providers/fds/services/fds.service';
import { screenHrp } from '../../../../../psp/backend/src/providers/hrp/services/hrp.service';
import { screenAml } from '../../../../../psp/backend/src/providers/aml/services/aml.service';
import { verifyKyc } from '../../../../../psp/backend/src/providers/kyc/services/kyc.service';
import { verifyKyb } from '../../../../../psp/backend/src/providers/kyb/services/kyb.service';
import { scoreCreditBureau } from '../../../../../psp/backend/src/providers/credit-bureau/services/creditBureau.service';

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

  // The card authorisation engine is deliberately absent from this list (v37 P12): authorising a card is a
  // decision about whether an account will release money, so it belongs to the institution holding it. The
  // bank answers it over its own API and its own tests cover it.
  it('aml/kyc/kyb engines return well-formed payloads', () => {
    expect(screenAml({}).requiresReview).toBe(false);
    expect(verifyKyc({}).verificationStatus).toBe('pass');
    expect(verifyKyb({}).sanctionsMatch).toBe(false);
  });

  it('credit-bureau: refuses with no subject rather than inventing a score', async () => {
    // v37 P8: the assessment is the bank's, since the bank holds the accounts it is made from. The engine
    // used to answer 720 for an empty payload, which is exactly what it should not do: a score with no
    // subject and no evidence would be acted on as if it meant something.
    const result = await scoreCreditBureau({});
    expect(result.error).toBeTruthy();
    expect(result.creditScore).toBeUndefined();
  });

  it('credit-bureau: reports an unreachable bureau instead of substituting a default', async () => {
    const unreachable = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const result = await scoreCreditBureau({ accountHolderReference: 'holder-1' }, 'corr-1', unreachable);
    expect(result.error).toBeTruthy();
    expect(result.creditScore).toBeUndefined();
  });

});
