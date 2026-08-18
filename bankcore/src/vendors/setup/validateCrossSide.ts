import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Db } from 'mongodb';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../modules/aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION } from '../../modules/aspsp/models/accountHolder.model';
import { BANK_PROFILE_COLLECTION, BankProfileControlRecord } from '../../modules/aspsp/models/bankProfile.model';
import { ownsIban, isValidIban } from '../../modules/aspsp/services/bankIdentifier.service';

// Cross side consistency. A dangling reference between two databases is invisible until a demo breaks
// in front of someone, so it is asserted rather than assumed.
//
// The PSP fixture is read from disk, not from its database: the check must work before the PSP has
// been seeded, and the fixtures are the contract the two sides agree on.
const PSP_DATA = resolve(__dirname, '../../../../backend/data');

interface PspLinkedAccount {
  payoutAccountInstanceReference: string;
  payoutAccountType: string;
  payoutAccountIban?: string;
  payoutAccountAspspReference?: string;
  payoutAccountBankAccountReference?: string;
}

export interface CrossSideCheck { name: string; ok: boolean; detail?: string }

export async function validateCrossSide(db: Db): Promise<CrossSideCheck[]> {
  const checks: CrossSideCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  const fixture = resolve(PSP_DATA, 'payoutAccounts.json');
  if (!existsSync(fixture)) {
    add('PSP payout account fixture', false, `not found at ${fixture}`);
    return checks;
  }

  const psp = (JSON.parse(readFileSync(fixture, 'utf8')) as PspLinkedAccount[])
    .filter((a) => a.payoutAccountType === 'bank_account');
  const profile = await db.collection<BankProfileControlRecord>(BANK_PROFILE_COLLECTION).findOne({});

  const accountRefs = new Set(
    (await db.collection(ACCOUNT_ARRANGEMENT_COLLECTION)
      .find({}, { projection: { _id: 0, accountArrangementInstanceReference: 1 } })
      .toArray()).map((a) => a.accountArrangementInstanceReference as string),
  );

  const unlinked = psp.filter((a) => !a.payoutAccountBankAccountReference || !a.payoutAccountAspspReference);
  add('every PSP bank account carries its bank link', unlinked.length === 0,
    unlinked.length === 0 ? `${psp.length} linked` : `missing on: ${unlinked.slice(0, 3).map((a) => a.payoutAccountInstanceReference).join(', ')}`);

  const dangling = psp.filter((a) => a.payoutAccountBankAccountReference && !accountRefs.has(a.payoutAccountBankAccountReference));
  add('every PSP link resolves to a real bank account', dangling.length === 0,
    dangling.length === 0 ? undefined : `dangling: ${dangling.slice(0, 3).map((a) => a.payoutAccountBankAccountReference).join(', ')}`);

  // An account whose IBAN this bank does not own is unroutable: nothing can decide it belongs here.
  if (profile) {
    const unroutable = psp.filter((a) => !a.payoutAccountIban || !isValidIban(a.payoutAccountIban) || !ownsIban(profile, a.payoutAccountIban));
    add('every seeded IBAN is valid and inside this bank\'s codes', unroutable.length === 0,
      unroutable.length === 0 ? undefined : `unroutable: ${unroutable.slice(0, 3).map((a) => a.payoutAccountIban).join(', ')}`);
  }

  // Application side join, not $lookup: Queryable Encryption rejects $lookup over an encrypted
  // collection ("encryption properties are not known until runtime"), so sequential queries plus a
  // set difference is the pattern everywhere in this platform.
  const holderRefs = new Set(
    (await db.collection(ACCOUNT_HOLDER_COLLECTION)
      .find({}, { projection: { _id: 0, accountHolderInstanceReference: 1 } })
      .toArray()).map((h) => h.accountHolderInstanceReference as string),
  );
  const accountHolderLinks = await db.collection(ACCOUNT_ARRANGEMENT_COLLECTION)
    .find({}, { projection: { _id: 0, accountArrangementInstanceReference: 1, accountHolderInstanceReference: 1 } })
    .toArray();
  const orphanHolders = accountHolderLinks.filter((a) => !holderRefs.has(a.accountHolderInstanceReference as string));
  add('every bank account has its holder', orphanHolders.length === 0,
    orphanHolders.length === 0 ? undefined : `${orphanHolders.length} account(s) with no holder`);

  return checks;
}
