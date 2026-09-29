// v37: a key vault with two keys under one alt name blocks setup forever, and this repairs it.
//
// How it happens: DEK provisioning runs from `runSetup` AND from `buildQEClient` (once per QE tier),
// and `getOrCreate` is a check then act. On a fresh vault with the server running, those paths race
// and each creates its own copy. The unique index used to be created only by the setup path, so
// nothing stopped them, and once duplicated the index can never be built: every later setup dies with
// E11000 and the platform cannot be provisioned at all.
//
// The repair must not delete keys. Anything already encrypted under a duplicate would become
// unreadable, which is not a trade to make for a naming conflict.
import { describe, it, expect } from 'vitest';

interface VaultDoc { _id: string; keyAltNames?: string[]; creationDate: Date }

// Minimal stand-in for the key vault collection, honouring what the repair actually uses.
function fakeVault(docs: VaultDoc[]) {
  const createdIndexes: Array<{ keys: unknown; options: unknown }> = [];
  const collection = {
    aggregate(pipeline: Array<Record<string, unknown>>) {
      void pipeline;
      const byName = new Map<string, Array<{ id: string; created: Date }>>();
      for (const doc of docs) {
        for (const name of doc.keyAltNames ?? []) {
          if (!byName.has(name)) byName.set(name, []);
          byName.get(name)!.push({ id: doc._id, created: doc.creationDate });
        }
      }
      const groups = [...byName.entries()]
        .filter(([, keys]) => keys.length > 1)
        .map(([name, keys]) => ({ _id: name, keys }));
      return { toArray: async () => groups };
    },
    async updateMany(filter: Record<string, any>, update: Record<string, any>) {
      let modifiedCount = 0;
      for (const doc of docs) {
        const matchesId = filter._id?.$in ? filter._id.$in.includes(doc._id) : true;
        const matchesEmpty = filter.keyAltNames?.$size === 0 ? (doc.keyAltNames?.length ?? -1) === 0 : true;
        if (!matchesId || !matchesEmpty) continue;
        if (update.$pull?.keyAltNames !== undefined) {
          doc.keyAltNames = (doc.keyAltNames ?? []).filter((n) => n !== update.$pull.keyAltNames);
          modifiedCount++;
        }
        if (update.$unset?.keyAltNames !== undefined) {
          delete doc.keyAltNames;
          modifiedCount++;
        }
      }
      return { modifiedCount };
    },
    async createIndex(keys: unknown, options: unknown) {
      // A unique index cannot be built while a duplicate remains, which is the whole failure mode.
      const seen = new Set<string>();
      for (const doc of docs) {
        for (const name of doc.keyAltNames ?? []) {
          if (seen.has(name)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          seen.add(name);
        }
        // An emptied array indexes as a single undefined value, so several of them also collide.
        if (doc.keyAltNames?.length === 0) {
          if (seen.has('__undefined__')) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          seen.add('__undefined__');
        }
      }
      createdIndexes.push({ keys, options });
      return 'keyAltNames_1';
    },
  };
  return { docs, createdIndexes, client: { db: () => ({ collection: () => collection }) } };
}

function at(iso: string): Date { return new Date(iso); }

async function repair(vault: ReturnType<typeof fakeVault>) {
  const { ensureKeyVaultIntegrity } = await import('../../../../../psp/backend/src/vendors/encryption/keyVault');
  return ensureKeyVaultIntegrity(vault.client as never);
}

describe('v37: key vault integrity', () => {
  it('keeps the oldest key and removes only the alt name from the others', async () => {
    const vault = fakeVault([
      { _id: 'k1', keyAltNames: ['DEK-auth-email'], creationDate: at('2026-08-18T07:49:16.917Z') },
      { _id: 'k2', keyAltNames: ['DEK-auth-email'], creationDate: at('2026-08-18T07:49:16.931Z') },
      { _id: 'k3', keyAltNames: ['DEK-auth-email'], creationDate: at('2026-08-18T07:49:16.963Z') },
    ]);
    const { repaired } = await repair(vault);

    expect(repaired).toEqual(['DEK-auth-email (kept 1 of 3)']);
    // The oldest keeps the name: it is the one anything already encrypted would have used.
    expect(vault.docs.find((d) => d._id === 'k1')!.keyAltNames).toEqual(['DEK-auth-email']);
    // The others survive as keys, so nothing encrypted under them becomes unreadable.
    expect(vault.docs.map((d) => d._id)).toEqual(['k1', 'k2', 'k3']);
    expect(vault.docs.find((d) => d._id === 'k2')!.keyAltNames).toBeUndefined();
  });

  it('builds the unique index once the duplicates are gone', async () => {
    const vault = fakeVault([
      { _id: 'k1', keyAltNames: ['DEK-payout-iban'], creationDate: at('2026-08-18T07:00:00.000Z') },
      { _id: 'k2', keyAltNames: ['DEK-payout-iban'], creationDate: at('2026-08-18T07:00:01.000Z') },
    ]);
    await repair(vault);
    expect(vault.createdIndexes).toHaveLength(1);
    expect(vault.createdIndexes[0].options).toMatchObject({ unique: true });
  });

  it('drops an alt-name array emptied by an earlier repair, or the index still cannot build', async () => {
    // This is the second half of the bug: after a repair the losers hold `keyAltNames: []`, which still
    // satisfies the partial filter and indexes as one undefined value, so they collide with each other.
    const vault = fakeVault([
      { _id: 'k1', keyAltNames: ['DEK-card-expiry'], creationDate: at('2026-08-18T07:00:00.000Z') },
      { _id: 'k2', keyAltNames: [], creationDate: at('2026-08-18T07:00:01.000Z') },
      { _id: 'k3', keyAltNames: [], creationDate: at('2026-08-18T07:00:02.000Z') },
    ]);
    const { repaired } = await repair(vault);

    // Nothing to repair this run, and the cleanup still has to happen.
    expect(repaired).toEqual([]);
    expect(vault.docs.find((d) => d._id === 'k2')!.keyAltNames).toBeUndefined();
    expect(vault.docs.find((d) => d._id === 'k3')!.keyAltNames).toBeUndefined();
    expect(vault.createdIndexes).toHaveLength(1);
  });

  it('is a no-op on a healthy vault', async () => {
    const vault = fakeVault([
      { _id: 'k1', keyAltNames: ['DEK-a'], creationDate: at('2026-08-18T07:00:00.000Z') },
      { _id: 'k2', keyAltNames: ['DEK-b'], creationDate: at('2026-08-18T07:00:01.000Z') },
    ]);
    const { repaired } = await repair(vault);
    expect(repaired).toEqual([]);
    expect(vault.docs.every((d) => d.keyAltNames?.length === 1)).toBe(true);
  });
});

describe('v37: the panel can run the whole setup', () => {
  it('the allowlist covers a full rebuild and the bank scoped commands', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const controller = readFileSync(
      resolve(__dirname, '../../../../../psp/backend/src/modules/admin/controllers/admin.controller.ts'),
      'utf8',
    );
    for (const command of [
      "'setup:db'", "'setup:seed'", "'setup:check'", "'setup:db:drop'",
      "'setup:db:reset'", "'setup:reset'",
      "'setup:db:bankcore'", "'setup:seed:bankcore'", "'setup:check:bankcore'", "'setup:db:drop:bankcore'",
    ]) {
      expect(controller, `${command} must be runnable from the panel`).toContain(command);
    }
  });
});
