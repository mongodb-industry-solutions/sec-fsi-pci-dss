/**
 * Unit tests (dev.v30): realistic per-card CVV derivation + cvvMode acceptance + extended validation.
 * PCI DSS: the CVV is derived (HMAC/CVK), never stored. These tests use a fixed CVK buffer;
 * no DB, no KMS.
 */
import { describe, it, expect } from 'vitest';
import { derivePerCardCvv, normalizeExpiry, DEFAULT_SERVICE_CODE } from '../../../../backend/src/providers/card-issuer/services/cardVerificationKey.service';
import { validateCard, resolveCardIssuerConfig, DEFAULT_CARD_ISSUER_CONFIG, type CardIssuerSimulatorConfig } from '../../../../backend/src/providers/card-issuer/services/cardIssuer.service';

const CVK = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'); // 32 bytes, test-only

describe('per-card CVV derivation', () => {
  const args = { cardToken: 'pm_abc123', expiryMMYY: '0527', serviceCode: DEFAULT_SERVICE_CODE, cvvLength: 3 };

  it('is deterministic for the same inputs', () => {
    expect(derivePerCardCvv(CVK, args)).toBe(derivePerCardCvv(CVK, args));
  });

  it('produces the requested number of digits', () => {
    expect(derivePerCardCvv(CVK, args)).toMatch(/^\d{3}$/);
    expect(derivePerCardCvv(CVK, { ...args, cvvLength: 4 })).toMatch(/^\d{4}$/);
  });

  it('changes when the token, expiry, service code or CVK changes', () => {
    const base = derivePerCardCvv(CVK, args);
    expect(derivePerCardCvv(CVK, { ...args, cardToken: 'pm_other' })).not.toBe(base);
    expect(derivePerCardCvv(CVK, { ...args, expiryMMYY: '0628' })).not.toBe(base);
    expect(derivePerCardCvv(CVK, { ...args, serviceCode: '101' })).not.toBe(base);
    expect(derivePerCardCvv(Buffer.from('ffffffffffffffffffffffffffffffff', 'utf8'), args)).not.toBe(base);
  });

  it('normalizeExpiry maps MM/YY and MM/YYYY to MMYY', () => {
    expect(normalizeExpiry('05/27')).toBe('0527');
    expect(normalizeExpiry('5/2027')).toBe('0527');
  });
});

describe('cvvMode acceptance', () => {
  const cfg = (mode: CardIssuerSimulatorConfig['cvvMode']): CardIssuerSimulatorConfig => ({ ...DEFAULT_CARD_ISSUER_CONFIG, cvvMode: mode });
  const perCard = '456';
  const base = { network: 'VISA', cvv: '', cvvExpected: true } as Record<string, unknown>;

  it('both: accepts the global CVV', () => {
    expect(validateCard({ ...base, cvv: '123' }, cfg('both'), { perCardCvv: perCard }).approved).toBe(true);
  });
  it('both: accepts the per-card CVV', () => {
    expect(validateCard({ ...base, cvv: perCard }, cfg('both'), { perCardCvv: perCard }).approved).toBe(true);
  });
  it('global: rejects the per-card CVV', () => {
    expect(validateCard({ ...base, cvv: perCard }, cfg('global'), { perCardCvv: perCard }).approved).toBe(false);
  });
  it('per_card: rejects the global CVV', () => {
    expect(validateCard({ ...base, cvv: '123' }, cfg('per_card'), { perCardCvv: perCard }).approved).toBe(false);
  });
  it('rejects a wrong CVV in every mode', () => {
    for (const m of ['both', 'global', 'per_card'] as const) {
      expect(validateCard({ ...base, cvv: '999' }, cfg(m), { perCardCvv: perCard }).approved).toBe(false);
    }
  });
});

describe('extended validation (registration + funding)', () => {
  it('declines an unregistered card', () => {
    const r = validateCard({ network: 'VISA' }, DEFAULT_CARD_ISSUER_CONFIG, { cardRegistered: false });
    expect(r.approved).toBe(false);
    expect(r.decisionReason).toBe('card_not_registered');
  });
  it('declines a card with no funding account', () => {
    const r = validateCard({ network: 'VISA' }, DEFAULT_CARD_ISSUER_CONFIG, { cardRegistered: true, hasFundingAccount: false });
    expect(r.approved).toBe(false);
    expect(r.decisionReason).toBe('no_funding_account');
  });
  it('stays lenient when the facts are not asserted (direct simulator path)', () => {
    expect(validateCard({ network: 'VISA' }, DEFAULT_CARD_ISSUER_CONFIG, {}).approved).toBe(true);
  });
});

