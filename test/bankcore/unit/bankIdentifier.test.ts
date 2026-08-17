// v37 P1.3a: the seeded routing mechanism. The bank's identifiers decide which accounts and cards are
// its own, and nothing unroutable may be seeded, because an unroutable record breaks the demo the
// first time someone enters it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ibanBankCode, isValidIban, panBin, ownsIban, ownsBic, ownsPan,
  resolveAccountOwnership, resolveCardOwnership,
} from '../../../bankcore/src/modules/aspsp/services/bankIdentifier.service';
import type { BankProfileControlRecord } from '../../../bankcore/src/modules/aspsp/models/bankProfile.model';

const PROFILES = JSON.parse(
  readFileSync(resolve(__dirname, '../../../bankcore/data/bankProfile.json'), 'utf8'),
) as BankProfileControlRecord[];
const BANK = PROFILES[0];

describe('v37 P1.3a: bank routing identifiers', () => {
  it('the seeded profile is routable on both paths', () => {
    expect(BANK.bankProfileBic).toMatch(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/);
    expect(BANK.bankProfileIbanBankCodes.length).toBeGreaterThan(0);
    expect(BANK.bankProfileBinRanges.length).toBeGreaterThan(0);
  });

  it('extracts the national bank code from an IBAN', () => {
    expect(ibanBankCode('ES9121000418450200051332')).toBe('2100');
    expect(ibanBankCode('GB29NWBK60161331926819')).toBe('NWBK');
    expect(ibanBankCode('DE89370400440532013000')).toBe('37040044');
  });

  it('returns null rather than guessing for an unsupported country', () => {
    expect(ibanBankCode('XK051212012345678906')).toBeNull();
    expect(ibanBankCode('not-an-iban')).toBeNull();
  });

  it('validates the ISO 13616 check digits', () => {
    expect(isValidIban('ES9121000418450200051332')).toBe(true);
    expect(isValidIban('GB29NWBK60161331926819')).toBe(true);
    // One digit changed: the check digits must reject it.
    expect(isValidIban('ES9121000418450200051333')).toBe(false);
  });

  it('recognises its own accounts and refuses another bank with a reason', () => {
    const own = `ES00${BANK.bankProfileIbanBankCodes[0]}00000000000000000`;
    expect(ownsIban(BANK, own)).toBe(true);
    expect(ownsIban(BANK, 'ES9121000418450200051332')).toBe(false);
    const refusal = resolveAccountOwnership(BANK, { iban: 'ES9121000418450200051332' });
    expect(refusal.owned).toBe(false);
    expect(refusal).toMatchObject({ reason: 'iban_bank_code_not_registered' });
  });

  it('matches a BIC in both its 8 and 11 character forms', () => {
    expect(ownsBic(BANK, BANK.bankProfileBic)).toBe(true);
    expect(ownsBic(BANK, BANK.bankProfileBic.slice(0, 8))).toBe(true);
    expect(ownsBic(BANK, 'CAIXESBBXXX')).toBe(false);
  });

  it('recognises its own cards by BIN and refuses others with a reason', () => {
    const bin = BANK.bankProfileBinRanges[0].binRangeFrom;
    expect(panBin(`${bin}1234567890`)).toBe(bin);
    expect(ownsPan(BANK, `${bin}1234567890`)).toBe(true);
    // 4111 11 is the canonical test Visa BIN and is deliberately outside the seeded range.
    expect(ownsPan(BANK, '4111111111111111')).toBe(false);
    expect(resolveCardOwnership(BANK, '4111111111111111')).toMatchObject({
      owned: false, reason: 'bin_not_issued_by_this_bank',
    });
  });

  it('never falls back to a default bank when nothing matches', () => {
    expect(resolveAccountOwnership(BANK, {})).toMatchObject({ reason: 'no_account_identifier_supplied' });
    expect(resolveCardOwnership(BANK, '41')).toMatchObject({ reason: 'pan_too_short_for_a_bin' });
  });

  it('the declared BIN ranges are narrow enough to identify one issuer', () => {
    // A range spanning a whole scheme prefix would claim every card in the world and make the
    // refusal path unreachable, which is the failure P6.3b guards against.
    for (const range of BANK.bankProfileBinRanges) {
      expect(range.binRangeFrom.length).toBe(6);
      expect(range.binRangeTo.length).toBe(6);
      const width = Number(range.binRangeTo) - Number(range.binRangeFrom);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThan(1000);
    }
  });
});
