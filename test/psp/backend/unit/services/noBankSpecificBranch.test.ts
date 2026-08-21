// v37 P4.6b/P4.6f: no bank is named in code, and nothing branches on which bank it is.
//
// This is the acceptance test of the whole design expressed mechanically. The plan's claim is that
// replacing bankcore with a real ASPSP needs no PSP code change; a conditional keyed on the bank's
// identifier, or on a provider being "internal", is exactly what would break that, and it is the kind of
// shortcut that looks harmless in review. Grep is a poor tool for intent but a good one for this.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join, sep } from 'path';

const ROOT = resolve(__dirname, '../../../../..');

function sourceFiles(directory: string, accumulated: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, accumulated);
    else if (/\.tsx?$/.test(entry)) accumulated.push(path);
  }
  return accumulated;
}

// Strip comments before matching. A comment naming the bank is documentation, and this gate is about what
// the code DOES: matching prose would make it fire on the very explanations that keep the rule alive.
function code(path: string): string {
  // Line comments FIRST: one containing `/*` (a URL like `/api/v1/internal/*`) would otherwise open a fake
  // block comment and swallow real code up to the next `*/`. In a `not.toContain` assertion that makes this
  // gate pass by deleting the very code it should be checking, which is the worst kind of green.
  return readFileSync(path, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1\s*:/g, '$1$1:');
}

// The bank's seeded identity. None of it may appear in a runtime decision: it lives in data.
const BANK_IDENTIFIERS = [
  'VRDNESMMXXX',     // the BIC
  'Verdant Bank',    // the name
  'bank0001-',       // the seeded bankProfile reference
];

describe('v37 P4.6b: no bank is named in the PSP code', () => {
  const files = sourceFiles(resolve(ROOT, 'psp/backend/src'))
    .concat(sourceFiles(resolve(ROOT, 'psp/frontend/src')));

  it('finds sources to scan, so this is not vacuous', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  for (const identifier of BANK_IDENTIFIERS) {
    it(`does not mention ${identifier}`, () => {
      const offenders = files.filter((path) => code(path).includes(identifier))
        .map((path) => path.replace(ROOT, ''));
      // The identifiers belong in seed data and in the bank's own profile record, never in a decision.
      expect(offenders).toEqual([]);
    });
  }
});

describe('v37 P4.6f: nothing branches on WHICH bank, only on whether one is linked', () => {
  const files = sourceFiles(resolve(ROOT, 'psp/backend/src'));

  // Files where the flag is used mechanically rather than to decide an outcome: a dispatch timeout, and the
  // registry's internal-first sort order. Neither changes what happens, only how fast or in what order.
  const MECHANICAL_USES = /integrationDispatch\.service|integrationRegistry\.service|providerEventConfig\.service/;

  // Known debt, listed rather than hidden by a looser regex, with the task that removes it. A stale entry
  // fails the second assertion below, so this list cannot outlive the problem it describes.
  const KNOWN_OFFENDERS: Array<{ file: string; phase: string; why: string }> = [
    {
      file: '/psp/backend/src/modules/gateway/services/cardAuthorization.service.ts',
      phase: 'P6.1/P7.2',
      why: 'chooses between the Hub and the local stub by the internal flag. It works today because the '
        + 'card engine is a built-in, and it BREAKS when the engine moves to the bank: that arrangement '
        + 'is internal-first, so this would take the stub branch and never call the bank. The fix '
        + 'belongs with the per-capability resolver, which decides by what the provider IS rather than by '
        + 'a label: an endpoint to dispatch to, or none.',
    },
  ];

  it('no conditional keys on a provider being internal, except the listed debt', () => {
    const offenders: string[] = [];
    for (const path of files) {
      if (MECHANICAL_USES.test(path)) continue;
      if (/if\s*\([^)]*externalProviderIsInternal/.test(code(path))) offenders.push(path.replace(ROOT, ''));
    }
    const known = KNOWN_OFFENDERS.map((entry) => entry.file.replace(/\//g, sep));
    const unexpected = offenders.filter((path) => !known.includes(path));
    // A NEW one is a regression: the shortcut is "internal provider, so handle it locally", which is what
    // makes a real ASPSP undroppable.
    expect(unexpected).toEqual([]);
  });

  it('every listed offender still exists, so the list cannot rot', () => {
    for (const entry of KNOWN_OFFENDERS) {
      const body = code(resolve(ROOT, entry.file.replace(/^\//, '')));
      expect(
        /if\s*\([^)]*externalProviderIsInternal/.test(body),
        `${entry.file} no longer branches on the flag: remove it from KNOWN_OFFENDERS (${entry.phase})`,
      ).toBe(true);
    }
  });

  it('the funds gate branches on the account being LINKED, not on the bank', () => {
    const gate = readFileSync(resolve(ROOT, 'psp/backend/src/providers/groups/providerGroups.ts'), 'utf8');
    // The predicate is about the account carrying a bank reference and a consent, which is true of any
    // registered ASPSP: a second bank needs no change here.
    expect(gate).toContain('isBankLinked(account)');
    expect(gate).not.toMatch(/bankcore['"]\s*===|===\s*['"]bankcore/);
  });

  it('the balance projection branches the same way', () => {
    const projection = readFileSync(
      resolve(ROOT, 'psp/backend/src/modules/gateway/services/payoutAccountBalanceProjection.ts'), 'utf8',
    );
    expect(projection).toMatch(/payoutAccountAspspReference/);
    expect(projection).not.toMatch(/=== ['"]bank0001/);
  });

  it('the consent status decision switches on the standard enumeration, not on a bank', () => {
    const receiver = readFileSync(
      resolve(ROOT, 'psp/backend/src/modules/provider/services/bankcoreNotification.service.ts'), 'utf8',
    );
    // Only `valid` is usable, and it is compared against the status, never against the issuer.
    expect(receiver).toContain("USABLE_CONSENT_STATUS = 'valid'");
    expect(receiver).not.toMatch(/notification\.issuer\s*===/);
  });
});
