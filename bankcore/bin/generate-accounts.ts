// Dev-time generator for the bank's account fixtures, and for the PSP link fields that point at them.
//
// It exists because the two sides must agree on deterministic references, and a dangling reference
// between two databases is invisible until a demo breaks. Run it whenever the PSP's payout accounts
// change; the generated files are committed, reviewable fixtures, and the cross-side validation in
// setup:check is what catches divergence if someone forgets.
//
//   npx ts-node bin/generate-accounts.ts
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import type { AccountArrangementControlRecord } from '../src/modules/aspsp/models/accountArrangement.model';
import type { AccountHolderControlRecord } from '../src/modules/aspsp/models/accountHolder.model';
import type { BankProfileControlRecord } from '../src/modules/aspsp/models/bankProfile.model';

const BANKCORE_DATA = resolve(__dirname, '../data');
const BACKEND_DATA = resolve(__dirname, '../../backend/data');

interface PayoutAccount {
  payoutAccountInstanceReference: string;
  partyInstanceReference: string;
  payoutAccountType: string;
  payoutAccountStatus: string;
  payoutAccountIban?: string;
  payoutAccountBicSwift?: string;
  payoutAccountRoutingNumber?: string;
  payoutAccountBankName?: string;
  payoutAccountBankAddress?: string;
  payoutAccountAlias?: string;
  payoutAccountHolderName?: string;
  payoutAccountCurrency: string;
  payoutAccountCountryCode: string;
  payoutAccountBalance?: { availableAmount: number; pendingAmount: number; reservedAmount: number; currency: string; lastUpdatedDateTime: string };
  recordCreatedDateTime: string;
  [key: string]: unknown;
}

// National bank identifier of THIS bank per country. One institution with branches in several
// countries, which is what a pan-European bank looks like: one BIC, one code per national scheme.
// Lengths follow ISO 13616 and must match bankIdentifier.service's IBAN_BANK_CODE_LENGTH.
let BANK_CODE_BY_COUNTRY: Record<string, string> = {};

// Remaining BBAN length after the bank code, per country (ISO 13616).
const BBAN_TAIL_LENGTH: Record<string, number> = {
  ES: 16,
  FR: 18,
  GB: 14,
  NL: 10,
  DE: 10,
};

function digitsFrom(seed: string, count: number): string {
  let out = '';
  let round = 0;
  while (out.length < count) {
    out += BigInt(`0x${createHash('sha256').update(`${seed}:${round++}`).digest('hex')}`).toString().replace(/\D/g, '');
  }
  return out.slice(0, count);
}

function ibanCheckDigits(country: string, bban: string): string {
  const rearranged = `${bban}${country}00`;
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return String(98 - remainder).padStart(2, '0');
}

function buildIban(country: string, seed: string): string {
  const bankCode = BANK_CODE_BY_COUNTRY[country];
  const tail = BBAN_TAIL_LENGTH[country];
  if (!bankCode || tail === undefined) throw new Error(`no bank code configured for country ${country}`);
  const bban = `${bankCode}${digitsFrom(seed, tail)}`;
  return `${country}${ibanCheckDigits(country, bban)}${bban}`;
}

function maskIban(iban: string): string {
  return `${iban.slice(0, 4)}${'*'.repeat(Math.max(0, iban.length - 8))}${iban.slice(-4)}`;
}

// Deterministic references, derived from the PSP's own so the two sides agree without a handshake.
function accountRefFor(payoutRef: string): string {
  return `acc${payoutRef.slice(3)}`;
}
function holderRefFor(partyRef: string): string {
  return `hld${partyRef.slice(3)}`;
}

