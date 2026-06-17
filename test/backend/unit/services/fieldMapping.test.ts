/**
 * Unit tests: field-mapping PCI guardrails. Cardholder data may be remapped ONLY for a card
 * issuer / card authorization connector (e.g. cardNumber -> card_value); blocked everywhere else.
 * Secrets are never mappable.
 */
import { describe, it, expect } from 'vitest';
import { validateMappingRules, mayMapCardData } from '../../../../backend/src/modules/providers/services/fieldMapping.service';

const rule = (sourcePath: string, targetPath: string) => ({ sourcePath, targetPath });

describe('validateMappingRules (PCI guardrails)', () => {
  it('allows mapping a normal field for any provider', () => {
    expect(validateMappingRules([rule('amount', 'transaction_amount')])).toEqual([]);
  });

  it('blocks cardholder data for a non-card provider', () => {
    const errs = validateMappingRules([rule('cardNumber', 'card_value')]);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('cardholder-data');
  });

  it('allows cardholder-data mapping when allowCardData (issuer/card-auth)', () => {
    expect(validateMappingRules([rule('cardNumber', 'card_value'), rule('cvv', 'cvv2')], { allowCardData: true })).toEqual([]);
  });

  it('never allows mapping a secret, even for a card provider', () => {
    const errs = validateMappingRules([rule('externalProviderCallbackSecretHash', 'secret')], { allowCardData: true });
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('secret');
  });

  it('mayMapCardData is true only for card issuer / card authorization', () => {
    expect(mayMapCardData('card_issuer')).toBe(true);
    expect(mayMapCardData('card_authorization')).toBe(true);
    expect(mayMapCardData('fraud_detection')).toBe(false);
    expect(mayMapCardData(undefined)).toBe(false);
  });
});
