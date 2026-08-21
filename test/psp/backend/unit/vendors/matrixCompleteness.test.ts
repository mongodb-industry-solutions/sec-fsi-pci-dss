// v37 P10.2: every collection setup creates is claimed by a row in the ownership matrix.
//
// The rule already existed in CLAUDE.md: every collection in `createCollections.ts` must appear in the
// Module to Collection matrix, because a collection nobody claims is undocumented ownership. A rule someone
// has to remember is a rule that decays, and the decay is silent: the matrix simply stops describing the
// system, and the lifecycle questions it exists to answer (switch an engine, extract a module, find an
// orphan) start being answered from a stale table. This makes it fail instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../../..');
const SPEC = resolve(ROOT, 'docs/technical-spec.md');

// Collection name constants, from either service. Same pattern the split gate uses.
const COLLECTION_CONSTANT = /export const ([A-Z][A-Z0-9_]*_COLLECTION)\s*=\s*'([a-zA-Z][a-zA-Z0-9_]*)'/g;

function declaredIn(setupFile: string, sourceRoots: string[]): Set<string> {
  const setup = readFileSync(resolve(ROOT, setupFile), 'utf8');

  // Bare literals, as `createCollection('x')` or `{ name: 'x' }`. Deliberately NOT `existingNames.has('x')`:
  // setup uses that both to skip an existing collection AND to drop a legacy one, so counting it would
  // report a collection that setup deletes as one it creates. `integrationEvents` is exactly that case.
  const names = new Set<string>();
  for (const match of setup.matchAll(/(?:name:\s*|createCollection\()'([a-z][a-zA-Z0-9_]*)'/g)) {
    names.add(match[1]);
  }

  // Constants, resolved from the service's own sources.
  const constants = new Map<string, string>();
  for (const root of sourceRoots) {
    for (const file of sourceFiles(resolve(ROOT, root))) {
      for (const match of readFileSync(file, 'utf8').matchAll(COLLECTION_CONSTANT)) {
        constants.set(match[1], match[2]);
      }
    }
  }
  for (const match of setup.matchAll(/name:\s*([A-Z][A-Z0-9_]*_COLLECTION)/g)) {
    const resolvedName = constants.get(match[1]);
    if (resolvedName) names.add(resolvedName);
  }
  for (const match of setup.matchAll(/\[([A-Z][A-Z0-9_]*_COLLECTION)\]/g)) {
    const resolvedName = constants.get(match[1]);
    if (resolvedName) names.add(resolvedName);
  }
  return names;
}

function sourceFiles(dir: string): string[] {
  const { readdirSync, statSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// The first column of every row in the completeness tables, which is where a name is claimed.
function claimedInMatrix(): Set<string> {
  const spec = readFileSync(SPEC, 'utf8');
  const section = spec.slice(spec.indexOf('### §10.1 Every collection and its owner'));
  const claimed = new Set<string>();
  for (const match of section.matchAll(/^\|\s*`([a-zA-Z][a-zA-Z0-9_]*)`\s*\|/gm)) {
    claimed.add(match[1]);
  }
  return claimed;
}

describe('v37 P10.2: the ownership matrix describes the whole system', () => {
  const claimed = claimedInMatrix();

  it('claims a meaningful number of collections, so a broken parse cannot pass silently', () => {
    // Guards the test itself: if the section moved or its formatting changed, `claimed` would be empty and
    // every assertion below would pass by having nothing to check.
    expect(claimed.size).toBeGreaterThan(50);
  });

  it('claims every collection the PSP setup creates', () => {
    const declared = declaredIn('psp/backend/src/vendors/setup/createCollections.ts', ['psp/backend/src', 'packages/eventbus/src']);
    expect(declared.size).toBeGreaterThan(20);
    const unclaimed = [...declared].filter((name) => !claimed.has(name)).sort();
    expect(unclaimed, 'add these to the matrix in technical-spec.md §10.1').toEqual([]);
  });

  it('claims every collection the bank setup creates', () => {
    const declared = declaredIn('bank/backend/src/vendors/setup/createCollections.ts', ['bank/backend/src', 'packages/eventbus/src']);
    expect(declared.size).toBeGreaterThan(15);
    const unclaimed = [...declared].filter((name) => !claimed.has(name)).sort();
    expect(unclaimed, 'add these to the matrix in technical-spec.md §10.1').toEqual([]);
  });

  it('records the two collections whose names invite confusion, and says which is which', () => {
    // Both corrections v37 made against its own plan. Whoever reads either name next needs the distinction
    // in front of them, or they will conclude one of the pair is a duplicate and delete it.
    const spec = readFileSync(SPEC, 'utf8');
    const section = spec.slice(spec.indexOf('### §10.1 Every collection and its owner'));
    expect(section).toContain('issuedCardRegistry');
    expect(section).toMatch(/paymentCardRegistry[\s\S]{0,400}issuedCardRegistry/);
    expect(section).toMatch(/customerCreditRatingState[\s\S]{0,400}creditAssessmentState/);
  });
});