function main(): void {
  const profiles = JSON.parse(readFileSync(resolve(BANKCORE_DATA, 'bankProfile.json'), 'utf8')) as BankProfileControlRecord[];
  const bank = profiles[0];
  BANK_CODE_BY_COUNTRY = bank.bankProfileNationalBankCodeByCountry ?? {};
  if (Object.keys(BANK_CODE_BY_COUNTRY).length === 0) {
    throw new Error('bankProfile.bankProfileNationalBankCodeByCountry is empty: nothing could be routed');
  }
  const accounts = JSON.parse(readFileSync(resolve(BACKEND_DATA, 'payoutAccounts.json'), 'utf8')) as PayoutAccount[];

  const holders = new Map<string, AccountHolderControlRecord>();
  const arrangements: AccountArrangementControlRecord[] = [];
  let linked = 0;

  for (const account of accounts) {
    // Only real bank accounts move: the PSP revenue ledger and the wallet are not accounts at a bank.
    if (account.payoutAccountType !== 'bank_account') continue;
    const country = account.payoutAccountCountryCode;
    if (!BANK_CODE_BY_COUNTRY[country]) {
      throw new Error(`account ${account.payoutAccountInstanceReference} is in ${country}, which this bank has no code for`);
    }

    const holderRef = holderRefFor(account.partyInstanceReference);
    if (!holders.has(holderRef)) {
      holders.set(holderRef, {
        accountHolderInstanceReference: holderRef,
        accountHolderName: account.payoutAccountHolderName ?? 'Account holder',
        accountHolderCountryCode: country,
        accountHolderStatus: 'active',
        bianServiceDomain: 'Party Reference Data Directory',
        bianControlRecordType: 'AccountHolder',
        recordCreatedDateTime: account.recordCreatedDateTime,
        schemaVersion: 1,
      });
    }

    const accountRef = accountRefFor(account.payoutAccountInstanceReference);
    const iban = buildIban(country, accountRef);
    const balance = account.payoutAccountBalance;

    arrangements.push({
      accountArrangementInstanceReference: accountRef,
      accountHolderInstanceReference: holderRef,
      bankProfileInstanceReference: bank.bankProfileInstanceReference,
      accountKind: 'current',
      accountStatus: account.payoutAccountStatus === 'active' ? 'active' : 'blocked',
      accountAlias: account.payoutAccountAlias,
      accountCurrency: account.payoutAccountCurrency,
      accountCountryCode: country,
      accountIban: iban,
      accountBic: bank.bankProfileBic,
      accountMaskedIban: maskIban(iban),
      accountBalance: {
        availableAmount: balance?.availableAmount ?? 0,
        pendingAmount: balance?.pendingAmount ?? 0,
        reservedAmount: balance?.reservedAmount ?? 0,
        currency: account.payoutAccountCurrency,
        lastUpdatedDateTime: balance?.lastUpdatedDateTime ?? account.recordCreatedDateTime,
      },
      accountOpenedDateTime: account.recordCreatedDateTime,
      bianServiceDomain: 'Current Account',
      bianControlRecordType: 'AccountArrangement',
      recordCreatedDateTime: account.recordCreatedDateTime,
      schemaVersion: 1,
    });

    // The PSP record becomes a LINK: same reference, same alias, same balance shape, new coordinates
    // and the two fields that say which bank holds it. Every field an existing consumer reads stays.
    account.payoutAccountIban = iban;
    account.payoutAccountBicSwift = bank.bankProfileBic;
    account.payoutAccountRoutingNumber = bank.bankProfileBic;
    account.payoutAccountBankName = bank.bankProfileName;
    account.payoutAccountBankAddress = bank.bankProfileAddress ?? bank.bankProfileLegalName;
    account.payoutAccountCorrespondentBic = bank.bankProfileCorrespondentBic;
    account.payoutAccountAspspReference = bank.bankProfileInstanceReference;
    account.payoutAccountBankAccountReference = accountRef;
    linked++;
  }

  writeFileSync(resolve(BANKCORE_DATA, 'accountHolders.json'), `${JSON.stringify([...holders.values()], null, 2)}\n`);
  writeFileSync(resolve(BANKCORE_DATA, 'accountArrangements.json'), `${JSON.stringify(arrangements, null, 2)}\n`);
  writeFileSync(resolve(BACKEND_DATA, 'payoutAccounts.json'), `${JSON.stringify(accounts, null, 2)}\n`);

  console.log(`  bankcore/data/accountHolders.json:      ${holders.size} holder(s)`);
  console.log(`  bankcore/data/accountArrangements.json: ${arrangements.length} account(s)`);
  console.log(`  backend/data/payoutAccounts.json:       ${linked} account(s) turned into links`);
}

main();
