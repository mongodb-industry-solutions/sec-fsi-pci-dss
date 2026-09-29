/**
 * Unit tests: the validator expects what setup actually creates.
 * Source: psp/backend/src/vendors/setup/validateSetup.ts
 *         psp/backend/src/vendors/setup/createCollections.ts
 *
 * v39 deleted this application's identity implementation, and `createCollections.ts` says so in as
 * many words: a realm at the authority is what a domain used to be. `validateSetup.ts` was not told.
 * It went on requiring `customerAuthenticationAssessment`, `authenticationDomain`, `role` and
 * `partyAuthenticationAssessment`, so `setup:check` reported `[FAIL] collections - 20/24 present` on
 * a database that was exactly right, and the gate that exists to catch real drift cried wolf on
 * four collections whose absence was the intended outcome.
 *
 * The rule is one-directional on purpose. The validator may check FEWER collections than the
 * pipeline produces, because not every collection needs an assertion; it must never require one the
 * pipeline does not produce, because nothing would ever satisfy it.
 *
 * "Produces" deliberately covers three routes, not one. `createCollections.ts` creates a collection
 * explicitly when it needs options (encrypted fields, a timeseries, a TTL); otherwise the server
 * creates it on first insert and setup only ensures its INDEXES. Counting only the first route
 * reported `externalProviderArrangement` and two others as phantoms, which they are not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '../../../../..');
const COLLECTION_CONSTANT = /export const ([A-Z][A-Z0-9_]*_COLLECTION)\s*=\s*'([a-zA-Z0-9_]+)'/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every collection the setup pipeline produces, by any of its three routes. */
function createdBySetup(): Set<string> {
  const setup = readFileSync(resolve(ROOT, 'psp/backend/src/vendors/setup/createCollections.ts'), 'utf8');
  const names = new Set<string>();
  for (const match of setup.matchAll(/(?:name:\s*|createCollection\()'([a-z][a-zA-Z0-9_]*)'/g)) {
    names.add(match[1]);
  }
  const constants = new Map<string, string>();
  for (const root of ['psp/backend/src', 'packages/eventbus/src']) {
    for (const file of sourceFiles(resolve(ROOT, root))) {
      for (const match of readFileSync(file, 'utf8').matchAll(COLLECTION_CONSTANT)) {
        constants.set(match[1], match[2]);
      }
    }
  }
  // `createCollection(CONST)` is the third form setup uses, and the one the matrix suite does not
  // resolve: four collections are created only that way, so leaving it out reported them as phantoms.
  for (const pattern of [
    /name:\s*([A-Z][A-Z0-9_]*_COLLECTION)/g,
    /\[([A-Z][A-Z0-9_]*_COLLECTION)\]/g,
    /createCollection\(([A-Z][A-Z0-9_]*_COLLECTION)\)/g,
  ]) {
    for (const match of setup.matchAll(pattern)) {
      const resolved = constants.get(match[1]);
      if (resolved) names.add(resolved);
    }
  }
  // Implicitly created: setup never calls createCollection for these, it only ensures their indexes,
  // and the server creates them on the seeder's first insert.
  const indexes = readFileSync(resolve(ROOT, 'psp/backend/src/vendors/setup/createIndexes.ts'), 'utf8');
  for (const pattern of [/ensureIndexes\(\s*db,\s*'([a-z][a-zA-Z0-9_]*)'/g, /db\.collection\('([a-z][a-zA-Z0-9_]*)'\)/g]) {
    for (const match of indexes.matchAll(pattern)) names.add(match[1]);
  }
  for (const pattern of [/collection:\s*([A-Z][A-Z0-9_]*_COLLECTION)/g, /ensureIndexes\(\s*db,\s*([A-Z][A-Z0-9_]*_COLLECTION)/g]) {
    for (const match of indexes.matchAll(pattern)) {
      const resolved = constants.get(match[1]);
      if (resolved) names.add(resolved);
    }
  }

  return names;
}

/** The names `validateSetup.ts` requires to be present. */
function requiredByValidator(): string[] {
  const source = readFileSync(resolve(ROOT, 'psp/backend/src/vendors/setup/validateSetup.ts'), 'utf8');
  const block = /const EXPECTED_COLLECTIONS = \[([\s\S]*?)\];/.exec(source);
  expect(block, 'EXPECTED_COLLECTIONS was renamed or removed').not.toBeNull();
  return [...block![1].matchAll(/'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);
}

describe('validateSetup expectations', () => {
  const created = createdBySetup();
  const required = requiredByValidator();

  it('finds both lists, so the checks below are not vacuous', () => {
    expect(created.size).toBeGreaterThan(10);
    expect(required.length).toBeGreaterThan(10);
  });

  it('requires no collection that setup does not create', () => {
    const phantom = required.filter((name) => !created.has(name));
    expect(phantom, `validateSetup requires collections setup never creates: ${phantom.join(', ')}`).toEqual([]);
  });

  it('names each expected collection once', () => {
    const duplicated = required.filter((name, i) => required.indexOf(name) !== i);
    expect(duplicated).toEqual([]);
  });

  it('keeps the deleted identity collections out, since the authority owns identity now', () => {
    for (const gone of ['customerAuthenticationAssessment', 'authenticationDomain', 'role', 'partyAuthenticationAssessment']) {
      expect(required, `${gone} moved to the authority in v39`).not.toContain(gone);
    }
  });
});