describe('cardholder-name verification (v30.1)', () => {
  const base = { network: 'VISA' } as Record<string, unknown>;
  // The check only runs when the module flag verifyCardholderName is enabled (default off).
  const cfgOn = { ...DEFAULT_CARD_ISSUER_CONFIG, verifyCardholderName: true };
  it('approves when the supplied name matches the registered owner (case/spacing lenient)', () => {
    const r = validateCard({ ...base, cardHolderName: '  JOHN   Doe ' }, cfgOn, { expectedCardholderName: 'John Doe' });
    expect(r.approved).toBe(true);
  });
  it('declines on a name mismatch', () => {
    const r = validateCard({ ...base, cardHolderName: 'Jane Smith' }, cfgOn, { expectedCardholderName: 'John Doe' });
    expect(r.approved).toBe(false);
    expect(r.decisionReason).toBe('cardholder_name_mismatch');
  });
  it('is skipped on the tokenized path (no name supplied), even with an expected name', () => {
    const r = validateCard({ ...base }, cfgOn, { expectedCardholderName: 'John Doe' });
    expect(r.approved).toBe(true);
  });
  it('is skipped entirely when verifyCardholderName is off (default), even on a mismatch', () => {
    const r = validateCard({ ...base, cardHolderName: 'Jane Smith' }, DEFAULT_CARD_ISSUER_CONFIG, { expectedCardholderName: 'John Doe' });
    expect(r.approved).toBe(true);
  });
});

describe('cvvMode config resolution', () => {
  it('defaults to both, honours a valid override, ignores garbage', () => {
    expect(resolveCardIssuerConfig({}).cvvMode).toBe('both');
    expect(resolveCardIssuerConfig({ cvvMode: 'per_card' }).cvvMode).toBe('per_card');
    expect(resolveCardIssuerConfig({ cvvMode: 'nonsense' }).cvvMode).toBe('both');
  });
});

/**
 * A first-time card must be payable. The registration / funding-account checks (v30) belong to a
 * CARD-ON-FILE charge, where the token is the credential and must name a card the PSP holds. Applied to
 * a payer presenting the full card at a checkout they made every first payment impossible: the client
 * tokenizes the PAN before authorizing, so an unseen card always resolved as "not registered", and the
 * whole simulator declined with 56 (or 54 first, when the demo card had also expired).
 */
describe('registration checks apply to card-on-file, not to a card the payer presents', () => {
  const fullCard = {
    cardToken: 'pm_freshly_tokenized',
    maskedPan: '****-****-****-4242',
    cardNumber: '4242424242424242',
    cvv: '123',
    expiry: '12/28',
    cvvExpected: true,
  };

  it('approves a presented card even when the token is unknown to the PSP', () => {
    const out = validateCard(fullCard, DEFAULT_CARD_ISSUER_CONFIG, { cardRegistered: false, hasFundingAccount: false });
    expect(out.approved).toBe(true);
    expect(out.decisionReason).toBe('approved');
  });

  // The hosted checkout and payment-link pages tokenize in the browser and post token + CVV + expiry,
  // never the PAN, so a presentation must be recognised without one.
  it('approves a hosted-page payment: token + CVV + expiry, no PAN', () => {
    const out = validateCard(
      { cardToken: 'pm_hosted', maskedPan: '****-****-****-1212', cvv: '123', expiry: '12/28', cvvExpected: true },
      DEFAULT_CARD_ISSUER_CONFIG,
      { cardRegistered: false, hasFundingAccount: false },
    );
    expect(out.approved).toBe(true);
  });

  it('still declines an unregistered card-on-file charge (token only, no credentials)', () => {
    const out = validateCard({ cardToken: 'pm_unknown', maskedPan: '****-****-****-4242' }, DEFAULT_CARD_ISSUER_CONFIG, { cardRegistered: false });
    expect(out.approved).toBe(false);
    expect(out.decisionReason).toBe('card_not_registered');
    expect(out.responseCode).toBe('56');
  });

  it('still declines an on-file card with no funding account', () => {
    const out = validateCard({ cardToken: 'pm_known', maskedPan: '****-****-****-4242' }, DEFAULT_CARD_ISSUER_CONFIG, { cardRegistered: true, hasFundingAccount: false });
    expect(out.decisionReason).toBe('no_funding_account');
  });

  it('keeps declining an expired card, whatever its registration', () => {
    const out = validateCard({ ...fullCard, expiry: '06/26' }, DEFAULT_CARD_ISSUER_CONFIG, { cardRegistered: false });
    expect(out.decisionReason).toBe('expired_card');
    expect(out.responseCode).toBe('54');
  });
});
