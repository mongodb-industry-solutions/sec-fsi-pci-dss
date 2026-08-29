// v39 P3.2 and P3.3: the two things called consent, kept apart.
//
// The plan warns that `consentAgreement` might mix OAuth scope consent with PSD2 account-access
// consent, and requires the migration to split it document by document rather than move it wholesale.
// The audit answered that question, and the answer is better than expected: they were never mixed.
//
//   · LeafyPay `consentAgreement` and `consentAccessLog` are declared and EMPTY. No source anywhere
//     writes them; only the model file names the constants. They are a v3 stub.
//   · The real PSD2 account-access consent lives in BankCore, in its own collections in its own
//     database, with 57 agreements and 695 access-log rows. It stays there, untouched.
//   · The OAuth scope consent is `partyAuthConsent`, and that is the one that becomes a grant.
//
// So the trap is real as a NAMING trap and absent as a data one. These tests keep it that way: the
// day someone starts writing the empty stub, or points identity code at the bank's consent records,
// this fails rather than a reviewer catching it.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, relative, sep } from 'path';

const PSP_SRC = resolve(__dirname, '../../../../../psp/backend/src');
const GIAM_SRC = resolve(__dirname, '../../../../../giam/backend/src');

function sourceFiles(root: string): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      found.push({ path: relative(root, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return found;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

// A write, as opposed to a read or a declaration. These are the calls that would put a row into a
// collection this phase says must stay empty, or change one that must not be altered.
const WRITE_CALLS = /\.(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndReplace|findOneAndDelete|drop)\s*\(/;

describe('v39 P3.2: the audit found nothing mixed to split', () => {
  it('has no writer of the LeafyPay consent stub anywhere in the application', () => {
    // If this ever fails, the split the plan describes becomes real work: something started
    // populating a collection that has been empty since v3, and its contents would then have to be
    // classified before anything moved.
    const offenders = sourceFiles(PSP_SRC)
      .filter((file) => !file.path.endsWith('consentAgreement.model.ts'))
      .filter((file) => !file.path.endsWith('consentAccessLog.model.ts'))
      .filter((file) => !file.path.includes('vendors/setup/'))
      .filter((file) => {
        const code = stripComments(file.text);
        return /CONSENT_AGREEMENT_COLLECTION|CONSENT_ACCESS_LOG_COLLECTION/.test(code)
          && WRITE_CALLS.test(code);
      })
      .map((file) => file.path);
    expect(offenders, `writes the consent stub: ${offenders.join(', ')}`).toEqual([]);
  });

  it('took the OAuth consent and left the account-access consent behind', () => {
    // The two were always separate collections, which is why "split document by document" turned out
    // to be a classification with nothing in it: one moved whole and the other did not move at all.
    //
    // The OAuth consent is gone from here entirely; a grant is the authority's record now.
    expect(
      existsSync(resolve(PSP_SRC, 'modules/identity/models/partyAuthConsent.model.ts')),
      'the OAuth consent model is still in the application',
    ).toBe(false);

    // The account-access consent stayed, and stayed exactly where the account-holding institution's
    // regulated data belongs. Asserting its ABSENCE from the authority is elsewhere in this file;
    // this asserts its presence here, because "moved nothing" needs both halves to be checked.
    const stub = readFileSync(resolve(PSP_SRC, 'modules/customer/models/consentAgreement.model.ts'), 'utf8');
    expect(stub).toMatch(/CONSENT_AGREEMENT_COLLECTION\s*=\s*'consentAgreement'/);
  });
});

describe('v39 P3.3: no account-access consent row is moved or altered', () => {
  it('never names the bank consent collections from the identity module', () => {
    // PSD2 account-access consent is regulated business data and evidence in a payment dispute. The
    // identity module has no basis to read it and no basis to write it, and the boundary is worth an
    // assertion because the names are similar enough to reach for by accident.
    const offenders = sourceFiles(PSP_SRC)
      .filter((file) => file.path.startsWith('modules/identity/'))
      .filter((file) => /bankConsentAgreement|bankConsentAccessLog/.test(stripComments(file.text)))
      .map((file) => file.path);
    expect(offenders, `identity code naming bank consent: ${offenders.join(', ')}`).toEqual([]);
  });

  it('never names any consent collection from the identity authority', () => {
    // The authority has no business knowing an account exists, so it cannot name an account-access
    // consent even to read one. A scope grant is the only consent it models.
    const offenders = sourceFiles(GIAM_SRC)
      .filter((file) => /bankConsent|consentAgreement|consentAccessLog/.test(stripComments(file.text)))
      .map((file) => file.path);
    expect(offenders, `the authority names an account-access consent: ${offenders.join(', ')}`).toEqual([]);
  });

  it('models a grant as scopes and a client, never as accounts', () => {
    // The shape is the guard. A grant that could name an account would be an account-access consent
    // wearing a different name, which is exactly the merge ADR-068 exists to prevent repeating.
    const grantModel = readFileSync(
      resolve(GIAM_SRC, 'shared/models/collections.ts'),
      'utf8',
    );
    expect(grantModel).toMatch(/GRANT_COLLECTION\s*=\s*'grant'/);
    expect(stripComments(grantModel)).not.toMatch(/\baccounts?\b/i);
  });
});
