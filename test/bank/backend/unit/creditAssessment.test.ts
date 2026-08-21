// v37 P8: the bank as credit bureau for the parties it banks.
//
// What this defends: the score responds to the evidence. What it replaced returned 720/A/0.02 for every
// subject, so nothing about the customer changed the answer and nothing about the answer meant anything. A
// scoring function whose output does not move with its inputs is a constant wearing a function's clothes,
// and these tests are mostly about proving each input actually moves it.
import { describe, it, expect } from 'vitest';
import {
  assess, DEFAULT_CREDIT_BUREAU_CONFIG,
  type AssessmentEvidence, type CreditBureauConfig,
} from '../../../../bank/backend/src/modules/credit-bureau/services/creditAssessment.service';

function evidence(overrides: Partial<AssessmentEvidence> = {}): AssessmentEvidence {
  return {
    relationshipYears: 0,
    totalAvailableBalance: 0,
    returnedPaymentCount: 0,
    accountCount: 1,
    ...overrides,
  };
}

function config(overrides: Partial<CreditBureauConfig> = {}): CreditBureauConfig {
  return { ...DEFAULT_CREDIT_BUREAU_CONFIG, ...overrides };
}

describe('the score moves with the evidence', () => {
  it('a longer relationship scores higher, up to the cap', () => {
    const one = assess(evidence({ relationshipYears: 1 }), config()).creditScore;
    const three = assess(evidence({ relationshipYears: 3 }), config()).creditScore;
    expect(three).toBeGreaterThan(one);
    // Capped, so an ancient account cannot carry a customer indefinitely.
    const five = assess(evidence({ relationshipYears: 5 }), config()).creditScore;
    const twenty = assess(evidence({ relationshipYears: 20 }), config()).creditScore;
    expect(twenty).toBe(five);
  });

  it('counts only FULL years, so a new customer earns nothing for the first one', () => {
    const days = assess(evidence({ relationshipYears: 0.9 }), config());
    expect(days.assessmentFactors.find((f) => f.assessmentFactorName === 'relationship_length')?.assessmentFactorPoints)
      .toBe(0);
  });

  it('a larger balance scores higher, by band', () => {
    const scores = [0, 500, 2_000, 7_000, 50_000]
      .map((balance) => assess(evidence({ totalAvailableBalance: balance }), config()).creditScore);
    for (let index = 1; index < scores.length; index += 1) {
      expect(scores[index]).toBeGreaterThanOrEqual(scores[index - 1]);
    }
    expect(scores[scores.length - 1]).toBeGreaterThan(scores[0]);
  });

  it('sorts the balance bands itself rather than trusting the configured order', () => {
    // A mis-ordered band list would otherwise match the first band that happens to fit and hand out the
    // wrong points, which is the kind of configuration error nobody notices.
    const reversed = config({ balanceBands: [...DEFAULT_CREDIT_BUREAU_CONFIG.balanceBands].reverse() });
    expect(assess(evidence({ totalAvailableBalance: 50_000 }), reversed).creditScore)
      .toBe(assess(evidence({ totalAvailableBalance: 50_000 }), config()).creditScore);
  });

  it('a returned payment costs more than a year of good standing earns', () => {
    // The strongest negative signal a bank has on its own books should outweigh the weakest positive one,
    // or the score would reward simply having stayed.
    const clean = assess(evidence({ relationshipYears: 1 }), config()).creditScore;
    const returned = assess(evidence({ relationshipYears: 1, returnedPaymentCount: 1 }), config()).creditScore;
    expect(returned).toBeLessThan(clean);
    expect(clean - returned).toBeGreaterThan(DEFAULT_CREDIT_BUREAU_CONFIG.pointsPerRelationshipYear);
  });

  it('never leaves the configured range, however bad or good the evidence', () => {
    const terrible = assess(evidence({ returnedPaymentCount: 50 }), config());
    expect(terrible.creditScore).toBe(DEFAULT_CREDIT_BUREAU_CONFIG.minimumScore);
    const excellent = assess(
      evidence({ relationshipYears: 40, totalAvailableBalance: 1_000_000 }),
      config({ baseScore: 900 }),
    );
    expect(excellent.creditScore).toBe(DEFAULT_CREDIT_BUREAU_CONFIG.maximumScore);
  });
});

describe('the rating and the default probability follow the score', () => {
  it('sorts the rating bands itself, so a mis-ordered configuration cannot mis-rate', () => {
    const reversed = config({ ratingBands: [...DEFAULT_CREDIT_BUREAU_CONFIG.ratingBands].reverse() });
    const good = evidence({ relationshipYears: 20, totalAvailableBalance: 50_000 });
    expect(assess(good, reversed).creditRating).toBe(assess(good, config()).creditRating);
  });

  it('rates a strong file above a weak one', () => {
    const strong = assess(evidence({ relationshipYears: 20, totalAvailableBalance: 50_000 }), config());
    const weak = assess(evidence({ returnedPaymentCount: 2 }), config());
    const order = ['E', 'D', 'C', 'B', 'A'];
    expect(order.indexOf(strong.creditRating)).toBeGreaterThan(order.indexOf(weak.creditRating));
  });

  it('falls back to the lowest rating rather than none when no band matches', () => {
    expect(assess(evidence(), config({ ratingBands: [{ rating: 'A', minimumScore: 9_999 }] })).creditRating)
      .toBe('E');
  });

  it('reports a probability that distinguishes two scores in the same band', () => {
    // Tabulating per rating would make every A look identical, which is exactly the flatness this replaced.
    const lower = assess(evidence({ relationshipYears: 2 }), config());
    const higher = assess(evidence({ relationshipYears: 5, totalAvailableBalance: 50_000 }), config());
    expect(higher.defaultProbability).toBeLessThan(lower.defaultProbability);
    for (const result of [lower, higher]) {
      expect(result.defaultProbability).toBeGreaterThanOrEqual(0);
      expect(result.defaultProbability).toBeLessThanOrEqual(1);
    }
  });
});

describe('the assessment explains itself', () => {
  it('returns a factor per input, with points that add up to the score', () => {
    const result = assess(evidence({ relationshipYears: 3, totalAvailableBalance: 7_000, returnedPaymentCount: 1 }), config());
    const names = result.assessmentFactors.map((factor) => factor.assessmentFactorName);
    expect(names).toEqual(['relationship_length', 'available_balance', 'returned_payments']);
    // The stated reasoning must reconstruct the number, or the explanation is decoration.
    const total = result.assessmentFactors.reduce((sum, factor) => sum + factor.assessmentFactorPoints, 0);
    expect(DEFAULT_CREDIT_BUREAU_CONFIG.baseScore + total).toBe(result.creditScore);
  });

  it('says something about a clean file rather than staying silent', () => {
    const result = assess(evidence(), config());
    const returns = result.assessmentFactors.find((f) => f.assessmentFactorName === 'returned_payments');
    expect(returns?.assessmentFactorPoints).toBe(0);
    expect(returns?.assessmentFactorObservation).toContain('no returned payments');
  });

  it('every rule is configuration: retuning changes the answer', () => {
    // The same requirement as the card issuer's CVV. If these were constants the second assertion would
    // match the first.
    const base = assess(evidence({ relationshipYears: 2 }), config()).creditScore;
    const generous = assess(evidence({ relationshipYears: 2 }), config({ pointsPerRelationshipYear: 40 })).creditScore;
    expect(generous).toBeGreaterThan(base);
  });
});
