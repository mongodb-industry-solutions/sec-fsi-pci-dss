/**
 * Unit tests: internal capability Module engines (ADR-029, dev.v7 Fase 4).
 * Pure functions, no DB. Validates the engines that back /api/v1/modules/<cap>/{score|screen}.
 */
import { describe, it, expect } from 'vitest';
import { scoreFds } from '../../../../backend/src/providers/fds/services/fds.service';
import { screenHrp } from '../../../../backend/src/providers/hrp/services/hrp.service';
import { screenAml } from '../../../../backend/src/providers/aml/services/aml.service';
import { verifyKyc } from '../../../../backend/src/providers/kyc/services/kyc.service';
import { verifyKyb } from '../../../../backend/src/providers/kyb/services/kyb.service';
import { scoreCreditBureau } from '../../../../backend/src/providers/credit-bureau/services/creditBureau.service';
import { authorizeCard } from '../../../../backend/src/providers/card-authorization/services/cardAuthorization.service';
import { validateCardIssuer } from '../../../../backend/src/providers/card-issuer/services/cardIssuer.service';

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

  it('aml/kyc/kyb/card engines return well-formed payloads', () => {
    expect(screenAml({}).requiresReview).toBe(false);
    expect(verifyKyc({}).verificationStatus).toBe('pass');
    expect(verifyKyb({}).sanctionsMatch).toBe(false);
    expect(authorizeCard({}).authorizationStatus).toBe('approved');
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

  describe('card issuer validation (configurable simulator)', () => {
    it('approves a well-formed Visa with the configured valid CVV', () => {
      const r = validateCardIssuer({ cardNumber: '4242424242424242', cvv: '123' });
      expect(r.actionConfirmed).toBe(true);
      expect(r.responseCode).toBe('00');
      expect(r.network).toBe('VISA');
      expect(r.cvvValidationResult).toBe('match');
    });
    it('declines a wrong CVV', () => {
      const r = validateCardIssuer({ cardNumber: '4242424242424242', cvv: '999' });
      expect(r.actionConfirmed).toBe(false);
      expect(r.responseCode).toBe('82');
      expect(r.cvvValidationResult).toBe('no_match');
    });
    it('declines a number that fails the Luhn check', () => {
      const r = validateCardIssuer({ cardNumber: '4242424242424241' });
      expect(r.actionConfirmed).toBe(false);
      expect(r.responseCode).toBe('14');
    });
    it('declines an unsupported network', () => {
      const r = validateCardIssuer({ cardNumber: '9999999999999999' });
      expect(r.actionConfirmed).toBe(false);
      expect(r.responseCode).toBe('12');
    });
    it('tokenized path (masked PAN + network, no CVV) approves a supported network', () => {
      const r = validateCardIssuer({ maskedPan: '****-****-****-4242', network: 'VISA' });
      expect(r.actionConfirmed).toBe(true);
      expect(r.cvvValidationResult).toBe('not_provided');
    });
    it('D1 (P13.1): declines when a CVV was expected on the channel but none was supplied', () => {
      const r = validateCardIssuer({ maskedPan: '****-****-****-4242', network: 'VISA', cvvExpected: true });
      expect(r.actionConfirmed).toBe(false);
      expect(r.responseCode).toBe('82');
      expect(r.decisionReason).toBe('cvv_required');
    });
    it('D1 (P13.1): a correct CVV on a CVV-bearing channel still approves', () => {
      const r = validateCardIssuer({ cardNumber: '4242424242424242', cvv: '123', cvvExpected: true });
      expect(r.actionConfirmed).toBe(true);
      expect(r.cvvValidationResult).toBe('match');
    });
    it('tokenized path with NO network hint does NOT false-decline (network not assessable)', () => {
      // Regression: a masked PAN alone hides the BIN, so the network cannot be assessed. The issuer
      // must not reject the card here (it was validated at entry), otherwise legit payments break.
      const r = validateCardIssuer({ maskedPan: '****-****-****-1212' });
      expect(r.actionConfirmed).toBe(true);
      expect(r.responseCode).toBe('00');
      expect(r.network).toBeNull();
    });
    it('never echoes the PAN or CVV in the response', () => {
      const r = validateCardIssuer({ cardNumber: '4242424242424242', cvv: '123' }) as Record<string, unknown>;
      const serialized = JSON.stringify(r);
      expect(serialized).not.toContain('4242424242424242');
      expect(serialized).not.toContain('123');
    });
  });
});
