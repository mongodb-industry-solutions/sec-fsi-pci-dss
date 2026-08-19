// v37 P1.3a/P2.6: nothing unroutable may be seeded.
//
// Every demo account and card belongs to the registered bank in this iteration, so each one has to be
// resolvable to it from its identifier alone. A seeded record outside the bank's codes or ranges is a
// seed defect: it would be refused the first time someone enters it, with no way to route it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isValidIban, ownsIban, ownsBic, resolveAccountOwnership, resolveCardOwnership,
} from '../../../bankcore/src/modules/aspsp/services/bankIdentifier.service';
import type { BankProfileControlRecord } from '../../../bankcore/src/modules/aspsp/models/bankProfile.model';
import type { AccountArrangementControlRecord } from '../../../bankcore/src/modules/aspsp/models/accountArrangement.model';

const ROOT = resolve(__dirname, '../../..');
const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T;

const BANK = read<BankProfileControlRecord[]>('bankcore/data/bankProfile.json')[0];
const BANK_ACCOUNTS = read<AccountArrangementControlRecord[]>('bankcore/data/accountArrangements.json');
const HOLDERS = read<Array<{ accountHolderInstanceReference: string }>>('bankcore/data/accountHolders.json');

interface PspAccount {
  payoutAccountInstanceReference: string;
  payoutAccountType: string;
  payoutAccountIban?: string;
  payoutAccountBicSwift?: string;
  payoutAccountCountryCode: string;
  payoutAccountAspspReference?: string;
  payoutAccountBankAccountReference?: string;
  payoutAccountBalance?: { availableAmount: number };
}
const PSP_ACCOUNTS = read<PspAccount[]>('backend/data/payoutAccounts.json')
  .filter((a) => a.payoutAccountType === 'bank_account');

describe('v37: the bank has a complete, routable identity', () => {
  it('publishes the coordinates a real counterparty would use', () => {
    expect(BANK.bankProfileBic).toMatch(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/);
    expect(BANK.bankProfileCorrespondentBic).toMatch(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/);
    expect(BANK.bankProfileAddress).toBeTruthy();
    expect(BANK.bankProfileName).toBeTruthy();
  });

  it('declares a national bank code for every country it holds accounts in', () => {
    const byCountry = BANK.bankProfileNationalBankCodeByCountry ?? {};
    for (const country of new Set(PSP_ACCOUNTS.map((a) => a.payoutAccountCountryCode))) {
      expect(byCountry[country], `no bank code declared for ${country}`).toBeTruthy();
      // The flat list is what the router matches against, so the two must agree.
      expect(BANK.bankProfileIbanBankCodes).toContain(byCountry[country]);
    }
  });
});

describe('v37 P2.6: every seeded account routes to the bank', () => {
  it('every PSP bank account has a valid IBAN the bank owns', () => {
    for (const account of PSP_ACCOUNTS) {
      expect(account.payoutAccountIban, account.payoutAccountInstanceReference).toBeTruthy();
      expect(isValidIban(account.payoutAccountIban!), `${account.payoutAccountIban} check digits`).toBe(true);
      expect(ownsIban(BANK, account.payoutAccountIban!), `${account.payoutAccountIban} bank code`).toBe(true);
      expect(ownsBic(BANK, account.payoutAccountBicSwift!)).toBe(true);
      expect(resolveAccountOwnership(BANK, { iban: account.payoutAccountIban })).toMatchObject({ owned: true });
    }
  });

  it('every PSP bank account links to a real bank account and holder', () => {
    const accountRefs = new Set(BANK_ACCOUNTS.map((a) => a.accountArrangementInstanceReference));
    const holderRefs = new Set(HOLDERS.map((h) => h.accountHolderInstanceReference));
    for (const account of PSP_ACCOUNTS) {
      expect(account.payoutAccountAspspReference).toBe(BANK.bankProfileInstanceReference);
      expect(accountRefs.has(account.payoutAccountBankAccountReference!), account.payoutAccountInstanceReference).toBe(true);
    }
    for (const bankAccount of BANK_ACCOUNTS) {
      expect(holderRefs.has(bankAccount.accountHolderInstanceReference), bankAccount.accountArrangementInstanceReference).toBe(true);
    }
  });

  it('the bank holds the same opening balance the PSP record shows', () => {
    // Until the flag flips, both sides carry it; after P2.4 the PSP's is a projection of this one.
    const byRef = new Map(BANK_ACCOUNTS.map((a) => [a.accountArrangementInstanceReference, a]));
    for (const account of PSP_ACCOUNTS) {
      const bankAccount = byRef.get(account.payoutAccountBankAccountReference!)!;
      expect(bankAccount.accountBalance.availableAmount).toBe(account.payoutAccountBalance?.availableAmount ?? 0);
      expect(bankAccount.accountCurrency).toBe(bankAccount.accountBalance.currency);
    }
  });

  it('the bank\'s own IBANs are valid and its own', () => {
    for (const bankAccount of BANK_ACCOUNTS) {
      expect(isValidIban(bankAccount.accountIban)).toBe(true);
      expect(ownsIban(BANK, bankAccount.accountIban)).toBe(true);
      // The masked form never exposes the middle of the IBAN.
      expect(bankAccount.accountMaskedIban).toMatch(/^[A-Z]{2}\d{2}\*+\d{4}$/);
    }
  });

  it('references stay deterministic, which is what lets the two sides agree without a handshake', () => {
    for (const account of PSP_ACCOUNTS) {
      expect(account.payoutAccountBankAccountReference)
        .toBe(`acc${account.payoutAccountInstanceReference.slice(3)}`);
    }
  });
});

describe('v37: every seeded card routes to the issuer', () => {
  it('the card seeder takes its BIN from the bank profile, not a bare network prefix', () => {
    // v37 P7: the seeder is the bank's now, and it reads its own profile from the database rather than a
    // fixture, because by then it has already seeded itself.
    const seeder = readFileSync(resolve(ROOT, 'bankcore/src/vendors/seed/seedCardIssuer.ts'), 'utf8');
    expect(seeder).toContain('BANK_PROFILE_COLLECTION');
    expect(seeder).toContain('binRangeFrom');
    // A bare prefix would put the card outside every declared range and make it unroutable.
    expect(seeder).not.toMatch(/prefix:\s*'4'/);
  });

  it('the PSP no longer derives a card number at all', () => {
    const descoping = readFileSync(resolve(ROOT, 'backend/src/vendors/seed/seedCardDescoping.ts'), 'utf8');
    expect(descoping).not.toContain('buildPan');
    expect(descoping).toContain('issuedCardRegistry');
  });

  it('both endpoints of every declared range resolve to this issuer', () => {
    for (const range of BANK.bankProfileBinRanges) {
      for (const bin of [range.binRangeFrom, range.binRangeTo]) {
        expect(resolveCardOwnership(BANK, `${bin}1234567890`)).toMatchObject({ owned: true, matchedOn: 'bin' });
      }
    }
  });

  it('a PAN just outside a range is refused with a reason, never routed to a default', () => {
    const range = BANK.bankProfileBinRanges[0];
    const justBelow = String(Number(range.binRangeFrom) - 1).padStart(range.binRangeFrom.length, '0');
    const justAbove = String(Number(range.binRangeTo) + 1).padStart(range.binRangeTo.length, '0');
    for (const bin of [justBelow, justAbove]) {
      expect(resolveCardOwnership(BANK, `${bin}1234567890`))
        .toMatchObject({ owned: false, reason: 'bin_not_issued_by_this_bank' });
    }
  });
});
