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
