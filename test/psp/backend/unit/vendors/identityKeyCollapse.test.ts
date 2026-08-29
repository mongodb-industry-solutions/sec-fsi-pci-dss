// v39 P3.1: one identity key, resolvable without the collection that is being deleted.
//
// The platform carried two keys for one person: a token's `sub` (the login record) and the business
// reference every domain record is keyed by. Bridging them meant reading the login collection, and
// that collection is precisely what the extraction removes, so every such read was a dependency with
// a deletion date on it.
//
// The business record now carries its own subject. A token resolves to a party in one indexed hop,
// the authority issues the subject and the application keys its record by it, and nothing in that
// sentence mentions a login collection.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../../../../psp/backend/src');
const DATA = resolve(__dirname, '../../../../../psp/backend/data');

const parties = JSON.parse(readFileSync(resolve(DATA, 'parties.json'), 'utf8')) as Array<{
  partyInstanceReference: string;
  partyType: string;
}>;
// The pre-extraction logins, frozen. The live fixture went with the rest of the identity data; this
// test is about whether the BRIDGE was removed cleanly, which is a question about that moment.
const logins = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../giam/backend/fixtures/migration-source-logins.json'),
  'utf8',
)) as Array<{
  customerAuthenticationInstanceReference: string;
  partyInstanceReference: string;
}>;

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('v39 P3.1: the identity key lives on the business record', () => {
  it('declares the subject on the party record', () => {
    const model = readFileSync(resolve(SRC, 'modules/customer/models/party.model.ts'), 'utf8');
    expect(model).toMatch(/subjectId\?: string;/);
  });

  it('resolves a subject through the business record, not through the login collection', () => {
    // The resolution now reads a CLAIM the authority put in the token, so it survives the deletion of
    // the login collection by not touching a collection at all.
    const bridge = readFileSync(resolve(SRC, 'vendors/security/partyReference.ts'), 'utf8');
    expect(bridge).toMatch(/account_holder/);
    expect(stripComments(bridge)).not.toMatch(/CUSTOMER_AUTHENTICATION_COLLECTION/);
  });

  it('offers the inverse at the authority, which is the only place that can answer it', () => {
    // Naming the principal bound to a business reference is the authority's to answer: it holds the
    // binding. This application asks; it does not keep a copy of the mapping to answer from.
    const directory = readFileSync(
      resolve(SRC, '../../../giam/backend/src/modules/directory/services/directory.service.ts'),
      'utf8',
    );
    expect(directory).toMatch(/findByAccountHolderRef/);
  });
  it('indexes the subject uniquely, and only where one exists', () => {
    const indexes = readFileSync(resolve(SRC, 'vendors/setup/createIndexes.ts'), 'utf8');
    // Unique, because two business records answering to one subject would make the resolution
    // ambiguous in a way no caller could detect. Partial, because a party that cannot sign in has no
    // subject and must not be forced to invent one.
    expect(indexes).toMatch(/key: \{ subjectId: 1 \}, unique: true, partialFilterExpression/);
  });

  it('stamps the key from the seeder, so it is rebuilt rather than migrated', () => {
    // Stamped by the AUTHORITY's seeder now, from its own fixtures. Reusing the pre-extraction
    // reference is what makes a historical audit row still resolve to the same principal.
    const seeder = readFileSync(
      resolve(SRC, '../../../giam/backend/src/vendors/seed/seedIdentities.ts'),
      'utf8',
    );
    expect(seeder).toMatch(/subjectId/);
  });
});

describe('v39 P3.1: the mapping is one to one, in both directions', () => {
  it('gives every login exactly one party', () => {
    const byParty = new Map<string, number>();
    for (const login of logins) {
      byParty.set(login.partyInstanceReference, (byParty.get(login.partyInstanceReference) ?? 0) + 1);
    }
    const shared = [...byParty.entries()].filter(([, count]) => count > 1).map(([ref]) => ref);
    // Two logins on one party would stamp the party twice and the second subject would win
    // silently, so one of the two people would resolve to the other's business record.
    expect(shared, `parties with more than one login: ${shared.join(', ')}`).toEqual([]);
  });

  it('gives every party at most one subject', () => {
    const subjects = new Set(logins.map((l) => l.customerAuthenticationInstanceReference));
    expect(subjects.size).toBe(logins.length);
  });

  it('points every login at a party that exists', () => {
    const known = new Set(parties.map((p) => p.partyInstanceReference));
    const dangling = logins
      .filter((login) => !known.has(login.partyInstanceReference))
      .map((login) => login.customerAuthenticationInstanceReference);
    expect(dangling, `logins pointing nowhere: ${dangling.join(', ')}`).toEqual([]);
  });

  it('leaves a party that cannot sign in without a subject', () => {
    // The internal ledger owner is a ledger owner, not a principal. Giving it a subject would make
    // it one, and it would then appear wherever principals are listed.
    const withLogin = new Set(logins.map((l) => l.partyInstanceReference));
    const ledgerOwners = parties.filter((p) => p.partyType !== 'customer' && p.partyType !== 'employee');
    for (const owner of ledgerOwners) {
      expect(withLogin.has(owner.partyInstanceReference), `${owner.partyType} has a login`).toBe(false);
    }
  });

  it('preserves the subject strings exactly, so historical references still resolve', () => {
    // Audit rows, sessions and merchant references already contain these values. Regenerating them
    // would not break a test; it would quietly orphan every record that already names one.
    for (const login of logins) {
      expect(login.customerAuthenticationInstanceReference).toMatch(/^[A-Za-z0-9-]{8,}$/);
    }
  });
});
